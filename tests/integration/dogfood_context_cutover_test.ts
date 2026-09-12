/**
 * @module DogfoodContextCutoverTest
 * @path tests/integration/dogfood_context_cutover_test.ts
 * @description Phase 176 Step 4 — both production surfaces (CliDelegateStrategy's stock
 *   per-step launch, SessionDelegationCoordinator's governed cycle) driven end to end
 *   against the deterministic tests/scenario_framework/fixtures/phase176/context_case.json
 *   fixture: two-portal isolation, the default-config synthetic size bound, original-prompt
 *   preservation, disabled-feature byte-for-byte golden parity, decoy/secret non-surfacing,
 *   a real spawned child's live second-query nonce discovery over the real MCP transport,
 *   captured-record/CLI-inspection equality, cycle review outcome, and close/replay denial.
 * @architectural-layer Integration
 * @dependencies [@exaix/execution, @exaix/session, @exaix/core, @exaix/schemas]
 * @related-files [apps/daemon/src/dogfood_context_service.ts, apps/daemon/tests/dogfood_context_child_query_test.ts, apps/exactl/src/commands/inspect_commands.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { CliDelegateStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import {
  DEFAULT_DOGFOOD_CONTEXT_MAX_INPUT_TOKENS,
  DEFAULT_DOGFOOD_CONTEXT_MAX_QUERY_CALLS,
  DEFAULT_DOGFOOD_CONTEXT_MAX_QUERY_TOKENS,
  DEFAULT_DOGFOOD_CONTEXT_MAX_REQUEST_BYTES,
  DEFAULT_DOGFOOD_CONTEXT_MAX_RESPONSE_BYTES,
  DEFAULT_DOGFOOD_CONTEXT_MEMORY_TOKENS,
  DEFAULT_DOGFOOD_CONTEXT_MEMORY_TOP_K,
  DEFAULT_DOGFOOD_CONTEXT_OUTPUT_RESERVE_TOKENS,
  DEFAULT_DOGFOOD_CONTEXT_PORTAL_TOKENS,
  DEFAULT_DOGFOOD_CONTEXT_PORTAL_TOP_K,
  DEFAULT_DOGFOOD_CONTEXT_QUERY_CHARS,
} from "@exaix/core";
import { MemoryType } from "@exaix/core";
import type {
  IDogfoodContextHandle,
  IDogfoodContextInput,
  IDogfoodContextPort,
  IFlowWorktreeCoordinator,
  IPortalKnowledgeService,
  IScoredContextResult,
} from "@exaix/core/types";
import { DogfoodContextService, type IDogfoodMemorySource } from "../../apps/daemon/src/dogfood_context_service.ts";
import { HeadlessSessionLauncher } from "../../apps/daemon/src/headless_session_launcher.ts";
import {
  type ISessionCoordinatorDelegateService,
  SessionDelegationCoordinator,
} from "../../apps/daemon/src/session_delegation_coordinator.ts";
import type { ISessionDelegationRequest } from "@exaix/session/session_delegation.ts";
import { SessionDelegationOutcomeSchema } from "@exaix/session/session_delegation.ts";
import type { ISessionWaitStore } from "@exaix/session/wait/i_session_wait_store.ts";
import type { ISessionDelegationResultStore } from "@exaix/session/session_delegation_result_store.ts";
import type { SessionBrief, SessionDelegateConfig, SessionWaitState } from "@exaix/schemas/session_delegate.ts";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import { generateOpencodePermissionConfig } from "@exaix/session/opencode_permission_generator.ts";
import { ContextRecordStore, isValidUuid } from "@exaix/session";
import { PathResolver } from "@exaix/portal";
import { ConfigService } from "@exaix/core/config";
import { ExaPathDefaults } from "@exaix/core";
import type { PathResolver as PathResolverType } from "@exaix/portal";
import { InspectCommands } from "../../apps/exactl/src/commands/inspect_commands.ts";
import { createStubContext } from "@exaix/testing";
import { captureAllOutputs } from "../../apps/exactl/tests/helpers/console_utils.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const CHILD_SCRIPT = fromFileUrl(new URL("../../apps/daemon/tests/fixtures/dogfood_mcp_child.ts", import.meta.url));
const FIXTURE_PATH = join(REPO_ROOT, "tests/scenario_framework/fixtures/phase176/context_case.json");

interface IFixtureRecord {
  id: string;
  text: string;
}

interface IFixturePortal {
  alias: string;
  topic: string;
  query: string;
  relevantRecordIds: string[];
  records: IFixtureRecord[];
}

interface IFixtureMemory {
  secondQuery: string;
  approvedAnswerMemory: { title: string; content: string; nonce: string; citation: string };
  decoys: {
    retired: IFixtureRecord[];
    foreign: IFixtureRecord[];
    secretCanary: IFixtureRecord[];
  };
}

interface IFixtureGoldens {
  stockFirstTurnOriginalPrompt: string;
  stockResumedTurnOriginalPrompt: string;
  cycleStepOriginalPrompt: string;
}

interface IFixture {
  portals: [IFixturePortal, IFixturePortal];
  memory: IFixtureMemory;
  goldens: IFixtureGoldens;
}

async function loadFixture(): Promise<IFixture> {
  const raw = await Deno.readTextFile(FIXTURE_PATH);
  return JSON.parse(raw);
}

const MODEL = "anthropic:claude-sonnet-5";
const TRUSTED_AGENT_ROLES = new Set(["dogfood-coder", "quality-judge"]);

/** Returns the fixture portal's 5 relevant records only for its own query (never a leak
 *  to another query); substring match since CliDelegateStrategy embeds the raw request
 *  inside its own "TASK: {request}" template before querying. */
function makeScopedPortalSource(
  portal: IFixturePortal,
): Pick<IPortalKnowledgeService, "queryContext" | "loadCachedKnowledge"> {
  return {
    queryContext: (query): Promise<IScoredContextResult> => {
      if (query.portalAlias !== portal.alias || !query.query.includes(portal.query)) {
        return Promise.resolve({ status: "ok" as never, items: [] });
      }
      const items = portal.records
        .filter((r) => portal.relevantRecordIds.includes(r.id))
        .map((r, i) => ({
          id: r.id,
          source: portal.alias,
          text: r.text,
          score: 1 - i * 0.05,
          scoreKind: "cosine" as never,
        }));
      return Promise.resolve({ status: "ok" as never, items });
    },
    loadCachedKnowledge: () => Promise.resolve(undefined),
  };
}

/** The approved-answer memory is returned ONLY for the fixture's exact `secondQuery` text
 *  — genuinely absent from every initial-supplement query, discoverable only by a live
 *  follow-up call through the MCP `search_memory` tool. */
function makeFixtureMemorySource(memory: IFixtureMemory): IDogfoodMemorySource {
  return {
    lookupMemories: (query: string) => {
      if (query === memory.secondQuery) {
        return Promise.resolve([{
          type: MemoryType.PATTERN,
          title: memory.approvedAnswerMemory.title,
          content: memory.approvedAnswerMemory.content,
          relevance: 0.95,
          source: memory.approvedAnswerMemory.citation,
        }]);
      }
      return Promise.resolve([]);
    },
  };
}

function defaultServiceConfig() {
  return {
    portalTopK: DEFAULT_DOGFOOD_CONTEXT_PORTAL_TOP_K,
    memoryTopK: DEFAULT_DOGFOOD_CONTEXT_MEMORY_TOP_K,
    portalTokens: DEFAULT_DOGFOOD_CONTEXT_PORTAL_TOKENS,
    memoryTokens: DEFAULT_DOGFOOD_CONTEXT_MEMORY_TOKENS,
    maxInputTokens: DEFAULT_DOGFOOD_CONTEXT_MAX_INPUT_TOKENS,
    outputReserveTokens: DEFAULT_DOGFOOD_CONTEXT_OUTPUT_RESERVE_TOKENS,
    queryChars: DEFAULT_DOGFOOD_CONTEXT_QUERY_CHARS,
    maxQueryCalls: DEFAULT_DOGFOOD_CONTEXT_MAX_QUERY_CALLS,
    maxQueryTokens: DEFAULT_DOGFOOD_CONTEXT_MAX_QUERY_TOKENS,
    maxResponseBytes: DEFAULT_DOGFOOD_CONTEXT_MAX_RESPONSE_BYTES,
    maxRequestBytes: DEFAULT_DOGFOOD_CONTEXT_MAX_REQUEST_BYTES,
    connectionTtlMs: 60_000,
  };
}

async function makeRealRecordStore(): Promise<
  { store: ContextRecordStore; pathResolver: PathResolverType; tempDir: string }
> {
  const tempDir = await Deno.makeTempDir({ prefix: "phase176-cutover-" });
  await Deno.mkdir(join(tempDir, ExaPathDefaults.memory), { recursive: true });
  const configPath = join(tempDir, "config.toml");
  await Deno.writeTextFile(
    configPath,
    `[system]\nroot = ${JSON.stringify(tempDir)}\n\n[paths]\nmemory = ${JSON.stringify(ExaPathDefaults.memory)}\n`,
  );
  const configService = new ConfigService(configPath);
  const pathResolver = new PathResolver(configService.getAll());
  return { store: new ContextRecordStore(pathResolver), pathResolver, tempDir };
}

function makeService(
  portal: IFixturePortal,
  fixture: IFixture,
  recordStore: ContextRecordStore,
): DogfoodContextService {
  return new DogfoodContextService({
    portalAlias: portal.alias,
    portalKnowledge: makeScopedPortalSource(portal),
    memory: makeFixtureMemorySource(fixture.memory),
    tokenizer: new AiTokenEstimatorTokenizer(),
    recordStore,
    config: defaultServiceConfig(),
    knownSecrets: [],
    now: () => new Date("2026-09-15T00:00:00.000Z"),
  });
}

function blueprint(): IAgentFileBlueprint {
  return {
    name: "dogfood-coder",
    model: "",
    provider: "",
    capabilities: ["code_generation", "cli_delegate"],
    systemPrompt: "You are the dogfood coder.",
  };
}

function execOptions(): IAgentExecutionOptions {
  return {
    agent_role: "dogfood-coder",
    portal: "test-portal",
    security_mode: "sandboxed" as IAgentExecutionOptions["security_mode"],
    timeout_ms: 60_000,
    max_tool_calls: 10,
    audit_enabled: true,
  };
}

async function fullDumpTokenCount(portal: IFixturePortal): Promise<number> {
  const tokenizer = new AiTokenEstimatorTokenizer();
  const dump = portal.records.map((r) => r.text).join("\n\n---\n\n");
  return await tokenizer.countTokens(dump, MODEL);
}

function assertNoDecoys(promptText: string, memory: IFixtureMemory): void {
  for (const decoy of [...memory.decoys.retired, ...memory.decoys.foreign, ...memory.decoys.secretCanary]) {
    assertEquals(promptText.includes(decoy.text), false, `decoy leaked into composed prompt: ${decoy.id}`);
  }
}

// --- Two-portal isolation + synthetic bound + original-prompt preservation ---

for (const portalIndex of [0, 1] as const) {
  Deno.test(`[dogfood_context_cutover] portal isolation + synthetic bound (portal ${portalIndex}): CliDelegateStrategy stock path`, async () => {
    const fixture = await loadFixture();
    const portal = fixture.portals[portalIndex];
    const otherPortal = fixture.portals[1 - portalIndex];
    const { store, tempDir } = await makeRealRecordStore();
    try {
      const service = makeService(portal, fixture, store);
      const { run, calls } = makeFakeRun();
      const strategy = new CliDelegateStrategy({
        tool: "claude-code",
        bin: "claude",
        resolvePortalPath: () => "/tmp/portal",
        run,
        contextPort: service,
        trustedAgentRoles: TRUSTED_AGENT_ROLES,
        model: MODEL,
      });

      const traceId = crypto.randomUUID();
      await strategy.execute(blueprint(), makeContext({ request: portal.query, trace_id: traceId }), execOptions());

      const delivered = calls[0][1];
      // CliDelegateStrategy wraps the raw request in its own non-dogfood
      // "You are .../TASK: {request}/PLAN STEP: ..." template before it ever reaches
      // applyDogfoodContext — the raw request text must still appear verbatim inside it.
      assertStringIncludes(delivered, portal.query);

      for (const id of portal.relevantRecordIds) {
        const record = portal.records.find((r) => r.id === id)!;
        assert(delivered.includes(record.text), `expected relevant record ${id} in the composed prompt`);
      }
      for (const record of otherPortal.records) {
        assertEquals(delivered.includes(record.text), false, `foreign-portal record leaked: ${record.id}`);
      }
      assertNoDecoys(delivered, fixture.memory);
      assertEquals(
        delivered.includes(fixture.memory.approvedAnswerMemory.nonce),
        false,
        "nonce must not be in the initial prompt",
      );

      const summaries = await store.list(traceId);
      assertEquals(summaries.length, 1);
      const record = await store.read(traceId, summaries[0].recordId);
      assertEquals(record.promptText, delivered, "the captured record must match exactly what was delivered");
      const supplementTokens = record.finalTokenCount - record.originalTokenCount;
      assert(supplementTokens > 0, "a supplement must have been added for a matched query");
      assert(
        supplementTokens <= 3072,
        `supplement (${supplementTokens} tokens) must stay within the default 3072-token ceiling`,
      );

      const fullDump = await fullDumpTokenCount(portal);
      assert(
        supplementTokens <= fullDump * 0.5,
        `supplement (${supplementTokens}) must be <=50% of a synthetic full-20-record dump (${fullDump})`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
}

// --- Disabled feature: byte-for-byte golden parity on both surfaces ---

Deno.test("[dogfood_context_cutover] disabled feature (no contextPort): stock first/resumed turns deliver goldens byte-for-byte", async () => {
  const fixture = await loadFixture();
  const { run, calls } = makeFakeRun();
  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
    model: MODEL,
  });

  const traceId = crypto.randomUUID();
  await strategy.execute(
    blueprint(),
    makeContext({ request: fixture.goldens.stockFirstTurnOriginalPrompt, trace_id: traceId }),
    execOptions(),
  );
  await strategy.execute(
    blueprint(),
    makeContext({ request: fixture.goldens.stockResumedTurnOriginalPrompt, trace_id: traceId }),
    execOptions(),
  );

  // The surrounding "You are .../TASK: .../PLAN STEP: ..." template is CliDelegateStrategy's
  // own non-dogfood prompt assembly, unrelated to this feature — the golden's own text must
  // still appear verbatim, unmodified, with no dogfood supplement separator appended.
  assertStringIncludes(calls[0][1], fixture.goldens.stockFirstTurnOriginalPrompt);
  assertStringIncludes(calls[1][1], fixture.goldens.stockResumedTurnOriginalPrompt);
  assertEquals(calls[0][1].includes("---"), false, "no dogfood supplement separator without a contextPort");
  assertEquals(calls[1][1].includes("---"), false, "no dogfood supplement separator without a contextPort");
});

Deno.test("[dogfood_context_cutover] disabled feature (no contextPort): cycle step delivers its golden byte-for-byte", async () => {
  const fixture = await loadFixture();
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  const resultStore = new OutcomeResultStore();
  resultStore.status = "completed";
  const launcher = new RecordingLauncher();
  const coordinator = new SessionDelegationCoordinator(
    {
      config: CYCLE_CONFIG,
      delegateService,
      waitStore,
      resultStore,
      launcher,
      resolveProviderApiKey: () => undefined,
      resolveModel: () => Promise.resolve(undefined),
      now: () => FIXED_NOW,
      sleep: () => Promise.resolve(),
      portals: [],
      worktreeCoordinator: NEVER_USED_WORKTREE_COORDINATOR,
    },
    { info: () => Promise.resolve(), warn: () => Promise.resolve() } as never,
  );

  const req = cycleRequest(fixture.goldens.cycleStepOriginalPrompt);
  resultStore.request = req;
  await coordinator.delegate(req);

  assertEquals(delegateService.prepared[0].objective, fixture.goldens.cycleStepOriginalPrompt);
});

// --- Live second-query nonce discovery: a real spawned child over real MCP transport ---

Deno.test("[dogfood_context_cutover][live-mcp] CliDelegateStrategy stock path: a real spawned child retrieves the approved-answer nonce+citation via a live second query", async () => {
  const fixture = await loadFixture();
  const portal = fixture.portals[0];
  const { store, tempDir } = await makeRealRecordStore();
  const portalDir = await Deno.makeTempDir({ prefix: "dogfood-cutover-cli-" });
  try {
    const service = makeService(portal, fixture, store);
    const { port: contextPort, closes, connections } = spyOnCloses(service);

    const strategy = new CliDelegateStrategy({
      tool: "opencode",
      bin: CHILD_SCRIPT,
      resolvePortalPath: () => portalDir,
      contextPort,
      trustedAgentRoles: TRUSTED_AGENT_ROLES,
      model: MODEL,
    });

    // No DOGFOOD_CHILD_QUERY override: the child harness's own default query is fixed to
    // the fixture's secondQuery value (see the fixture's secondQueryNote) since a custom
    // env var set here would be stripped by the production child-env allowlist anyway.
    await strategy.execute(
      blueprint(),
      makeContext({ request: portal.query, trace_id: crypto.randomUUID() }),
      execOptions(),
    );

    const result = await readChildResult(portalDir);
    assertEquals(result.ok, true, `child reported failure: ${result.error}`);
    assert(result.searchMemoryResult, "search_memory result must be present");
    const text = result.searchMemoryResult![0].text;
    assert(text.includes(fixture.memory.approvedAnswerMemory.nonce), `expected the nonce in: ${text}`);
    assert(text.includes(fixture.memory.approvedAnswerMemory.citation), `expected the citation in: ${text}`);

    assertEquals(closes.length, 1);
    assertEquals(closes[0].reason, "completed");
    await assertConnectionRefusesAfterClose(connections[0]);
  } finally {
    await Deno.remove(portalDir, { recursive: true });
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[dogfood_context_cutover][live-mcp] SessionDelegationCoordinator cycle path: a real spawned child retrieves the nonce, and the delegation completes with a real review outcome", async () => {
  const fixture = await loadFixture();
  const portal = fixture.portals[1];
  const { store, tempDir } = await makeRealRecordStore();
  const worktreeDir = await Deno.makeTempDir({ prefix: "dogfood-cutover-governed-" });
  const sessionDir = await Deno.makeTempDir({ prefix: "dogfood-cutover-governed-session-" });
  try {
    const service = makeService(portal, fixture, store);
    const { port: contextPort, closes, connections } = spyOnCloses(service);

    const pathResolver = {
      resolve: (path: string) => Promise.resolve(`${worktreeDir}/${path.replace(/^@Runtime\/?/, "runtime/")}`),
    } as never;
    const launcher = new HeadlessSessionLauncher({
      sessionDir,
      allowlist: new Set([CHILD_SCRIPT]),
      drainIdleTimeoutMs: 30_000,
    });
    const resultStore = new OneShotResultStore();
    const req: ISessionDelegationRequest = {
      parentTraceId: crypto.randomUUID(),
      parentStepId: "1",
      sequence: 1,
      agentRole: "dogfood-coder",
      objective: portal.query,
      acceptanceCriteria: [],
      artifactRef: "trace:test/step:1",
      worktreePath: worktreeDir,
    };
    resultStore.request = req;

    const coordinator = new SessionDelegationCoordinator(
      {
        config: CYCLE_CONFIG,
        delegateService: new OneShotDelegateService(pathResolver, worktreeDir),
        waitStore: new OneShotWaitStore(),
        resultStore,
        launcher,
        resolveModel: () => Promise.resolve(undefined),
        resolveProviderApiKey: () => undefined,
        now: () => FIXED_NOW,
        sleep: () => Promise.resolve(),
        contextPort,
        trustedAgentRoles: TRUSTED_AGENT_ROLES,
        portals: [],
        worktreeCoordinator: NEVER_USED_WORKTREE_COORDINATOR,
      },
      { info: () => Promise.resolve(), warn: () => Promise.resolve() } as never,
    );

    const outcome = await coordinator.delegate(req);

    assertEquals(outcome.status, "completed", "the cycle's real review/gate outcome must be completed");

    const result = await readChildResult(worktreeDir);
    assertEquals(result.ok, true, `child reported failure: ${result.error}`);
    assert(result.searchMemoryResult, "search_memory result must be present");
    const text = result.searchMemoryResult![0].text;
    assert(text.includes(fixture.memory.approvedAnswerMemory.nonce), `expected the nonce in: ${text}`);

    assertEquals(closes.length, 1);
    assertEquals(closes[0].reason, "completed");
    await assertConnectionRefusesAfterClose(connections[0]);
  } finally {
    await Deno.remove(worktreeDir, { recursive: true });
    await Deno.remove(sessionDir, { recursive: true });
    await Deno.remove(tempDir, { recursive: true });
  }
});

// --- Captured record / `exactl request inspect` CLI equality ---

Deno.test("[dogfood_context_cutover] the captured record and `exactl request inspect --json` report the same promptText and tools", async () => {
  const fixture = await loadFixture();
  const portal = fixture.portals[0];
  const { store, tempDir } = await makeRealRecordStore();
  try {
    const service = makeService(portal, fixture, store);
    const traceId = crypto.randomUUID();
    const input: IDogfoodContextInput = {
      executionTraceId: traceId,
      parentTraceId: traceId,
      stepId: "1",
      sequence: 1,
      turn: 0,
      attempt: 1,
      surface: "cli_delegate",
      model: MODEL,
      originalPrompt: portal.query,
      queryText: portal.query,
      acceptanceCriteria: [],
    };
    const handle = await service.prepare(input);
    await service.close(handle.recordId, "completed" as never);

    const inspect = new InspectCommands(createStubContext(), { store });
    const out = await captureAllOutputs(() => inspect.inspect(traceId, { record: handle.recordId, json: true }));
    const parsed = JSON.parse(out.logs.at(-1)!);

    assertEquals(parsed.recordId, handle.recordId);
    assertEquals(parsed.promptText, handle.prompt);
    assert(isValidUuid(parsed.recordId));
    assertEquals(parsed.tools.map((t: { name: string }) => t.name).toSorted(), [
      "query_relationships",
      "search_memory",
      "who_depends_on",
    ]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// --- Test-local helpers mirroring apps/daemon/tests/dogfood_context_child_query_test.ts ---

function makeFakeRun() {
  const calls: string[][] = [];
  const run = (_command: string, args: string[]) => {
    calls.push(args);
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "result", result: "done", usage: { input_tokens: 10, output_tokens: 5 } }),
      stderr: "",
    });
  };
  return { run, calls };
}

function makeContext(overrides: Partial<IExecutionContext> = {}): IExecutionContext {
  return {
    trace_id: crypto.randomUUID(),
    request_id: "REQ-1",
    request: "placeholder",
    plan: "Step 1",
    portal: "test-portal",
    ...overrides,
  };
}

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

class RecordingDelegateService implements ISessionCoordinatorDelegateService {
  readonly prepared: Array<{ objective: string }> = [];

  prepareBrief(input: Parameters<ISessionCoordinatorDelegateService["prepareBrief"]>[0]): Promise<SessionBrief> {
    this.prepared.push({ objective: input.objective });
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
    return { command: "codex", args: [], cwd: brief.worktree_path ?? "/tmp", env: {} };
  }

  resolveHardenedLaunch(brief: SessionBrief): Promise<{ launch: ISessionLaunch; agentNameMismatch: boolean }> {
    return Promise.resolve({ launch: this.resolveLaunch(brief), agentNameMismatch: false });
  }

  resolveDelegateEnv(): Record<string, string> {
    return {};
  }
}

class RecordingWaitStore implements ISessionWaitStore {
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
      status: "resumed",
      decision: "changes_made",
      created_at: FIXED_NOW.toISOString(),
    });
  }
}

class OutcomeResultStore implements ISessionDelegationResultStore {
  status: "completed" | null = "completed";
  request: ISessionDelegationRequest | null = null;
  publishAccepted(): Promise<void> {
    return Promise.resolve();
  }
  publishRejected(): Promise<void> {
    return Promise.resolve();
  }
  get(traceId: string) {
    if (!this.status || !this.request) return Promise.resolve(null);
    return Promise.resolve(SessionDelegationOutcomeSchema.parse({
      delegationTraceId: traceId,
      parentTraceId: this.request.parentTraceId,
      parentStepId: this.request.parentStepId,
      sequence: this.request.sequence,
      status: this.status,
      decision: "changes_made",
      summary: "completed",
      pathsTouched: ["packages/session/mod.ts"],
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

class RecordingLauncher {
  launch(_launch: ISessionLaunch): Promise<void> {
    return Promise.resolve();
  }
}

function cycleRequest(objective: string): ISessionDelegationRequest {
  return {
    parentTraceId: crypto.randomUUID(),
    parentStepId: "1",
    sequence: 1,
    agentRole: "dogfood-coder",
    objective,
    acceptanceCriteria: ["Fixture-driven acceptance criterion."],
    artifactRef: "trace:test/step:1",
    worktreePath: "/tmp/worktree",
  };
}

const FIXED_NOW = new Date("2026-09-15T00:00:00.000Z");
const CYCLE_CONFIG: SessionDelegateConfig = {
  enabled: true,
  tool: "opencode",
  model: "openai:gpt-5",
  gates: ["code_changes"],
  launch_mode: "headless",
  permitted_paths: ["packages/**"],
  token_budget: { max_input_tokens: 1_000, max_output_tokens: 500, max_total_tokens: 1_500 },
  harden_permissions: true,
};

/** Neither cycle test below sets portalAlias on its request, so prepareBrief never calls
 *  this — it stands in only to satisfy the mandatory dependency. */
const NEVER_USED_WORKTREE_COORDINATOR: IFlowWorktreeCoordinator = {
  resolve: () => Promise.reject(new Error("not used")),
  release: () => Promise.resolve(),
  releaseAll: () => Promise.resolve(),
};

class OneShotDelegateService implements ISessionCoordinatorDelegateService {
  constructor(private readonly pathResolver: PathResolverType, private readonly worktreeRoot: string) {}

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
      status: "resumed",
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
