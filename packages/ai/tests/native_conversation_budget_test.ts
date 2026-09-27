/**
 * @module NativeConversationMeasurementTest
 * @path packages/ai/tests/native_conversation_budget_test.ts
 * @description Checks complete native input measurement and wrapper forwarding without generation.
 * @architectural-layer Tests
 * @dependencies [@exaix/ai, @exaix/testing]
 * @related-files [packages/ai/src/native_conversation_budget.ts]
 */
import { assertEquals, assertExists } from "@std/assert";
import { measureNativeConversation } from "../src/native_conversation_budget.ts";
import { TracedProvider } from "../src/traced_provider.ts";
import { RateLimitedProvider } from "../src/rate_limited_provider.ts";
import { CircuitBreakerProvider } from "../src/circuit_breaker.ts";
import { createMockLogger, makeGenerateResult } from "@exaix/testing";
import type { IModelProvider } from "../src/types.ts";

Deno.test("native measurement counts wire framing, reasoning, tools and caller section boundaries", async () => {
  const tokenizer = {
    countTokens: (text: string) => Promise.resolve(text.length),
    countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((text) => text.length)),
  };
  const wire = {
    messages: [{ role: "user", content: "role task" }, { role: "assistant", reasoning_content: "reasoning" }],
    tools: [{ name: "read_file", description: "schema" }],
  };
  const measurement = await measureNativeConversation(tokenizer, "fixture", wire, [
    { section: "system", text: "role " },
    { section: "plan", text: "task" },
    { section: "loopHistory", text: JSON.stringify(wire.messages[1]) },
  ]);
  assertEquals(measurement.totalTokens, JSON.stringify(wire).length);
  assertEquals(measurement.sections.plan, 4);
  assertEquals(measurement.sections.loopHistory, JSON.stringify(wire.messages[1]).length);
  assertEquals(measurement.sections.system, measurement.totalTokens - 4 - measurement.sections.loopHistory);
});

Deno.test("tracing and rate limiting forward measurement without generation or lifecycle events", async () => {
  const measurement = {
    totalTokens: 5,
    sections: { system: 5, plan: 0, loopHistory: 0, skills: 0, memory: 0, portalKnowledge: 0 },
    tokenSource: "tokenizer_estimate" as const,
  };
  let generates = 0;
  const inner: IModelProvider = {
    id: "openai-chat-fixture",
    callCapabilities: {
      profile: "local-test",
      supportsThinking: true,
      supportedEffortTiers: ["low", "medium", "high"],
    },
    measureInputTokens: () => Promise.resolve(measurement),
    generate: () => {
      generates++;
      return Promise.resolve(makeGenerateResult("unused"));
    },
  };
  const logger = createMockLogger();
  const wrapped = new TracedProvider(
    new RateLimitedProvider(new CircuitBreakerProvider(inner), {
      maxCallsPerMinute: 2,
      maxTokensPerHour: 10,
      maxCostPerDay: 1,
      costPer1kTokens: 0,
    }),
    logger,
  );
  assertExists(wrapped.measureInputTokens);
  assertEquals(wrapped.callCapabilities, inner.callCapabilities);
  assertEquals(await wrapped.measureInputTokens("role", {}), measurement);
  assertEquals(generates, 0);
  assertEquals(logger.info.calls.length, 0);
});
