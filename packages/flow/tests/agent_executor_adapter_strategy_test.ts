/**
 * @module AgentOrchestratorAdapterStrategyTest
 * @path packages/flow/tests/agent_executor_adapter_strategy_test.ts
 * @description Phase 159 Step 3: `AgentOrchestratorAdapter.runWithStrategy` constructs a
 *   fresh, per-call `AgentOrchestrator` (mirroring `PlanExecutor.createAgentExecutor`'s
 *   trace/portal-scoped construction — see GAP-2), builds `IExecutionContext`/
 *   `IAgentExecutionOptionsInput` from the flow step's own request, dispatches through the
 *   forced strategy, and bridges `IChangesetResult.description` into
 *   `IAgentExecutionResult.content`. Fails fast when construction dependencies or the
 *   step's portal are absent, rather than reaching `AgentOrchestrator`'s generic errors.
 *   Uses a spy strategy (via the adapter's test-only `strategyRegistry` construction dep)
 *   so the test has no live-provider or subprocess dependency.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AgentOrchestratorAdapter, PLAN_WRITTEN_FILES_TRACE_MAX } from "@exaix/flow";
import type { IFlowStepRequest } from "@exaix/flow";
import { StrategyRegistry } from "@exaix/execution";
import { initTestDbService } from "@exaix/testing";
import { createMockConfig } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { PortalPermissionsService } from "@exaix/portal";
import { ExecutionStrategyName } from "@exaix/core";
import type { Config } from "@exaix/schemas/config.ts";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";

async function writeBlueprint(root: string, identityId: string): Promise<void> {
  const dir = join(root, "Blueprints", "Identities");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, `${identityId}.md`),
    `---\nname: ${identityId}\nmodel: gpt-4o-mini\nprovider: openai\ncapabilities: []\n---\nYou are a test agent.`,
  );
}

/** Registers a spy strategy that records the (context, options) it was called with. */
function registerSpy(
  strategyRegistry: StrategyRegistry,
  name: string,
  calls: Array<{ context: IExecutionContext; options: IAgentExecutionOptions }>,
): void {
  strategyRegistry.register({
    name,
    execute: (_blueprint, context, options) => {
      calls.push({ context, options });
      const result: IChangesetResult = {
        branch: "feat/spy",
        commit_sha: "0000000000000000000000000000000000000000",
        files_changed: [],
        description: "spy strategy ran for " + options.portal,
        tool_calls: 0,
        execution_time_ms: 1,
      };
      return Promise.resolve(result);
    },
  });
}

function makeStepRequest(overrides: Partial<IFlowStepRequest> = {}): IFlowStepRequest {
  return {
    userPrompt: "implement the feature",
    context: {},
    traceId: crypto.randomUUID(),
    requestId: "req-1",
    ...overrides,
  };
}

Deno.test("AgentOrchestratorAdapter.runWithStrategy: fails fast when construction dependencies are absent", async () => {
  const dbService = await initTestDbService();
  try {
    const adapter = new AgentOrchestratorAdapter(
      { run: () => Promise.reject(new Error("should not be called")) },
      join(dbService.tempDir, "Blueprints", "Identities"),
    );

    await assertRejects(
      () =>
        adapter.runWithStrategy!("test-agent", makeStepRequest({ portal: "workspace" }), ExecutionStrategyName.REACT),
      Error,
      "construction dependencies",
    );
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentOrchestratorAdapter.runWithStrategy: fails fast with a distinct error when the request has no portal", async () => {
  const dbService = await initTestDbService();
  try {
    const config: Config = createMockConfig(dbService.tempDir);
    const logger = new EventLogger({ db: dbService.db });
    const permissions = new PortalPermissionsService(config.portals!);
    await writeBlueprint(dbService.tempDir, "test-agent");

    const adapter = new AgentOrchestratorAdapter(
      { run: () => Promise.reject(new Error("should not be called")) },
      join(dbService.tempDir, "Blueprints", "Identities"),
      { config, db: dbService.db, logger, permissions },
    );

    const err = await assertRejects(
      () => adapter.runWithStrategy!("test-agent", makeStepRequest({ portal: undefined }), ExecutionStrategyName.REACT),
    );
    assertStringIncludes(String(err), "portal");
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentOrchestratorAdapter.runWithStrategy: dispatches through the forced strategy and bridges output", async () => {
  const dbService = await initTestDbService();
  try {
    const config: Config = createMockConfig(dbService.tempDir);
    const portalAlias = config.portals![0].alias;
    const logger = new EventLogger({ db: dbService.db });
    const permissions = new PortalPermissionsService(config.portals!);
    await writeBlueprint(dbService.tempDir, "test-agent");

    const calls: Array<{ context: IExecutionContext; options: IAgentExecutionOptions }> = [];
    const strategyRegistry = new StrategyRegistry();
    registerSpy(strategyRegistry, ExecutionStrategyName.REACT, calls);

    const adapter = new AgentOrchestratorAdapter(
      { run: () => Promise.reject(new Error("should not be called")) },
      join(dbService.tempDir, "Blueprints", "Identities"),
      { config, db: dbService.db, logger, permissions, strategyRegistry },
    );

    const traceId = crypto.randomUUID();
    const result = await adapter.runWithStrategy!(
      "test-agent",
      makeStepRequest({ portal: portalAlias, traceId, requestId: "req-bridge", userPrompt: "do the task" }),
      ExecutionStrategyName.REACT,
    );

    assertEquals(calls.length, 1);
    assertEquals(calls[0].context.trace_id, traceId);
    assertEquals(calls[0].context.request_id, "req-bridge");
    assertEquals(calls[0].context.request, "do the task");
    assertEquals(calls[0].context.plan, "do the task");
    assertEquals(calls[0].context.portal, portalAlias);
    assertEquals(calls[0].options.identity_id, "test-agent");
    assertEquals(calls[0].options.portal, portalAlias);
    assertEquals(calls[0].options.strategy, ExecutionStrategyName.REACT);

    // Output bridge: IChangesetResult.description -> IAgentExecutionResult.content
    assertEquals(result.content, "spy strategy ran for " + portalAlias);
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentOrchestratorAdapter.runWithStrategy: extracts the <content> block from a raw thought/content response (CliDelegateStrategy shape) instead of bridging the whole raw text", async () => {
  const dbService = await initTestDbService();
  try {
    const config: Config = createMockConfig(dbService.tempDir);
    const portalAlias = config.portals![0].alias;
    const logger = new EventLogger({ db: dbService.db });
    const permissions = new PortalPermissionsService(config.portals!);
    await writeBlueprint(dbService.tempDir, "test-agent");

    // Regression: CliDelegateStrategy sets description to the model's RAW response, but a
    // flow's final step output expects the <content> block extracted and parsed as JSON.
    const rawThoughtContent = "<thought>\nSome reasoning about the task.\n</thought>\n\n" +
      '<content>\n{"subject": "Flow Step Output", "steps": []}\n</content>';
    const strategyRegistry = new StrategyRegistry();
    strategyRegistry.register({
      name: ExecutionStrategyName.CLI_DELEGATE,
      execute: () =>
        Promise.resolve({
          branch: "feat/step",
          commit_sha: "0000000000000000000000000000000000000000",
          files_changed: [],
          description: rawThoughtContent,
          tool_calls: 1,
          execution_time_ms: 10,
        }),
    });

    const adapter = new AgentOrchestratorAdapter(
      { run: () => Promise.reject(new Error("should not be called")) },
      join(dbService.tempDir, "Blueprints", "Identities"),
      { config, db: dbService.db, logger, permissions, strategyRegistry },
    );

    const result = await adapter.runWithStrategy!(
      "test-agent",
      makeStepRequest({ portal: portalAlias }),
      ExecutionStrategyName.CLI_DELEGATE,
    );

    assertEquals(result.content, '{"subject": "Flow Step Output", "steps": []}');
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentOrchestratorAdapter.runWithStrategy: bridges the whole description unchanged when it carries no <content> wrapper", async () => {
  const dbService = await initTestDbService();
  try {
    const config: Config = createMockConfig(dbService.tempDir);
    const portalAlias = config.portals![0].alias;
    const logger = new EventLogger({ db: dbService.db });
    const permissions = new PortalPermissionsService(config.portals!);
    await writeBlueprint(dbService.tempDir, "test-agent");

    const calls: Array<{ context: IExecutionContext; options: IAgentExecutionOptions }> = [];
    const strategyRegistry = new StrategyRegistry();
    registerSpy(strategyRegistry, ExecutionStrategyName.REACT, calls);

    const adapter = new AgentOrchestratorAdapter(
      { run: () => Promise.reject(new Error("should not be called")) },
      join(dbService.tempDir, "Blueprints", "Identities"),
      { config, db: dbService.db, logger, permissions, strategyRegistry },
    );

    const result = await adapter.runWithStrategy!(
      "test-agent",
      makeStepRequest({ portal: portalAlias }),
      ExecutionStrategyName.REACT,
    );

    // No <thought>/<content> wrapper in "spy strategy ran for ..." — extraction must fall
    // back to the original text unchanged (parseXMLTags' own no-tags-found behavior).
    assertEquals(result.content, "spy strategy ran for " + portalAlias);
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentOrchestratorAdapter.runWithStrategy: two calls for different portals each build options/context scoped to their own portal", async () => {
  const dbService = await initTestDbService();
  try {
    const portalA = join(dbService.tempDir, "portal-a");
    const portalB = join(dbService.tempDir, "portal-b");
    await Deno.mkdir(portalA, { recursive: true });
    await Deno.mkdir(portalB, { recursive: true });

    const config: Config = createMockConfig(dbService.tempDir, {
      portals: [
        { alias: "portal-a", target_path: portalA, default_branch: "main", identities_allowed: ["*"], operations: [] },
        { alias: "portal-b", target_path: portalB, default_branch: "main", identities_allowed: ["*"], operations: [] },
      ],
    });
    const logger = new EventLogger({ db: dbService.db });
    const permissions = new PortalPermissionsService(config.portals!);
    await writeBlueprint(dbService.tempDir, "test-agent");

    const calls: Array<{ context: IExecutionContext; options: IAgentExecutionOptions }> = [];
    const strategyRegistry = new StrategyRegistry();
    registerSpy(strategyRegistry, ExecutionStrategyName.REACT, calls);

    const adapter = new AgentOrchestratorAdapter(
      { run: () => Promise.reject(new Error("should not be called")) },
      join(dbService.tempDir, "Blueprints", "Identities"),
      { config, db: dbService.db, logger, permissions, strategyRegistry },
    );

    await adapter.runWithStrategy!(
      "test-agent",
      makeStepRequest({ portal: "portal-a" }),
      ExecutionStrategyName.REACT,
    );
    await adapter.runWithStrategy!(
      "test-agent",
      makeStepRequest({ portal: "portal-b" }),
      ExecutionStrategyName.REACT,
    );

    assertEquals(calls.length, 2);
    assertEquals(calls[0].options.portal, "portal-a");
    assertEquals(calls[0].context.portal, "portal-a");
    assertEquals(calls[1].options.portal, "portal-b");
    assertEquals(calls[1].context.portal, "portal-b");
  } finally {
    await dbService.cleanup();
  }
});

/** Registers a strategy that writes a real file to the portal and reports it in files_changed. */
function registerFileWritingStrategy(
  strategyRegistry: StrategyRegistry,
  name: string,
  portalPath: string,
  relPath: string,
): void {
  strategyRegistry.register({
    name,
    execute: async () => {
      await Deno.mkdir(join(portalPath, "src"), { recursive: true });
      await Deno.writeTextFile(join(portalPath, relPath), `export const x = "${relPath}";\n`);
      const result: IChangesetResult = {
        branch: "feat/step",
        commit_sha: "0000000000000000000000000000000000000000",
        files_changed: [relPath],
        description: "wrote " + relPath,
        tool_calls: 1,
        execution_time_ms: 1,
      };
      return result;
    },
  });
}

async function initGitPortal(portalPath: string): Promise<void> {
  await Deno.mkdir(portalPath, { recursive: true });
  await new Deno.Command("git", { args: ["init"], cwd: portalPath }).output();
  await new Deno.Command("git", { args: ["config", "user.name", "Test"], cwd: portalPath }).output();
  await new Deno.Command("git", { args: ["config", "user.email", "test@exaix.local"], cwd: portalPath }).output();
  await Deno.writeTextFile(join(portalPath, "README.md"), "# Portal\n");
  await new Deno.Command("git", { args: ["add", "README.md"], cwd: portalPath }).output();
  await new Deno.Command("git", { args: ["commit", "-m", "init"], cwd: portalPath }).output();
}

Deno.test("AgentOrchestratorAdapter.runWithStrategy: two calls sharing a traceId accumulate planWrittenFiles (a later step doesn't revert an earlier step's uncommitted write)", async () => {
  const dbService = await initTestDbService();
  try {
    const portalPath = join(dbService.tempDir, "portal-shared-trace");
    await initGitPortal(portalPath);
    const config: Config = createMockConfig(dbService.tempDir, {
      portals: [{
        alias: "portal",
        target_path: portalPath,
        default_branch: "main",
        identities_allowed: ["*"],
        operations: [],
      }],
    });
    const logger = new EventLogger({ db: dbService.db });
    const permissions = new PortalPermissionsService(config.portals!);
    await writeBlueprint(dbService.tempDir, "test-agent");

    const strategyRegistry = new StrategyRegistry();
    registerFileWritingStrategy(strategyRegistry, ExecutionStrategyName.REACT, portalPath, "src/step1.ts");
    registerFileWritingStrategy(strategyRegistry, ExecutionStrategyName.CLI_DELEGATE, portalPath, "src/step2.ts");

    const adapter = new AgentOrchestratorAdapter(
      { run: () => Promise.reject(new Error("should not be called")) },
      join(dbService.tempDir, "Blueprints", "Identities"),
      { config, db: dbService.db, logger, permissions, strategyRegistry },
    );

    const traceId = crypto.randomUUID();
    // First call writes and leaves its file uncommitted, mirroring a real CliDelegateStrategy run.
    await adapter.runWithStrategy!(
      "test-agent",
      makeStepRequest({ portal: "portal", traceId }),
      ExecutionStrategyName.REACT,
    );
    // A second call (fresh AgentOrchestrator, same traceId) must not see the earlier still-dirty file as unauthorized.
    const result = await adapter.runWithStrategy!(
      "test-agent",
      makeStepRequest({ portal: "portal", traceId }),
      ExecutionStrategyName.CLI_DELEGATE,
    );
    assertEquals(result.content, "wrote src/step2.ts");

    // Both files must still be present (not reverted by a false-positive security violation).
    const step1Exists = await Deno.stat(join(portalPath, "src/step1.ts")).then(() => true).catch(() => false);
    const step2Exists = await Deno.stat(join(portalPath, "src/step2.ts")).then(() => true).catch(() => false);
    assertEquals(step1Exists, true);
    assertEquals(step2Exists, true);
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentOrchestratorAdapter.runWithStrategy: a different traceId does NOT inherit another flow run's planWrittenFiles", async () => {
  const dbService = await initTestDbService();
  try {
    const portalPath = join(dbService.tempDir, "portal-isolated-trace");
    await initGitPortal(portalPath);
    const config: Config = createMockConfig(dbService.tempDir, {
      portals: [{
        alias: "portal",
        target_path: portalPath,
        default_branch: "main",
        identities_allowed: ["*"],
        operations: [],
      }],
    });
    const logger = new EventLogger({ db: dbService.db });
    const permissions = new PortalPermissionsService(config.portals!);
    await writeBlueprint(dbService.tempDir, "test-agent");

    const strategyRegistry = new StrategyRegistry();
    registerFileWritingStrategy(strategyRegistry, ExecutionStrategyName.REACT, portalPath, "src/run-a.ts");
    registerFileWritingStrategy(strategyRegistry, ExecutionStrategyName.CLI_DELEGATE, portalPath, "src/run-b.ts");

    const adapter = new AgentOrchestratorAdapter(
      { run: () => Promise.reject(new Error("should not be called")) },
      join(dbService.tempDir, "Blueprints", "Identities"),
      { config, db: dbService.db, logger, permissions, strategyRegistry },
    );

    // Run A leaves its file uncommitted in the portal.
    await adapter.runWithStrategy!("test-agent", makeStepRequest({ portal: "portal" }), ExecutionStrategyName.REACT);
    // Run B is a DIFFERENT flow run (its own random traceId from makeStepRequest) — it must
    // NOT inherit run A's planWrittenFiles, so it correctly flags run A's leftover file.
    await assertRejects(
      () =>
        adapter.runWithStrategy!(
          "test-agent",
          makeStepRequest({ portal: "portal" }),
          ExecutionStrategyName.CLI_DELEGATE,
        ),
      Error,
      "Security violation",
    );
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentOrchestratorAdapter.runWithStrategy: evicts the least-recently-touched trace's planWrittenFiles entry once PLAN_WRITTEN_FILES_TRACE_MAX distinct trace_ids have been seen (post-gap Step 10, GAP-1)", async () => {
  const dbService = await initTestDbService();
  try {
    const portalPath = join(dbService.tempDir, "portal-eviction");
    const fillerPortalPath = join(dbService.tempDir, "portal-eviction-filler");
    await initGitPortal(portalPath);
    await initGitPortal(fillerPortalPath);
    const config: Config = createMockConfig(dbService.tempDir, {
      portals: [
        { alias: "portal", target_path: portalPath, default_branch: "main", identities_allowed: ["*"], operations: [] },
        {
          alias: "filler",
          target_path: fillerPortalPath,
          default_branch: "main",
          identities_allowed: ["*"],
          operations: [],
        },
      ],
    });
    const logger = new EventLogger({ db: dbService.db });
    const permissions = new PortalPermissionsService(config.portals!);
    await writeBlueprint(dbService.tempDir, "test-agent");

    const strategyRegistry = new StrategyRegistry();
    // The evictable trace writes a real, uncommitted file (observable eviction proof).
    // Filler traces target a SEPARATE, always-clean portal with a no-op spy — they must
    // never touch the "portal" alias, or they'd trip cross-trace isolation themselves.
    registerFileWritingStrategy(strategyRegistry, ExecutionStrategyName.REACT, portalPath, "src/evictable.ts");
    const fillerCalls: Array<{ context: IExecutionContext; options: IAgentExecutionOptions }> = [];
    registerSpy(strategyRegistry, ExecutionStrategyName.CLI_DELEGATE, fillerCalls);

    const adapter = new AgentOrchestratorAdapter(
      { run: () => Promise.reject(new Error("should not be called")) },
      join(dbService.tempDir, "Blueprints", "Identities"),
      { config, db: dbService.db, logger, permissions, strategyRegistry },
    );

    const evictedTraceId = crypto.randomUUID();
    // Leaves src/evictable.ts uncommitted in the portal, authorized under evictedTraceId.
    await adapter.runWithStrategy!(
      "test-agent",
      makeStepRequest({ portal: "portal", traceId: evictedTraceId }),
      ExecutionStrategyName.REACT,
    );

    // Touch PLAN_WRITTEN_FILES_TRACE_MAX brand-new trace_ids against the clean filler portal
    // (never touching evictedTraceId again) — this must push evictedTraceId's entry out once
    // the map is at capacity.
    for (let i = 0; i < PLAN_WRITTEN_FILES_TRACE_MAX; i++) {
      await adapter.runWithStrategy!(
        "test-agent",
        makeStepRequest({ portal: "filler", traceId: crypto.randomUUID() }),
        ExecutionStrategyName.CLI_DELEGATE,
      );
    }

    // A later call under the SAME evictedTraceId should now see src/evictable.ts (still
    // physically uncommitted) as unauthorized, because its planWrittenFiles entry was
    // evicted — proving eviction happened via the same mechanism cross-trace isolation uses.
    await assertRejects(
      () =>
        adapter.runWithStrategy!(
          "test-agent",
          makeStepRequest({ portal: "portal", traceId: evictedTraceId }),
          ExecutionStrategyName.CLI_DELEGATE,
        ),
      Error,
      "Security violation",
    );
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentOrchestratorAdapter.runWithStrategy: an actively-touched trace's planWrittenFiles entry is never evicted while it remains the most-recently-touched entry (post-gap Step 10, GAP-1 regression guard)", async () => {
  const dbService = await initTestDbService();
  try {
    const portalPath = join(dbService.tempDir, "portal-eviction-regression");
    const fillerPortalPath = join(dbService.tempDir, "portal-eviction-regression-filler");
    await initGitPortal(portalPath);
    await initGitPortal(fillerPortalPath);
    const config: Config = createMockConfig(dbService.tempDir, {
      portals: [
        { alias: "portal", target_path: portalPath, default_branch: "main", identities_allowed: ["*"], operations: [] },
        {
          alias: "filler",
          target_path: fillerPortalPath,
          default_branch: "main",
          identities_allowed: ["*"],
          operations: [],
        },
      ],
    });
    const logger = new EventLogger({ db: dbService.db });
    const permissions = new PortalPermissionsService(config.portals!);
    await writeBlueprint(dbService.tempDir, "test-agent");

    const strategyRegistry = new StrategyRegistry();
    // Filler calls target the separate, always-clean "filler" portal — see the eviction
    // test above for why they must not touch "portal" directly.
    registerFileWritingStrategy(strategyRegistry, ExecutionStrategyName.REACT, portalPath, "src/active.ts");
    const fillerCalls: Array<{ context: IExecutionContext; options: IAgentExecutionOptions }> = [];
    registerSpy(strategyRegistry, ExecutionStrategyName.CLI_DELEGATE, fillerCalls);

    const adapter = new AgentOrchestratorAdapter(
      { run: () => Promise.reject(new Error("should not be called")) },
      join(dbService.tempDir, "Blueprints", "Identities"),
      { config, db: dbService.db, logger, permissions, strategyRegistry },
    );

    const activeTraceId = crypto.randomUUID();
    // Leaves src/active.ts uncommitted in the portal, authorized under activeTraceId.
    await adapter.runWithStrategy!(
      "test-agent",
      makeStepRequest({ portal: "portal", traceId: activeTraceId }),
      ExecutionStrategyName.REACT,
    );

    // Interleave filler trace_ids with a re-touch of activeTraceId after every filler call,
    // so activeTraceId stays most-recently-used and must never become the eviction candidate.
    for (let i = 0; i < PLAN_WRITTEN_FILES_TRACE_MAX * 2; i++) {
      await adapter.runWithStrategy!(
        "test-agent",
        makeStepRequest({ portal: "filler", traceId: crypto.randomUUID() }),
        ExecutionStrategyName.CLI_DELEGATE,
      );
      await adapter.runWithStrategy!(
        "test-agent",
        makeStepRequest({ portal: "portal", traceId: activeTraceId }),
        ExecutionStrategyName.CLI_DELEGATE,
      );
    }

    // A final call under activeTraceId must still succeed — src/active.ts is still recorded as
    // authorized under its still-present planWrittenFiles entry.
    const result = await adapter.runWithStrategy!(
      "test-agent",
      makeStepRequest({ portal: "portal", traceId: activeTraceId }),
      ExecutionStrategyName.CLI_DELEGATE,
    );
    assertEquals(result.content, "spy strategy ran for portal");
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentOrchestratorAdapter.run: no-strategy path still calls the wrapped runner unchanged", async () => {
  const dbService = await initTestDbService();
  try {
    await writeBlueprint(dbService.tempDir, "test-agent");
    let runnerCalled = false;
    const adapter = new AgentOrchestratorAdapter(
      {
        run: () => {
          runnerCalled = true;
          return Promise.resolve({ thought: "t", content: "c", raw: "r" });
        },
      },
      join(dbService.tempDir, "Blueprints", "Identities"),
    );

    const result = await adapter.run("test-agent", makeStepRequest({ portal: "workspace" }));

    assertEquals(runnerCalled, true);
    assertEquals(result.content, "c");
  } finally {
    await dbService.cleanup();
  }
});
