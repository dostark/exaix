/**
 * @module StrategyOverrideTest
 * @path packages/execution/tests/agents/strategy_override_test.ts
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/src/strategies/strategy_registry.ts]
 * @architectural-layer Services
 * @description Phase 159 Step 2: `options.strategy` forces a strategy on `executeStep`
 * regardless of the blueprint's own `capabilities`, while `applyBlueprintToolScope`'s
 * tool-narrowing and the permission check still run unconditionally. Uses spy strategies
 * registered on a custom `StrategyRegistry` (the same pattern `agent_composer_test.ts`
 * already uses) rather than real ReAct/MCP/CliDelegate strategies, so the test has no
 * subprocess or live-provider dependency.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AgentComposer, StrategyRegistry } from "@exaix/execution";
import { initTestDbService } from "@exaix/testing";
import { createMockConfig } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { ExecutionStrategyName } from "@exaix/core";
import type { Config } from "@exaix/schemas/config.ts";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";

interface IBlueprintExtraFields {
  permitted_tools?: string[];
}

async function writeBlueprint(
  root: string,
  capabilities: string[],
  extra: IBlueprintExtraFields = {},
): Promise<void> {
  const dir = join(root, "Blueprints", "Agents");
  await Deno.mkdir(dir, { recursive: true });
  const extraLines = Object.entries(extra).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
  await Deno.writeTextFile(
    join(dir, "test-agent.md"),
    `---\nname: test-agent\nmodel: gpt-4o-mini\nprovider: openai\ncapabilities: ${
      JSON.stringify(capabilities)
    }\n${extraLines}\n---\nYou are a test agent.`,
  );
}

/** Registers a spy strategy that records the `options` it was called with. */
function registerSpy(strategyRegistry: StrategyRegistry, name: string, calls: IAgentExecutionOptions[]): void {
  strategyRegistry.register({
    name,
    execute: (_blueprint, _context, options) => {
      calls.push(options);
      const result: IChangesetResult = {
        branch: "feat/spy",
        commit_sha: "0000000000000000000000000000000000000000",
        files_changed: [],
        description: "spy strategy ran",
        tool_calls: 0,
        execution_time_ms: 1,
      };
      return Promise.resolve(result);
    },
  });
}

Deno.test("AgentComposer.executeStep: options.strategy=mcp forces MCP dispatch even when capabilities only list react", async () => {
  const dbService = await initTestDbService();
  try {
    const config: Config = createMockConfig(dbService.tempDir);
    const portalAlias = config.portals![0].alias;
    await writeBlueprint(dbService.tempDir, ["react"]);

    const mcpCalls: IAgentExecutionOptions[] = [];
    const reactCalls: IAgentExecutionOptions[] = [];
    const strategyRegistry = new StrategyRegistry();
    registerSpy(strategyRegistry, ExecutionStrategyName.MCP, mcpCalls);
    registerSpy(strategyRegistry, ExecutionStrategyName.REACT, reactCalls);

    const logger = new EventLogger({ db: dbService.db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService(config.portals!);
    const executor = new AgentComposer({
      config,
      db: dbService.db,
      logger,
      pathResolver,
      permissions,
      strategyRegistry,
    });

    const context: IExecutionContext = {
      trace_id: crypto.randomUUID(),
      request_id: "req-override-mcp",
      request: "Fix the bug",
      plan: "Step 1",
      portal: portalAlias,
    };

    await executor.executeStep(context, {
      portal: portalAlias,
      agent_role: "test-agent",
      strategy: ExecutionStrategyName.MCP,
    });

    assertEquals(mcpCalls.length, 1);
    assertEquals(reactCalls.length, 0);

    executor.dispose();
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentComposer.executeStep: options.strategy=cli_delegate forces CLI_DELEGATE dispatch even when capabilities only list react", async () => {
  const dbService = await initTestDbService();
  try {
    const config: Config = createMockConfig(dbService.tempDir);
    const portalAlias = config.portals![0].alias;
    await writeBlueprint(dbService.tempDir, ["react"]);

    const cliDelegateCalls: IAgentExecutionOptions[] = [];
    const reactCalls: IAgentExecutionOptions[] = [];
    const strategyRegistry = new StrategyRegistry();
    registerSpy(strategyRegistry, ExecutionStrategyName.CLI_DELEGATE, cliDelegateCalls);
    registerSpy(strategyRegistry, ExecutionStrategyName.REACT, reactCalls);

    const logger = new EventLogger({ db: dbService.db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService(config.portals!);
    const executor = new AgentComposer({
      config,
      db: dbService.db,
      logger,
      pathResolver,
      permissions,
      strategyRegistry,
    });

    const context: IExecutionContext = {
      trace_id: crypto.randomUUID(),
      request_id: "req-override-clidelegate",
      request: "Fix the bug",
      plan: "Step 1",
      portal: portalAlias,
    };

    await executor.executeStep(context, {
      portal: portalAlias,
      agent_role: "test-agent",
      strategy: ExecutionStrategyName.CLI_DELEGATE,
    });

    assertEquals(cliDelegateCalls.length, 1);
    assertEquals(reactCalls.length, 0);

    executor.dispose();
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentComposer.executeStep: absent options.strategy keeps capability-based dispatch (react agent role -> REACT)", async () => {
  const dbService = await initTestDbService();
  try {
    const config: Config = createMockConfig(dbService.tempDir);
    const portalAlias = config.portals![0].alias;
    await writeBlueprint(dbService.tempDir, ["react"]);

    const reactCalls: IAgentExecutionOptions[] = [];
    const mcpCalls: IAgentExecutionOptions[] = [];
    const strategyRegistry = new StrategyRegistry();
    registerSpy(strategyRegistry, ExecutionStrategyName.REACT, reactCalls);
    registerSpy(strategyRegistry, ExecutionStrategyName.MCP, mcpCalls);

    const logger = new EventLogger({ db: dbService.db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService(config.portals!);
    const executor = new AgentComposer({
      config,
      db: dbService.db,
      logger,
      pathResolver,
      permissions,
      strategyRegistry,
    });

    const context: IExecutionContext = {
      trace_id: crypto.randomUUID(),
      request_id: "req-no-override",
      request: "Fix the bug",
      plan: "Step 1",
      portal: portalAlias,
    };

    // No `strategy` in options — capability-based dispatch must still resolve REACT.
    await executor.executeStep(context, {
      portal: portalAlias,
      agent_role: "test-agent",
    });

    assertEquals(reactCalls.length, 1);
    assertEquals(mcpCalls.length, 0);

    executor.dispose();
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentComposer.executeStep: applyBlueprintToolScope still narrows permitted_tools under a strategy override", async () => {
  const dbService = await initTestDbService();
  try {
    const config: Config = createMockConfig(dbService.tempDir);
    const portalAlias = config.portals![0].alias;
    // Blueprint declares a narrow permitted_tools allowlist.
    await writeBlueprint(dbService.tempDir, ["react"], { permitted_tools: ["read_file"] });

    const mcpCalls: IAgentExecutionOptions[] = [];
    const strategyRegistry = new StrategyRegistry();
    registerSpy(strategyRegistry, ExecutionStrategyName.MCP, mcpCalls);

    const logger = new EventLogger({ db: dbService.db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService(config.portals!);
    const executor = new AgentComposer({
      config,
      db: dbService.db,
      logger,
      pathResolver,
      permissions,
      strategyRegistry,
    });

    const context: IExecutionContext = {
      trace_id: crypto.randomUUID(),
      request_id: "req-override-toolscope",
      request: "Fix the bug",
      plan: "Step 1",
      portal: portalAlias,
    };

    await executor.executeStep(context, {
      portal: portalAlias,
      agent_role: "test-agent",
      strategy: ExecutionStrategyName.MCP,
      // Caller asks for a broader set — the blueprint's own allowlist must still win.
      permitted_tools: ["read_file", "write_file", "delete_file"],
    });

    assertEquals(mcpCalls.length, 1);
    assertEquals(mcpCalls[0].permitted_tools, ["read_file"]);

    executor.dispose();
  } finally {
    await dbService.cleanup();
  }
});
