/**
 * @module AgentCostLoggingIntegrationTest
 * @path tests/integration/agent/cost_logging_test.ts
 * @description Integration tests for Phase 62 Step 62.4 cost and usage logging in
 *   AgentExecutor. Phase 135 Step 12 (GAP-25) added a regression asserting the
 *   no-strategy-usage fallback journals cost_usd_estimate exactly 0 — never a
 *   heuristic-computed figure, now that estimateExecutionUsage() is removed.
 */

import { assertEquals, assertExists } from "@std/assert";
import { AgentExecutor } from "@exaix/execution";
import { StrategyRegistry } from "@exaix/execution";
import { ExecutionStrategyName, SecurityMode } from "@exaix/core";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_executor.ts";
import { setupAgentExecutorFixture } from "../helpers/agent_executor_fixture.ts";

Deno.test("AgentExecutor integration: logs usage.tokens and usage.cost_usd_estimate", async () => {
  const { db, config, logger, pathResolver, permissions, cleanup } = await setupAgentExecutorFixture();

  try {
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

    const executor = new AgentExecutor({ config, db, logger, pathResolver, permissions, strategyRegistry });

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

Deno.test("[regression] AgentExecutor: a step with no strategy-reported usage journals cost_usd_estimate exactly 0 (Step 12, GAP-25 — no heuristic computation anywhere in the call chain)", async () => {
  const { db, config, logger, pathResolver, permissions, cleanup } = await setupAgentExecutorFixture();

  try {
    const strategyRegistry = new StrategyRegistry();
    strategyRegistry.register({
      name: ExecutionStrategyName.LEGACY,
      execute: () =>
        Promise.resolve({
          branch: "feat/cost-removed-test",
          commit_sha: "0000000000000000000000000000000000000000",
          files_changed: [],
          description:
            "A long description that would previously have been folded into the heuristic character count used to estimate output tokens.",
          tool_calls: 0,
          execution_time_ms: 10,
        }),
    });

    const executor = new AgentExecutor({ config, db, logger, pathResolver, permissions, strategyRegistry });

    const traceId = crypto.randomUUID();
    const context: IExecutionContext = {
      trace_id: traceId,
      request_id: "cost-removed-1",
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
    assertEquals(
      payload.usage?.cost_usd_estimate,
      0,
      "cost must be exactly 0 (the honest absent-case default), never a heuristic-computed figure",
    );

    executor.dispose();
  } finally {
    await cleanup();
  }
});
