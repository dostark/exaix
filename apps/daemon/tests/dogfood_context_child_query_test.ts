/**
 * @module DogfoodContextChildQueryTest
 * @path apps/daemon/tests/dogfood_context_child_query_test.ts
 * @description End-to-end proof that a genuinely spawned, separate
 * child process (apps/daemon/tests/fixtures/dogfood_mcp_child.ts, run via `deno run -A`
 * through its own shebang, never in-process) can reach a real DogfoodContextServer over
 * the launch connection and retrieve a seeded memory item absent from the initial
 * composed prompt — on both production launch paths: CliDelegateStrategy (cold subprocess
 * per step) and SessionDelegationCoordinator + real HeadlessSessionLauncher (governed
 * async cycle). `ToolRegistry.execute()` is never called here — the child speaks real
 * MCP wire protocol to a real loopback listener.
 * @architectural-layer Tests
 * @related-files [apps/daemon/src/dogfood_context_service.ts, packages/execution/src/strategies/cli_delegate_strategy.ts, apps/daemon/src/session_delegation_coordinator.ts, apps/daemon/src/headless_session_launcher.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { CliDelegateStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import { MemoryType } from "@exaix/core";
import type { IFlowWorktreeCoordinator } from "@exaix/core/types";
import type {
  IDogfoodContextHandle,
  IDogfoodContextInput,
  IDogfoodContextPort,
  IPortalKnowledgeService,
} from "@exaix/core/types";
import { DogfoodContextService, type IDogfoodMemorySource } from "../src/dogfood_context_service.ts";
import { HeadlessSessionLauncher } from "../src/headless_session_launcher.ts";
import {
  type ISessionCoordinatorDelegateService,
  type ISessionDelegationCoordinatorDeps,
  SessionDelegationCoordinator,
} from "../src/session_delegation_coordinator.ts";
import type { ISessionDelegationRequest } from "@exaix/session/session_delegation.ts";
import { SessionDelegationOutcomeSchema } from "@exaix/session/session_delegation.ts";
import type { ISessionWaitStore } from "@exaix/session/wait/i_session_wait_store.ts";
import type { ISessionDelegationResultStore } from "@exaix/session/session_delegation_result_store.ts";
import type { SessionBrief, SessionDelegateConfig, SessionWaitState } from "@exaix/schemas/session_delegate.ts";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import { generateOpencodePermissionConfig } from "@exaix/session/opencode_permission_generator.ts";
import type { PathResolver } from "@exaix/portal";

const CHILD_SCRIPT = fromFileUrl(new URL("./fixtures/dogfood_mcp_child.ts", import.meta.url));
const SEEDED_QUERY = "zephyr-seeded-fact";
const SEEDED_TITLE = "Zephyr rollout gate";
const SEEDED_CONTENT = "Zephyr feature flags require a staged rollout gate before 100% traffic.";
const TRUSTED_AGENT_ROLES = new Set(["dogfood-coder", "quality-judge"]);

function makePortalKnowledge(): Pick<IPortalKnowledgeService, "queryContext" | "loadCachedKnowledge"> {
  return {
    queryContext: () => Promise.resolve({ status: "unavailable" as never, reason: "disabled" as never, items: [] }),
    loadCachedKnowledge: () => Promise.resolve(undefined),
  };
}

/** Returns the seeded fact ONLY for the child's own live query — the initial composed
 *  prompt's own queryText gets nothing, so the fact is genuinely absent from the initial
 *  slice and only reachable by the child's own live MCP call. */
function makeMemory(): IDogfoodMemorySource {
  return {
    lookupMemories: (query: string) => {
      if (query === SEEDED_QUERY) {
        return Promise.resolve([
          { type: MemoryType.PATTERN, title: SEEDED_TITLE, content: SEEDED_CONTENT, relevance: 0.9 },
        ]);
      }
      return Promise.resolve([]);
    },
  };
}

function makeDogfoodContextService() {
  return new DogfoodContextService({
    portalAlias: "test-portal",
    portalKnowledge: makePortalKnowledge(),
    memory: makeMemory(),
    tokenizer: new AiTokenEstimatorTokenizer(),
    recordStore: { save: () => Promise.resolve() },
    config: {
      portalTopK: 5,
      memoryTopK: 5,
      portalTokens: 200,
      memoryTokens: 200,
      maxInputTokens: 4000,
      outputReserveTokens: 100,
      queryChars: 2000,
      maxQueryCalls: 16,
      maxQueryTokens: 8192,
      maxResponseBytes: 32_768,
      maxRequestBytes: 8192,
      connectionTtlMs: 60_000,
    },
    knownSecrets: [],
    now: () => new Date(),
  });
}

/** Wraps a real IDogfoodContextPort to record every prepare()'s connection and every
 *  close() call/reason for assertions, without altering the port's real behavior. */
function spyOnCloses(port: IDogfoodContextPort): {
  port: IDogfoodContextPort;
  closes: Array<{ recordId: string; reason: string }>;
  connections: IDogfoodContextHandle["connection"][];
} {
  const closes: Array<{ recordId: string; reason: string }> = [];
  const connections: IDogfoodContextHandle["connection"][] = [];
  return {
    closes,
    connections,
    port: {
      prepare: async (input: IDogfoodContextInput) => {
        const handle = await port.prepare(input);
        connections.push(handle.connection);
        return handle;
      },
      close: async (recordId: string, reason) => {
        closes.push({ recordId, reason: String(reason) });
        await port.close(recordId, reason);
      },
    },
  };
}

/** Confirms a closed connection's endpoint genuinely refuses a fresh call — the listener
 *  itself is torn down on close(), not merely credential-gated. */
async function assertConnectionRefusesAfterClose(connection: IDogfoodContextHandle["connection"]): Promise<void> {
  assert(connection, "a connection must have been prepared");
  let refused = false;
  try {
    await fetch(connection.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${connection.bearerToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  } catch {
    refused = true;
  }
  assert(refused, "a query against a closed connection's endpoint must be refused, not answered");
}

async function readChildResult(
  cwd: string,
): Promise<{ ok: boolean; toolNames?: string[]; searchMemoryResult?: Array<{ text: string }>; error?: string }> {
  const raw = await Deno.readTextFile(join(cwd, "dogfood_mcp_child_result.json"));
  return JSON.parse(raw);
}

Deno.test({
  name:
    "[dogfood_context_child_query] CliDelegateStrategy: a real spawned child retrieves the seeded fact through the live MCP connection",
  ignore: !(await hasDeno()),
  async fn() {
    const portalDir = await Deno.makeTempDir({ prefix: "dogfood-child-cli-" });
    try {
      const dogfoodService = makeDogfoodContextService();
      const { port: contextPort, closes, connections } = spyOnCloses(dogfoodService);

      const strategy = new CliDelegateStrategy({
        tool: "opencode",
        bin: CHILD_SCRIPT,
        resolvePortalPath: () => portalDir,
        contextPort,
        trustedAgentRoles: TRUSTED_AGENT_ROLES,
      });

      const blueprint: IAgentFileBlueprint = {
        name: "dogfood-coder",
        model: "",
        provider: "",
        capabilities: ["code_generation", "cli_delegate"],
        systemPrompt: "You are the dogfood coder.",
      };
      const context: IExecutionContext = {
        trace_id: crypto.randomUUID(),
        request_id: "REQ-child-query",
        request: "Implement the child-query fixture",
        plan: "Step 1: verify live MCP wiring",
        portal: "test-portal",
      };
      const options: IAgentExecutionOptions = {
        agent_role: "dogfood-coder",
        portal: "test-portal",
        security_mode: "sandboxed" as IAgentExecutionOptions["security_mode"],
        timeout_ms: 60_000,
        max_tool_calls: 10,
        audit_enabled: true,
      };

      await strategy.execute(blueprint, context, options);

      const result = await readChildResult(portalDir);
      assertEquals(result.ok, true, `child reported failure: ${result.error}`);
      assertEquals(result.toolNames, ["query_relationships", "search_memory", "who_depends_on"]);
      assert(result.searchMemoryResult, "search_memory result must be present");
      const text = result.searchMemoryResult![0].text;
      assert(text.includes(SEEDED_TITLE), `expected the seeded fact's title in: ${text}`);
      assert(text.includes(SEEDED_CONTENT), `expected the seeded fact's content in: ${text}`);

      // The strategy closes the connection once the turn completes.
      assertEquals(closes.length, 1);
      assertEquals(closes[0].reason, "completed");

      // A query against the now-closed connection's endpoint is refused, not answered.
      await assertConnectionRefusesAfterClose(connections[0]);
    } finally {
      await Deno.remove(portalDir, { recursive: true });
    }
  },
});

// Governed path: SessionDelegationCoordinator + real HeadlessSessionLauncher.

const FIXED_NOW = new Date("2026-09-08T00:00:00.000Z");
const CONFIG: SessionDelegateConfig = {
  enabled: true,
  tool: "opencode",
  model: "openai:gpt-5",
  gates: ["code_changes"],
  launch_mode: "headless",
  permitted_paths: ["src/**"],
  token_budget: { max_input_tokens: 1_000, max_output_tokens: 500, max_total_tokens: 1_500 },
  harden_permissions: true,
};

/** This test's request never sets portalAlias, so prepareBrief never calls this — it
 *  stands in only to satisfy the mandatory dependency. */
const NEVER_USED_WORKTREE_COORDINATOR: IFlowWorktreeCoordinator = {
  resolve: () => Promise.reject(new Error("not used")),
  release: () => Promise.resolve(),
  releaseAll: () => Promise.resolve(),
};

class OneShotDelegateService implements ISessionCoordinatorDelegateService {
  constructor(private readonly pathResolver: PathResolver, private readonly worktreeRoot: string) {}

  prepareBrief(input: Parameters<ISessionCoordinatorDelegateService["prepareBrief"]>[0]): Promise<SessionBrief> {
    return Promise.resolve(SessionBriefSchema.parse({
      trace_id: input.traceId,
      parent_trace_id: input.parentTraceId,
      parent_step_id: input.parentStepId,
      sequence: input.sequence,
      agent_role: input.agentRole,
      gate: input.gate,
      tool: input.tool,
      objective: input.objective,
      model: input.model,
      artifact_ref: input.artifactRef,
      acceptance_criteria: input.acceptanceCriteria,
      permitted_paths: input.permittedPaths,
      worktree_path: input.worktreePath,
      token_budget: input.tokenBudget,
      resume_token: "resume-token",
      deadline: input.deadline,
    }));
  }

  resolveLaunch(brief: SessionBrief): ISessionLaunch {
    return { command: CHILD_SCRIPT, args: [], cwd: brief.worktree_path ?? this.worktreeRoot, env: {} };
  }

  async resolveHardenedLaunch(
    brief: SessionBrief,
    _mode: Parameters<ISessionCoordinatorDelegateService["resolveHardenedLaunch"]>[1],
    _config: Parameters<ISessionCoordinatorDelegateService["resolveHardenedLaunch"]>[2],
    connection?: Parameters<ISessionCoordinatorDelegateService["resolveHardenedLaunch"]>[3],
  ): Promise<{ launch: ISessionLaunch; agentNameMismatch: boolean }> {
    const launch = this.resolveLaunch(brief);
    if (connection) {
      const permConfig = await generateOpencodePermissionConfig(
        brief.permitted_paths,
        this.worktreeRoot,
        this.pathResolver,
        brief.trace_id,
        brief.agent_role,
        connection,
      );
      launch.configPath = permConfig.configPath;
    }
    return { launch, agentNameMismatch: false };
  }

  resolveDelegateEnv(): Record<string, string> {
    return {};
  }
}

class OneShotWaitStore implements ISessionWaitStore {
  status: SessionWaitState["status"] = "resumed";

  park(traceId: string, gate: SessionBrief["gate"], resumeToken: string, deadline: string): Promise<SessionWaitState> {
    return Promise.resolve({
      trace_id: traceId,
      gate,
      resume_token: resumeToken,
      deadline,
      status: "pending",
      created_at: FIXED_NOW.toISOString(),
    });
  }
  resume(): Promise<SessionWaitState> {
    return Promise.reject(new Error("not used"));
  }
  expire(traceId: string): Promise<SessionWaitState> {
    return this.get(traceId).then((s) => s!);
  }
  cancel(traceId: string): Promise<SessionWaitState> {
    return this.get(traceId).then((s) => s!);
  }
  get(traceId: string): Promise<SessionWaitState | undefined> {
    return Promise.resolve({
      trace_id: traceId,
      gate: "code_changes",
      resume_token: "resume-token",
      deadline: "2027-01-01T00:00:00.000Z",
      status: this.status,
      decision: "changes_made",
      created_at: FIXED_NOW.toISOString(),
    });
  }
}

class OneShotResultStore implements ISessionDelegationResultStore {
  request: ISessionDelegationRequest | null = null;
  publishAccepted(): Promise<void> {
    return Promise.resolve();
  }
  publishRejected(): Promise<void> {
    return Promise.resolve();
  }
  get(traceId: string) {
    if (!this.request) return Promise.resolve(null);
    return Promise.resolve(SessionDelegationOutcomeSchema.parse({
      delegationTraceId: traceId,
      parentTraceId: this.request.parentTraceId,
      parentStepId: this.request.parentStepId,
      sequence: this.request.sequence,
      status: "completed",
      decision: "changes_made",
      summary: "completed",
      pathsTouched: [],
      tokenStats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }));
  }
  getRecord() {
    return Promise.resolve(null);
  }
  markDelivered(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

async function hasDeno(): Promise<boolean> {
  try {
    const status = await new Deno.Command("deno", { args: ["--version"], stdout: "null", stderr: "null" }).output();
    return status.success;
  } catch {
    return false;
  }
}

Deno.test({
  name:
    "[dogfood_context_child_query] SessionDelegationCoordinator + real HeadlessSessionLauncher: a real spawned child retrieves the seeded fact",
  ignore: !(await hasDeno()),
  async fn() {
    const worktreeDir = await Deno.makeTempDir({ prefix: "dogfood-child-governed-" });
    const sessionDir = await Deno.makeTempDir({ prefix: "dogfood-child-governed-session-" });
    try {
      const pathResolver = {
        resolve: (path: string) => Promise.resolve(`${worktreeDir}/${path.replace(/^@Runtime\/?/, "runtime/")}`),
      } as never;

      const dogfoodService = makeDogfoodContextService();
      const { port: contextPort, closes, connections } = spyOnCloses(dogfoodService);

      const launcher = new HeadlessSessionLauncher({
        sessionDir,
        allowlist: new Set([CHILD_SCRIPT]),
        drainIdleTimeoutMs: 30_000,
      });

      const deps: ISessionDelegationCoordinatorDeps = {
        config: CONFIG,
        delegateService: new OneShotDelegateService(pathResolver, worktreeDir),
        waitStore: new OneShotWaitStore(),
        resultStore: new OneShotResultStore(),
        launcher,
        resolveModel: () => Promise.resolve(undefined),
        resolveProviderApiKey: () => undefined,
        now: () => FIXED_NOW,
        sleep: () => Promise.resolve(),
        contextPort,
        trustedAgentRoles: TRUSTED_AGENT_ROLES,
        portals: [],
        worktreeCoordinator: NEVER_USED_WORKTREE_COORDINATOR,
      };
      const coordinator = new SessionDelegationCoordinator(
        deps,
        { info: () => Promise.resolve(), warn: () => Promise.resolve() } as never,
      );

      const request: ISessionDelegationRequest = {
        parentTraceId: crypto.randomUUID(),
        parentStepId: "1",
        sequence: 1,
        agentRole: "dogfood-coder",
        objective: "Implement the governed child-query fixture",
        acceptanceCriteria: [],
        artifactRef: "trace:test/step:1",
        worktreePath: worktreeDir,
      };
      (deps.resultStore as OneShotResultStore).request = request;

      const outcome = await coordinator.delegate(request);
      assertEquals(outcome.status, "completed");

      const result = await readChildResult(worktreeDir);
      assertEquals(result.ok, true, `child reported failure: ${result.error}`);
      assert(result.searchMemoryResult, "search_memory result must be present");
      const text = result.searchMemoryResult![0].text;
      assert(text.includes(SEEDED_TITLE), `expected the seeded fact's title in: ${text}`);

      assertEquals(closes.length, 1);
      assertEquals(closes[0].reason, "completed");

      await assertConnectionRefusesAfterClose(connections[0]);
    } finally {
      await Deno.remove(worktreeDir, { recursive: true });
      await Deno.remove(sessionDir, { recursive: true });
    }
  },
});
