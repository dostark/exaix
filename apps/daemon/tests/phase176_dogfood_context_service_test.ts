/**
 * @module Phase176DogfoodContextServiceTest
 * @path apps/daemon/tests/phase176_dogfood_context_service_test.ts
 * @description Phase 176 Step 1: DogfoodContextService composes a bounded portal+memory
 * supplement onto the original prompt, aborts before capture when the immutable original
 * prompt alone exceeds the budget or contains a known secret, tolerates one source
 * failing without discarding the other's result, captures before returning the handle,
 * and emits typed capture/failure events.
 * @architectural-layer Tests
 * @related-files [apps/daemon/src/dogfood_context_service.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { ContextResultStatus } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core/types";
import type { ITokenizer } from "@exaix/core/func";
import type { IDogfoodContextInput, IPortalKnowledgeService, IScoredContextResult } from "@exaix/core/types";
import type { ContextRecord } from "@exaix/schemas/dogfood_context.ts";
import type { MemoryItem } from "@exaix/memory";
import {
  DogfoodContextInputBudgetExceededError,
  DogfoodContextKnownSecretInPromptError,
  DogfoodContextService,
  type IDogfoodMemorySource,
} from "../src/dogfood_context_service.ts";

/** One token per character — deterministic budget math in assertions. */
function charCountTokenizer(): ITokenizer {
  return {
    countTokens: (text: string) => Promise.resolve(text.length),
    countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((t) => t.length)),
  };
}

function makePortal(result: IScoredContextResult): Pick<IPortalKnowledgeService, "queryContext"> {
  return { queryContext: () => Promise.resolve(result) };
}

function makeMemory(items: MemoryItem[]): IDogfoodMemorySource {
  return { lookupMemories: () => Promise.resolve(items) };
}

function makeRecordStore(): { save: (record: ContextRecord) => Promise<void>; saved: ContextRecord[] } {
  const saved: ContextRecord[] = [];
  return {
    save: (record: ContextRecord) => {
      saved.push(record);
      return Promise.resolve();
    },
    saved,
  };
}

interface ILoggedEventCall {
  action: string;
  payload: LogMetadata;
}

class EventLoggerSpy implements IEventLogger {
  readonly calls: ILoggedEventCall[] = [];

  log(): Promise<void> {
    return Promise.resolve();
  }

  info(action: string, _target: string | null, payload?: LogMetadata): Promise<void> {
    this.calls.push({ action, payload: payload ?? {} });
    return Promise.resolve();
  }

  warn(): Promise<void> {
    return Promise.resolve();
  }

  error(): Promise<void> {
    return Promise.resolve();
  }

  fatal(): Promise<void> {
    return Promise.resolve();
  }

  debug(): Promise<void> {
    return Promise.resolve();
  }

  child(): IEventLogger {
    return this;
  }
}

function makeEventLoggerSpy(): EventLoggerSpy {
  return new EventLoggerSpy();
}

function makeInput(overrides: Partial<IDogfoodContextInput> = {}): IDogfoodContextInput {
  return {
    executionTraceId: "11111111-1111-4111-8111-111111111111",
    parentTraceId: "22222222-2222-4222-8222-222222222222",
    stepId: "step-1",
    sequence: 1,
    turn: 0,
    attempt: 1,
    surface: "session_delegate_cycle",
    model: "anthropic:claude-sonnet-5",
    originalPrompt: "Implement the scoped retrieval fix.",
    queryText: "Implement the scoped retrieval fix.",
    acceptanceCriteria: ["Tests pass"],
    ...overrides,
  };
}

const OK_PORTAL_RESULT: IScoredContextResult = {
  status: ContextResultStatus.OK,
  items: [{
    id: "chunk-1",
    source: "portal-a",
    text: "Architecture: uses hybrid retrieval.",
    score: 0.9,
    scoreKind: "cosine" as never,
  }],
};

const COLD_PORTAL_RESULT: IScoredContextResult = {
  status: ContextResultStatus.UNAVAILABLE,
  reason: "cold" as never,
  items: [],
};

const ONE_MEMORY_ITEM: MemoryItem[] = [
  {
    type: "pattern" as never,
    title: "Repository pattern",
    content: "Data access via repositories.",
    relevance: 0.8,
    source: "pattern:1",
  },
];

function makeService(overrides: {
  portal?: Pick<IPortalKnowledgeService, "queryContext">;
  memory?: IDogfoodMemorySource;
  logger?: IEventLogger;
  knownSecrets?: readonly string[];
} = {}) {
  const recordStore = makeRecordStore();
  const service = new DogfoodContextService({
    portalAlias: "portal-a",
    portalKnowledge: overrides.portal ?? makePortal(COLD_PORTAL_RESULT),
    memory: overrides.memory ?? makeMemory([]),
    tokenizer: charCountTokenizer(),
    recordStore,
    config: {
      portalTopK: 5,
      memoryTopK: 5,
      portalTokens: 200,
      memoryTokens: 200,
      maxInputTokens: 1000,
      outputReserveTokens: 100,
    },
    knownSecrets: overrides.knownSecrets ?? [],
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    logger: overrides.logger,
  });
  return { service, recordStore };
}

Deno.test("[DogfoodContextService] prepare returns a handle and captures a record on the happy path", async () => {
  const { service, recordStore } = makeService({
    portal: makePortal(OK_PORTAL_RESULT),
    memory: makeMemory(ONE_MEMORY_ITEM),
  });
  const handle = await service.prepare(makeInput());

  assert(handle.prompt.includes("Implement the scoped retrieval fix."), "original prompt must be preserved");
  assert(handle.prompt.includes("hybrid retrieval"), "portal supplement must be included");
  assert(handle.prompt.includes("Repository pattern"), "memory supplement must be included");
  assertEquals(recordStore.saved.length, 1);
  assertEquals(recordStore.saved[0].recordId, handle.recordId);
  assertEquals(recordStore.saved[0].promptText, handle.prompt);
});

Deno.test("[DogfoodContextService] disabled sources (cold portal, empty memory) still return just the original prompt", async () => {
  const { service } = makeService();
  const handle = await service.prepare(makeInput());
  assertEquals(handle.prompt, "Implement the scoped retrieval fix.");
});

Deno.test("[DogfoodContextService] one source failing does not discard the other's successful result", async () => {
  const failingMemory: IDogfoodMemorySource = {
    lookupMemories: () => Promise.reject(new Error("memory backend down")),
  };
  const { service } = makeService({ portal: makePortal(OK_PORTAL_RESULT), memory: failingMemory });

  const handle = await service.prepare(makeInput());
  assert(handle.prompt.includes("hybrid retrieval"), "portal result must still be included despite the memory failure");
});

Deno.test("[DogfoodContextService] rejects before capture when the original prompt alone exceeds the input budget", async () => {
  const { service, recordStore } = makeService();
  const hugePrompt = "x".repeat(2000); // exceeds maxInputTokens(1000) - outputReserveTokens(100)

  await assertRejects(
    () => service.prepare(makeInput({ originalPrompt: hugePrompt })),
    DogfoodContextInputBudgetExceededError,
  );
  assertEquals(recordStore.saved.length, 0, "capture must never happen when the budget is exceeded");
});

Deno.test("[DogfoodContextService] aborts rather than redacting when the original prompt contains a known secret", async () => {
  const { service, recordStore } = makeService({ knownSecrets: ["sk-secret-123"] });
  await assertRejects(
    () => service.prepare(makeInput({ originalPrompt: "Use sk-secret-123 to authenticate." })),
    DogfoodContextKnownSecretInPromptError,
  );
  assertEquals(recordStore.saved.length, 0);
});

Deno.test("[DogfoodContextService] aborts when a known secret is in the acceptance criteria", async () => {
  const { service } = makeService({ knownSecrets: ["sk-secret-123"] });
  await assertRejects(
    () => service.prepare(makeInput({ acceptanceCriteria: ["Verify sk-secret-123 rotates"] })),
    DogfoodContextKnownSecretInPromptError,
  );
});

Deno.test("[DogfoodContextService] redacts a known secret that appears only in the retrieved supplement", async () => {
  const secretPortal = makePortal({
    status: ContextResultStatus.OK,
    items: [{
      id: "c1",
      source: "portal-a",
      text: "token=sk-secret-123 in config",
      score: 0.9,
      scoreKind: "cosine" as never,
    }],
  });
  const { service } = makeService({ portal: secretPortal, knownSecrets: ["sk-secret-123"] });
  const handle = await service.prepare(makeInput());
  assert(!handle.prompt.includes("sk-secret-123"), "the secret must never appear in the sent prompt");
  assert(handle.prompt.includes("[REDACTED]"));
});

Deno.test("[DogfoodContextService] emits ContextCaptured with a non-negative duration on success", async () => {
  const logger = makeEventLoggerSpy();
  const { service } = makeService({ logger });
  await service.prepare(makeInput());

  const captured = logger.calls.find((c) => c.action === DomainEventType.ContextCaptured);
  assert(captured, "ContextCaptured must be emitted");
  const payload = captured!.payload as { duration_ms: number; model: string };
  assertEquals(payload.model, "anthropic:claude-sonnet-5");
  assert(payload.duration_ms >= 0);
});

Deno.test("[DogfoodContextService] emits ContextCaptureFailed (not ContextCaptured) when the budget is exceeded", async () => {
  const logger = makeEventLoggerSpy();
  const { service } = makeService({ logger });

  await assertRejects(() => service.prepare(makeInput({ originalPrompt: "x".repeat(2000) })));

  assertEquals(logger.calls.some((c) => c.action === DomainEventType.ContextCaptured), false);
  const failed = logger.calls.find((c) => c.action === DomainEventType.ContextCaptureFailed);
  assert(failed, "ContextCaptureFailed must be emitted");
});

Deno.test("[DogfoodContextService] close resolves without throwing (no live connection wired yet)", async () => {
  const { service } = makeService();
  await service.close("some-record-id", "completed" as never);
});
