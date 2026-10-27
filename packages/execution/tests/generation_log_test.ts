/**
 * @module GenerationLogTest
 * @path packages/execution/tests/generation_log_test.ts
 * @description The shared generation log writes one completed-generation event with the usage, cost and timing fields that the agent composer and the ReAct adapter report.
 * @architectural-layer Test
 * @related-files [packages/execution/src/generation_log.ts]
 */

import { assertEquals } from "@std/assert";
import { ActorType, AGENT_COMPOSER_ID, AGENT_GENERATION_COMPLETED, type ILogEvent, RunnerKind } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import { logGenerationCompleted } from "../src/generation_log.ts";

const USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

/** A logger that keeps every full event that reaches `log`. */
function recordingLogger(sink: ILogEvent[]): IEventLogger {
  const ignore = (): Promise<void> => Promise.resolve();
  const logger: IEventLogger = {
    log: (event) => {
      sink.push(event);
      return Promise.resolve();
    },
    info: ignore,
    warn: ignore,
    error: ignore,
    fatal: ignore,
    debug: ignore,
    child: () => logger,
  };
  return logger;
}

/** Logs one generation and returns the event that reached the logger. */
async function logged(usage: Parameters<typeof logGenerationCompleted>[5]): Promise<ILogEvent> {
  const events: ILogEvent[] = [];
  await logGenerationCompleted(recordingLogger(events), "trace-1", "coder", "gpt-x", "openai", usage);
  assertEquals(events.length, 1);
  return events[0];
}

Deno.test("a generation event carries the model, the token payload, the cost and the duration", async () => {
  const event = await logged({ ...USAGE, costUsd: 0.25, costSource: "tracked", durationMs: 1200 });
  assertEquals(event.action, AGENT_GENERATION_COMPLETED);
  assertEquals(event.target, "gpt-x");
  assertEquals(event.traceId, "trace-1");
  assertEquals(event.costUsd, 0.25);
  assertEquals(event.payload, {
    model: "gpt-x",
    provider: "openai",
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    cost_usd: 0.25,
    cost_source: "tracked",
    duration_ms: 1200,
  });
});

Deno.test("the event row names the composer runner, the service actor and the agent role", async () => {
  const event = await logged(USAGE);
  assertEquals(event.runnerId, AGENT_COMPOSER_ID);
  assertEquals(event.runnerKind, RunnerKind.AGENT_COMPOSER);
  assertEquals(event.actorType, ActorType.SERVICE);
  assertEquals(event.agentRole, "coder");
});

Deno.test("an unknown cost source records a null cost, and absent cost fields stay out of the payload", async () => {
  const unknownCost = await logged({ ...USAGE, costUsd: 0.5, costSource: "unknown" });
  assertEquals(unknownCost.costUsd, null);
  assertEquals(unknownCost.payload?.cost_source, "unknown");
  const bare = await logged(USAGE);
  assertEquals("cost_usd" in (bare.payload ?? {}), false);
  assertEquals("cost_source" in (bare.payload ?? {}), false);
});
