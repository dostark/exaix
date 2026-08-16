/**
 * @module TracedProviderTest
 * @path packages/ai/tests/traced_provider_test.ts
 * @description Verifies TracedProvider.generateStream emits the same started/completed/failed
 * event lifecycle that TracedProvider.generate already emits, hand-wrapped around the inner
 * provider's async generator (Phase 168 Step 6 remediation — LogGeneratorMethod cannot be used
 * here because it would need to reference `this.logger` at class-definition time).
 * @architectural-layer AI
 * @related-files ["packages/ai/src/traced_provider.ts", "packages/core/src/events/domain_event_types.ts"]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import { createMockLogger } from "@exaix/testing";
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

Deno.test("[TracedProvider.generateStream] emits started before the first yielded chunk", async () => {
  const logger = createMockLogger();
  const inner = createInnerProvider(["a", "b"]);
  const traced = new TracedProvider(inner, logger);

  const gen = traced.generateStream("prompt");
  const first = await gen.next();

  assertEquals(first.value, "a");
  assertEquals(logger.info.calls.length, 1);
  assertEquals(logger.info.calls[0].args[0], DomainEventType.LlmCallStarted);
  assertEquals(logger.info.calls[0].args[1], "mock-model");

  // Drain the rest so the completed event assertions in other tests are unaffected.
  await gen.next();
  await gen.next();
});

Deno.test("[TracedProvider.generateStream] emits completed with chunk count after normal exhaustion", async () => {
  const logger = createMockLogger();
  const inner = createInnerProvider(["a", "b", "c"]);
  const traced = new TracedProvider(inner, logger);

  const collected: string[] = [];
  for await (const chunk of traced.generateStream("prompt")) {
    collected.push(chunk);
  }

  assertEquals(collected, ["a", "b", "c"]);
  assertEquals(logger.info.calls.length, 2);
  assertEquals(logger.info.calls[0].args[0], DomainEventType.LlmCallStarted);
  assertEquals(logger.info.calls[1].args[0], DomainEventType.LlmStreamCompleted);
  const completedPayload = logger.info.calls[1].args[2] as LogMetadata;
  assertEquals(completedPayload.chunk_count, 3);
  assertEquals(typeof completedPayload.duration_ms, "number");
  assertEquals(logger.warn.calls.length, 0);
});

Deno.test("[TracedProvider.generateStream] emits failed when the inner provider does not support streaming", async () => {
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

  assertEquals(logger.info.calls.length, 1);
  assertEquals(logger.info.calls[0].args[0], DomainEventType.LlmCallStarted);
  assertEquals(logger.warn.calls.length, 1);
  assertEquals(logger.warn.calls[0].args[0], DomainEventType.LlmStreamFailed);
  const failedPayload = logger.warn.calls[0].args[2] as LogMetadata;
  assertEquals(failedPayload.error, "Inner provider does not support streaming");
});

Deno.test("[TracedProvider.generateStream] emits failed when the inner generator throws mid-iteration", async () => {
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
  assertEquals(logger.info.calls.length, 1);
  assertEquals(logger.info.calls[0].args[0], DomainEventType.LlmCallStarted);
  assertEquals(logger.warn.calls.length, 1);
  assertEquals(logger.warn.calls[0].args[0], DomainEventType.LlmStreamFailed);
  const failedPayload = logger.warn.calls[0].args[2] as LogMetadata;
  assertEquals(failedPayload.error, "mid-stream failure");
});
