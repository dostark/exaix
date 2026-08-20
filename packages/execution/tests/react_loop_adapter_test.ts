/**
 * @module ReActLoopAdapterTest
 * @path packages/execution/tests/react_loop_adapter_test.ts
 * @description Verifies ReActLoopAdapter.logAgentOutput and .logDynamicToolCall emit
 * agent.output and dynamic_tool_call with real, field-level payloads through a real
 * EventLogger/db — the first test file of any kind for this class, and the first
 * positive (non-zero-count), field-level verification of dynamic_tool_call anywhere
 * in the suite (Phase 169 Step 3 / pre-gap-analysis GAP-2: moved off the provider-live
 * flow_strategy_react.yaml scenario since both methods are directly callable).
 * @architectural-layer Execution
 * @related-files ["packages/execution/src/react_loop_adapter.ts"]
 */

import { assertEquals, assertExists } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { initTestDbService } from "@exaix/testing";
import type { Config } from "@exaix/schemas/config.ts";
import { ReActLoopAdapter } from "../src/react_loop_adapter.ts";
import { OutputParser } from "../src/output_parser.ts";
import { ExecutionContextService } from "../src/execution_context_service.ts";

/**
 * logAgentOutput/logDynamicToolCall only touch `this.logger` — outputParser/ctx are
 * structurally required by the constructor but never exercised by either method. Both
 * have fully-optional-or-defaulted constructors, so real instances are constructed
 * directly rather than stubbed/cast.
 */
function createAdapter(config: Config, logger: EventLogger): ReActLoopAdapter {
  return new ReActLoopAdapter(
    new OutputParser(),
    new ExecutionContextService(config, logger, {}),
    logger,
  );
}

Deno.test("[ReActLoopAdapter] logAgentOutput emits agent.output with a real, field-level payload", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const adapter = createAdapter(config, logger);
    const traceId = crypto.randomUUID();

    await adapter.logAgentOutput(traceId, "the agent's real output text");
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    const agentOutput = activities.find((a) => a.action_type === DomainEventType.AgentOutput);
    assertExists(agentOutput, "agent.output must be emitted");
    const payload = JSON.parse(agentOutput.payload);
    assertEquals(payload.output, "the agent's real output text");
  } finally {
    await cleanup();
  }
});

Deno.test("[ReActLoopAdapter] logDynamicToolCall emits dynamic_tool_call with a real, positive, field-level payload", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const adapter = createAdapter(config, logger);
    const traceId = crypto.randomUUID();

    await adapter.logDynamicToolCall(traceId, "read_file", { path: "src/index.ts" }, "read 42 lines", 2);
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    const dynamicToolCall = activities.find((a) => a.action_type === DomainEventType.AgentDynamicToolCall);
    assertExists(dynamicToolCall, "dynamic_tool_call must be emitted with a real, positive occurrence");
    const payload = JSON.parse(dynamicToolCall.payload);
    assertEquals(payload.tool, "read_file");
    assertEquals(payload.args, { path: "src/index.ts" });
    assertEquals(payload.resultSummary, "read 42 lines");
    assertEquals(payload.iteration, 2);
  } finally {
    await cleanup();
  }
});
