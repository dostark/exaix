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
import { AgentOrchestratorAdapter } from "@exaix/flow";
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
