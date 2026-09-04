/**
 * @module ReActLoopAdapterEventTest
 * @path packages/execution/tests/react_loop_adapter_event_test.ts
 * @description Phase 112 Step 3 — verifies `ReActLoopAdapter.logPromptAssembled` emits a real,
 * field-level `agent.prompt_assembled` event through a real `EventLogger`/test DB, with the
 * react discriminator, the target request ID, and the shared trace ID. Split out from
 * `react_loop_adapter_test.ts` (which covers the pre-existing `logAgentOutput`/
 * `logDynamicToolCall` methods) per the plan's own Planned Tests path.
 * @architectural-layer Execution
 * @related-files ["packages/execution/src/react_loop_adapter.ts"]
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import { EventLogger } from "@exaix/core/logger";
import { initTestDbService } from "@exaix/testing";
import type { Config } from "@exaix/schemas/config.ts";
import { RunnerKind } from "@exaix/core";
import { ReActLoopAdapter } from "../src/react_loop_adapter.ts";
import { OutputParser } from "../src/output_parser.ts";
import { ExecutionContextService } from "../src/execution_context_service.ts";

/** logPromptAssembled only touches `this.logger` — outputParser/ctx are structurally
 * required by the constructor but never exercised by this method. */
function createAdapter(config: Config, logger: EventLogger): ReActLoopAdapter {
  return new ReActLoopAdapter(
    new OutputParser(),
    new ExecutionContextService(config, logger, {}),
    logger,
  );
}

Deno.test("[ReActLoopAdapter] logPromptAssembled emits agent.prompt_assembled with the react discriminator, target request ID, and shared trace ID", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const adapter = createAdapter(config, logger);
    const traceId = crypto.randomUUID();

    await adapter.logPromptAssembled(traceId, "request-42", {
      prompt_kind: "react",
      iteration: 0,
      toolIds: ["read_file"],
      fragmentCount: 1,
      fragmentChars: 256,
      budgetChars: 12_000,
      truncated: false,
    });
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    const promptAssembled = activities.find((a) => a.action_type === DomainEventType.AgentPromptAssembled);
    assertExists(promptAssembled, "agent.prompt_assembled must be emitted");
    assertEquals(promptAssembled.target, "request-42");
    assertEquals(promptAssembled.trace_id, traceId);
    const payload = JSON.parse(promptAssembled.payload);
    assertEquals(payload.prompt_kind, "react");
    assertEquals(payload.iteration, 0);
    assertEquals(payload.toolIds, ["read_file"]);
    assertEquals(payload.fragmentCount, 1);
    assertEquals(payload.fragmentChars, 256);
    assertEquals(payload.budgetChars, 12000);
    assertEquals(payload.truncated, false);
  } finally {
    await cleanup();
  }
});

Deno.test("[ReActLoopAdapter] logGeneration logs runnerId/runnerKind as AGENT_COMPOSER_ID/RunnerKind.AGENT_COMPOSER, not the agentRole", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const adapter = createAdapter(config, logger);
    const traceId = crypto.randomUUID();

    await adapter.logGeneration(traceId, "senior-coder", "gpt-4o-mini", "openai", {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      costUsd: 0.01,
    });
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    const generation = activities.find((a) => a.action_type === "agent.generation_completed");
    assertExists(generation, "agent.generation_completed must be emitted");
    assertEquals(generation.agent_role, "senior-coder");
    assertEquals(generation.runner_kind, RunnerKind.AGENT_COMPOSER);
    assertEquals(generation.runner_kind, "agent-composer");
  } finally {
    await cleanup();
  }
});

Deno.test("[ReActLoopAdapter] logPromptAssembled propagates a logger rejection rather than swallowing it", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const loggerFailure = new Error("logger unavailable");
    // No try/catch in logPromptAssembled (or any sibling log method), so a rejection
    // must propagate to the caller rather than being silently swallowed.
    const rejectingLogger: IEventLogger = {
      log: () => Promise.reject(loggerFailure),
      info: () => Promise.reject(loggerFailure),
      warn: () => Promise.resolve(),
      error: () => Promise.resolve(),
      fatal: () => Promise.resolve(),
      debug: () => Promise.resolve(),
      child: () => rejectingLogger,
    };
    const adapter = new ReActLoopAdapter(
      new OutputParser(),
      new ExecutionContextService(config, rejectingLogger, {}),
      rejectingLogger,
    );

    await assertRejects(
      () =>
        adapter.logPromptAssembled(crypto.randomUUID(), "request-42", {
          prompt_kind: "react",
          iteration: 0,
          toolIds: ["read_file"],
          fragmentCount: 1,
          fragmentChars: 256,
          budgetChars: 12_000,
          truncated: false,
        }),
      Error,
      "logger unavailable",
    );
  } finally {
    await cleanup();
  }
});
