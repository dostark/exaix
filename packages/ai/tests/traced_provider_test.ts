/**
 * @module TracedProviderTest
 * @path packages/ai/tests/traced_provider_test.ts
 * @description Verifies TracedProvider.generateStream emits its started/completed/failed/
 * cancelled event lifecycle via @LogGeneratorMethod's invocation-time logger resolver and
 * per-phase lifecycle actions (Phase 168 Step 12 resolution — the resolver form plus
 * ILifecycleActions removed the class-definition-time binding and single-action blockers).
 * @architectural-layer AI
 * @related-files ["packages/ai/src/traced_provider.ts", "packages/core/src/events/domain_event_types.ts"]
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import { createMockLogger, initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { TracedProvider } from "../src/traced_provider.ts";
import type { IModelProvider } from "../src/types.ts";
import type { LogMetadata } from "@exaix/core/types";

function createInnerProvider(
  chunks: string[],
  options: { throwOnGuard?: boolean; throwMidStream?: boolean } = {},
): IModelProvider {
  return {
    id: "mock-model",
    generate: () => {
      throw new Error("not used in this test");
    },
    generateStream: options.throwOnGuard ? undefined : async function* () {
      for (const [index, chunk] of chunks.entries()) {
        if (options.throwMidStream && index === chunks.length - 1) {
          throw new Error("mid-stream failure");
        }
        yield chunk;
      }
    },
  };
}

Deno.test("[TracedProvider.generateStream] emits started (debug level) before the first yielded chunk", async () => {
  const logger = createMockLogger();
  const inner = createInnerProvider(["a", "b"]);
  const traced = new TracedProvider(inner, logger);

  const gen = traced.generateStream("prompt");
  const first = await gen.next();

  assertEquals(first.value, "a");
  assertEquals(logger.debug.calls.length, 1);
  assertEquals(logger.debug.calls[0].args[0], DomainEventType.LlmCallStarted);
  const startedPayload = logger.debug.calls[0].args[2] as LogMetadata;
  assertEquals(startedPayload.prompt_length, "prompt".length);

  // Drain the rest so the completed event assertions in other tests are unaffected.
  await gen.next();
  await gen.next();
});

Deno.test("[TracedProvider.generateStream] emits completed (info level) with chunk count after normal exhaustion", async () => {
  const logger = createMockLogger();
  const inner = createInnerProvider(["a", "b", "c"]);
  const traced = new TracedProvider(inner, logger);

  const collected: string[] = [];
  for await (const chunk of traced.generateStream("prompt")) {
    collected.push(chunk);
  }

  assertEquals(collected, ["a", "b", "c"]);
  assertEquals(logger.info.calls.length, 1);
  assertEquals(logger.info.calls[0].args[0], DomainEventType.LlmStreamCompleted);
  const completedPayload = logger.info.calls[0].args[2] as LogMetadata;
  assertEquals(completedPayload.chunk_count, 3);
  assertEquals(typeof completedPayload.duration_ms, "number");
  assertEquals(logger.warn.calls.length, 0);
});

Deno.test("[TracedProvider.generateStream] emits failed (error level) when the inner provider does not support streaming", async () => {
  const logger = createMockLogger();
  const inner = createInnerProvider([], { throwOnGuard: true });
  const traced = new TracedProvider(inner, logger);

  await assertRejects(
    async () => {
      for await (const _chunk of traced.generateStream("prompt")) {
        // never reached
      }
    },
    Error,
    "Inner provider does not support streaming",
  );

  assertEquals(logger.debug.calls.length, 1);
  assertEquals(logger.error.calls.length, 1);
  assertEquals(logger.error.calls[0].args[0], DomainEventType.LlmStreamFailed);
  const failedPayload = logger.error.calls[0].args[2] as LogMetadata;
  assertEquals(failedPayload.error, "Inner provider does not support streaming");
});

Deno.test("[TracedProvider.generateStream] emits failed (error level) when the inner generator throws mid-iteration", async () => {
  const logger = createMockLogger();
  const inner = createInnerProvider(["a", "b"], { throwMidStream: true });
  const traced = new TracedProvider(inner, logger);

  const collected: string[] = [];
  await assertRejects(
    async () => {
      for await (const chunk of traced.generateStream("prompt")) {
        collected.push(chunk);
      }
    },
    Error,
    "mid-stream failure",
  );

  assertEquals(collected, ["a"]);
  assertEquals(logger.debug.calls.length, 1);
  assertEquals(logger.error.calls.length, 1);
  assertEquals(logger.error.calls[0].args[0], DomainEventType.LlmStreamFailed);
  const failedPayload = logger.error.calls[0].args[2] as LogMetadata;
  assertEquals(failedPayload.error, "mid-stream failure");
});

Deno.test("[TracedProvider] shares a canonical trace ID across generate lifecycle events", async () => {
  const logger = createMockLogger();
  const result = {
    content: "ok",
    model: "mock-model",
    provider: "mock",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  };
  const inner = { ...createInnerProvider([]), generate: () => Promise.resolve(result) };
  const traced = new TracedProvider(inner, logger);

  await traced.generate("prompt");

  assertEquals(logger.info.calls.length, 2);
  assertEquals(logger.info.calls[0].args[3], logger.info.calls[1].args[3]);
  assertEquals(typeof logger.info.calls[0].args[3], "string");
});

Deno.test("[TracedProvider.generateStream] emits cancellation with the operation trace ID on early return", async () => {
  const logger = createMockLogger();
  const traced = new TracedProvider(createInnerProvider(["a", "b"]), logger);
  const stream = traced.generateStream("prompt");

  await stream.next();
  await stream.return(undefined);

  assertEquals(logger.warn.calls.length, 1);
  assertEquals(logger.warn.calls[0].args[0], DomainEventType.LlmStreamCancelled);
  assertEquals(logger.warn.calls[0].args[3], logger.debug.calls[0].args[3]);
});

Deno.test("[TracedProvider.generate] emits llm.call.started and llm.call.completed with real field-level payloads (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const result = {
      content: "ok",
      model: "mock-model",
      provider: "mock",
      usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
      cost_usd: 0.001234,
    };
    const inner = { ...createInnerProvider([]), generate: () => Promise.resolve(result) };
    const traced = new TracedProvider(inner, logger);

    await traced.generate("a real prompt");
    await db.waitForFlush();

    const startedRows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? ORDER BY timestamp DESC LIMIT 1",
    ).all(DomainEventType.LlmCallStarted) as Array<{ payload: string }>;
    assertEquals(startedRows.length, 1, "llm.call.started must be logged exactly once");
    const startedPayload = JSON.parse(startedRows[0].payload);
    assertEquals(startedPayload.prompt_length, "a real prompt".length);
    assertEquals(startedPayload.model, "mock-model");

    const completedRows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? ORDER BY timestamp DESC LIMIT 1",
    ).all(DomainEventType.LlmCallCompleted) as Array<{ payload: string }>;
    assertEquals(completedRows.length, 1, "llm.call.completed must be logged exactly once");
    const completedPayload = JSON.parse(completedRows[0].payload);
    assertEquals(completedPayload.prompt_tokens, 3);
    assertEquals(completedPayload.completion_tokens, 5);
    assertEquals(completedPayload.total_tokens, 8);
    assertEquals(completedPayload.cost_usd, 0.001234);
  } finally {
    await cleanup();
  }
});

Deno.test("[TracedProvider.generate] emits llm.call.failed with a real field-level payload when the inner provider throws (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const inner = {
      ...createInnerProvider([]),
      generate: () => Promise.reject(new Error("mock provider unavailable")),
    };
    const traced = new TracedProvider(inner, logger);

    await assertRejects(() => traced.generate("prompt"), Error, "mock provider unavailable");
    await db.waitForFlush();

    const failedRows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? ORDER BY timestamp DESC LIMIT 1",
    ).all(DomainEventType.LlmCallFailed) as Array<{ payload: string }>;
    assertEquals(failedRows.length, 1, "llm.call.failed must be logged exactly once");
    const failedPayload = JSON.parse(failedRows[0].payload);
    assertEquals(failedPayload.error, "mock provider unavailable");
    assertEquals(failedPayload.error_type, "Error");
  } finally {
    await cleanup();
  }
});

Deno.test("[TracedProvider.generateStream] emits llm.stream.completed with a real field-level payload after normal exhaustion (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const inner = createInnerProvider(["a", "b", "c"]);
    const traced = new TracedProvider(inner, logger);

    const collected: string[] = [];
    for await (const chunk of traced.generateStream("prompt")) {
      collected.push(chunk);
    }
    assertEquals(collected, ["a", "b", "c"]);
    await db.waitForFlush();

    const completedRows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? ORDER BY timestamp DESC LIMIT 1",
    ).all(DomainEventType.LlmStreamCompleted) as Array<{ payload: string }>;
    assertEquals(completedRows.length, 1, "llm.stream.completed must be logged exactly once");
    const completedPayload = JSON.parse(completedRows[0].payload);
    assertEquals(completedPayload.chunk_count, 3);
    assertEquals(typeof completedPayload.duration_ms, "number");
  } finally {
    await cleanup();
  }
});

Deno.test("[TracedProvider.generateStream] emits llm.stream.failed with a real field-level payload when the inner provider does not support streaming (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const inner = createInnerProvider([], { throwOnGuard: true });
    const traced = new TracedProvider(inner, logger);

    await assertRejects(
      async () => {
        for await (const _chunk of traced.generateStream("prompt")) {
          // never reached
        }
      },
      Error,
      "Inner provider does not support streaming",
    );
    await db.waitForFlush();

    const failedRows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? ORDER BY timestamp DESC LIMIT 1",
    ).all(DomainEventType.LlmStreamFailed) as Array<{ payload: string }>;
    assertEquals(failedRows.length, 1, "llm.stream.failed must be logged exactly once");
    const failedPayload = JSON.parse(failedRows[0].payload);
    assertEquals(failedPayload.error, "Inner provider does not support streaming");
  } finally {
    await cleanup();
  }
});

Deno.test("[TracedProvider.generateStream] emits llm.stream.failed with a real field-level payload when the inner generator throws mid-iteration (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const inner = createInnerProvider(["a", "b"], { throwMidStream: true });
    const traced = new TracedProvider(inner, logger);

    const collected: string[] = [];
    await assertRejects(
      async () => {
        for await (const chunk of traced.generateStream("prompt")) {
          collected.push(chunk);
        }
      },
      Error,
      "mid-stream failure",
    );
    assertEquals(collected, ["a"]);
    await db.waitForFlush();

    const failedRows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? ORDER BY timestamp DESC LIMIT 1",
    ).all(DomainEventType.LlmStreamFailed) as Array<{ payload: string }>;
    assertEquals(failedRows.length, 1, "llm.stream.failed must be logged exactly once");
    const failedPayload = JSON.parse(failedRows[0].payload);
    assertEquals(failedPayload.error, "mid-stream failure");
  } finally {
    await cleanup();
  }
});

Deno.test("[TracedProvider.generateStream] emits llm.stream.cancelled with a real field-level payload on early consumer cancellation (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const traced = new TracedProvider(createInnerProvider(["a", "b"]), logger);
    const stream = traced.generateStream("prompt");

    await stream.next();
    await stream.return(undefined);
    await db.waitForFlush();

    const cancelledRows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? ORDER BY timestamp DESC LIMIT 1",
    ).all(DomainEventType.LlmStreamCancelled) as Array<{ payload: string }>;
    assertEquals(cancelledRows.length, 1, "llm.stream.cancelled must be logged exactly once");
    const cancelledPayload = JSON.parse(cancelledRows[0].payload);
    assertExists(cancelledPayload.duration_ms, "llm.stream.cancelled payload should include duration_ms");
    assertEquals(typeof cancelledPayload.duration_ms, "number");
  } finally {
    await cleanup();
  }
});
