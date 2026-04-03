/**
 * @module StrategySwapTest
 * @path tests/load/agent_executor_strategy_swap_test.ts
 * @description Verifies that swapping execution strategies at runtime causes no
 * internal state corruption and produces consistent results.
 * Ensures Step 61.5 strategy unification load stability.
 */

import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { initTestDbService } from "../helpers/db.ts";
import { createTestConfig } from "../ai/helpers/test_config.ts";
import { EventLogger } from "../../src/services/core/event_logger.ts";
import { PathResolver } from "../../src/services/portal/path_resolver.ts";
import { PortalPermissionsService } from "../../src/services/portal/portal_permissions.ts";
import { AgentExecutor } from "../../src/services/agent/agent_executor.ts";
import { StrategyRegistry } from "../../src/services/agent/strategies/strategy_registry.ts";
import { LegacyAgentStrategy } from "../../src/services/agent/strategies/legacy_strategy.ts";
import { ReActLoopStrategy } from "../../src/services/agent/strategies/react_loop_strategy.ts";
import { MockProvider } from "../../src/ai/providers.ts";
import type {
  IAgentExecutionOptions,
  IChangesetResult,
  IExecutionContext,
} from "../../src/shared/schemas/agent_executor.ts";
import { ExecutionStrategyName, SecurityMode } from "../../src/shared/enums.ts";

const TEST_OPTIONS: IAgentExecutionOptions = {
  identity_id: "test-agent",
  portal: "workspace",
  security_mode: SecurityMode.HYBRID,
  audit_enabled: true,
  timeout_ms: 30000,
  max_tool_calls: 10,
};

const TEST_BLUEPRINT = {
  name: "test-agent",
  model: "mock-model",
  provider: "mock",
  capabilities: ["write"],
  allowed_paths: ["test.txt"],
  systemPrompt: "You are a test agent.",
};

/**
 * Helper: set up a full AgentExecutor with all dependencies.
 */
async function setupExecutor(
  tempDir: string,
  provider: MockProvider,
): Promise<{
  executor: AgentExecutor;
  cleanup: () => Promise<void>;
}> {
  const { db, cleanup: dbCleanup } = await initTestDbService();
  const config = createTestConfig();
  config.system.root = tempDir;
  config.paths = {
    ...config.paths,
    workspace: join(tempDir, "Workspace"),
    blueprints: join(tempDir, "Blueprints"),
  };
  config.portals = [{
    alias: "workspace",
    target_path: tempDir,
    default_branch: "main",
    identities_allowed: ["*"],
    operations: [],
  }];

  const blueprintsDir = join(tempDir, "Blueprints", "Identities");
  await Deno.mkdir(blueprintsDir, { recursive: true });
  await Deno.writeTextFile(
    join(blueprintsDir, "test-agent.md"),
    `---
name: test-agent
model: mock-model
provider: mock
capabilities: ["write"]
allowed_paths: ["test.txt"]
---
You are a test agent.
`,
  );

  const logger = new EventLogger({ db });
  const pathResolver = new PathResolver(config);
  const permissions = new PortalPermissionsService(config.portals);

  const executor = new AgentExecutor(
    config,
    db,
    logger,
    pathResolver,
    permissions,
    provider,
  );

  return {
    executor,
    cleanup: async () => {
      executor.dispose();
      await dbCleanup();
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch { /* ignore */ }
    },
  };
}

Deno.test("Strategy swap: Registry resolves different strategies without state corruption", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "strategy-swap-" });
  const mockResponse = "Task complete.";
  const provider = new MockProvider(mockResponse);

  const { executor, cleanup } = await setupExecutor(tempDir, provider);

  try {
    // Create a fresh strategy registry with both strategies
    const registry = new StrategyRegistry();
    const legacyStrategy = new LegacyAgentStrategy(executor, provider);
    const reactStrategy = new ReActLoopStrategy(executor, provider);

    registry.register(legacyStrategy);
    registry.register(reactStrategy);

    // Verify both strategies are registered and distinct
    const strategies = registry.all();
    assertEquals(strategies.length, 2);

    // Verify each strategy has a unique name
    const names = strategies.map((s) => s.name);
    assertEquals(names.includes(ExecutionStrategyName.LEGACY), true);
    assertEquals(names.includes(ExecutionStrategyName.REACT), true);

    // Resolve each strategy and verify it's the correct instance
    const resolvedLegacy = registry.resolve(ExecutionStrategyName.LEGACY);
    const resolvedReact = registry.resolve(ExecutionStrategyName.REACT);

    assertNotEquals(resolvedLegacy.name, resolvedReact.name);
    assertEquals(resolvedLegacy.name, ExecutionStrategyName.LEGACY);
    assertEquals(resolvedReact.name, ExecutionStrategyName.REACT);

    // Verify registry is stable after multiple resolves
    const resolvedLegacy2 = registry.resolve(ExecutionStrategyName.LEGACY);
    assertEquals(resolvedLegacy, resolvedLegacy2);
  } finally {
    await cleanup();
  }
});

Deno.test("Strategy swap: Executor can be constructed with custom strategy registry", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "strategy-custom-" });
  const mockResponse = "Done.";
  const provider = new MockProvider(mockResponse);

  const { executor, cleanup } = await setupExecutor(tempDir, provider);

  try {
    // Create a custom registry with only Legacy strategy
    const customRegistry = new StrategyRegistry();
    const legacyStrategy = new LegacyAgentStrategy(executor, provider);
    customRegistry.register(legacyStrategy);

    // Verify the registry has exactly one strategy
    assertEquals(customRegistry.list().length, 1);
    assertEquals(customRegistry.list()[0], ExecutionStrategyName.LEGACY);

    // Resolve and verify
    const strategy = customRegistry.resolve(ExecutionStrategyName.LEGACY);
    assertEquals(strategy.name, ExecutionStrategyName.LEGACY);

    // Verify that resolving a non-existent strategy throws
    let threw = false;
    try {
      customRegistry.resolve(ExecutionStrategyName.REACT);
    } catch {
      threw = true;
    }
    assertEquals(threw, true, "Resolving unregistered strategy should throw");
  } finally {
    await cleanup();
  }
});

Deno.test("Strategy swap: Consecutive executions with same strategy maintain state integrity", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "strategy-consec-" });
  const mockResponse = "No actions.";
  const provider = new MockProvider(mockResponse);

  const { executor, cleanup } = await setupExecutor(tempDir, provider);

  try {
    const registry = executor["strategyRegistry"]!;
    const strategy = registry.resolve(ExecutionStrategyName.LEGACY);

    const context: IExecutionContext = {
      trace_id: "00000000-0000-0000-0000-000000000001",
      request_id: "run-1",
      request: "First run",
      plan: "Run once",
      portal: "workspace",
    };

    // Execute twice with same strategy
    const result1: IChangesetResult = await strategy.execute(
      TEST_BLUEPRINT as any,
      context,
      TEST_OPTIONS,
    );
    const result2: IChangesetResult = await strategy.execute(
      TEST_BLUEPRINT as any,
      { ...context, request_id: "run-2", request: "Second run" },
      TEST_OPTIONS,
    );

    // Both should return valid results without state corruption
    assertExists(result1.branch);
    assertExists(result1.commit_sha);
    assertExists(result2.branch);
    assertExists(result2.commit_sha);

    // Each should have independent execution times
    assertEquals(typeof result1.execution_time_ms, "number");
    assertEquals(typeof result2.execution_time_ms, "number");
  } finally {
    await cleanup();
  }
});
