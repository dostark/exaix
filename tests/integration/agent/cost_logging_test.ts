/**
 * @module AgentCostLoggingIntegrationTest
 * @path tests/integration/agent/cost_logging_test.ts
 * @description Integration tests for Phase 62 Step 62.4 cost and usage logging in AgentExecutor.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { AgentExecutor } from "../../../src/services/agent/agent_executor.ts";
import { StrategyRegistry } from "../../../src/services/agent/strategies/strategy_registry.ts";
import { EventLogger } from "@exaix/core/logger/event_logger.ts";
import { PathResolver } from "../../../src/services/portal/path_resolver.ts";
import { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import { ExecutionStrategyName, PortalOperation, SecurityMode } from "@exaix/core";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_executor.ts";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import { TEST_DEFAULT_BRANCH } from "../../helpers/constants.ts";
import { initTestDbService } from "../../helpers/db.ts";

Deno.test("AgentExecutor integration: logs usage.tokens and usage.cost_usd_estimate", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();

  try {
    const portalDir = join(tempDir, "TestPortal");
    const blueprintsDir = join(tempDir, "Blueprints", "Identities");
    await Deno.mkdir(portalDir, { recursive: true });
    await Deno.mkdir(blueprintsDir, { recursive: true });

    await new Deno.Command("git", { args: ["init"], cwd: portalDir }).output();
    await new Deno.Command("git", { args: ["config", "user.name", "Test User"], cwd: portalDir }).output();
    await new Deno.Command("git", { args: ["config", "user.email", "test@exaix.local"], cwd: portalDir }).output();
    await Deno.writeTextFile(join(portalDir, "README.md"), "# Test\n");
    await new Deno.Command("git", { args: ["add", "README.md"], cwd: portalDir }).output();
    await new Deno.Command("git", { args: ["commit", "-m", "init"], cwd: portalDir }).output();

    await Deno.writeTextFile(
      join(blueprintsDir, "test-agent.md"),
      "---\nname: test-agent\nmodel: gpt-4o-mini\nprovider: openai\ncapabilities: []\n---\nYou are a test agent.",
    );

    const config = createTestConfig();
    config.system.root = tempDir;
    config.paths = {
      ...config.paths,
      workspace: join(tempDir, "Workspace"),
      memory: join(tempDir, "Memory"),
      runtime: join(tempDir, ".exa"),
      blueprints: join(tempDir, "Blueprints"),
    };
    config.portals = [
      {
        alias: "TestPortal",
        target_path: portalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        identities_allowed: ["*"],
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
      },
    ];

    const logger = new EventLogger({ db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService(config.portals);

    const strategyRegistry = new StrategyRegistry();
    strategyRegistry.register({
      name: ExecutionStrategyName.LEGACY,
      execute: () =>
        Promise.resolve({
          branch: "feat/cost-test",
          commit_sha: "0000000000000000000000000000000000000000",
          files_changed: [],
          description: "Cost logging functional test",
          tool_calls: 0,
          execution_time_ms: 10,
        }),
    });

    const executor = new AgentExecutor(
      config,
      db,
      logger,
      pathResolver,
      permissions,
      undefined,
      strategyRegistry,
    );

    const traceId = crypto.randomUUID();
    const context: IExecutionContext = {
      trace_id: traceId,
      request_id: "functional-cost-1",
      request: "Implement a tiny safe change",
      plan: "Create a minimal implementation",
      portal: "TestPortal",
    };
    const options: IAgentExecutionOptions = {
      identity_id: "test-agent",
      portal: "TestPortal",
      security_mode: SecurityMode.HYBRID,
      timeout_ms: 30000,
      max_tool_calls: 10,
      audit_enabled: true,
    };

    await executor.executeStep(context, options);
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    const complete = activities.find((a) => a.action_type === "agent.execution_completed");
    assertExists(complete);

    const payload = JSON.parse(complete.payload) as {
      usage?: { tokens?: number; cost_usd_estimate?: number };
    };
    assertExists(payload.usage);
    assertEquals(typeof payload.usage?.tokens, "number");
    assertEquals(typeof payload.usage?.cost_usd_estimate, "number");

    executor.dispose();
  } finally {
    await cleanup();
  }
});
