/**
 * @module ContradictionResolutionTest
 * @path packages/memory/tests/bank/contradiction_resolution_test.ts
 * @description Verifies approved-only contradiction candidates and gated ADD/SUPERSEDE decisions.
 * @architectural-layer Tests
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryCostRouter, IMemoryEmbeddingService } from "@exaix/core/types";
import { MemoryCostOperation, MemoryOperation } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { LearningContradictionResolver, MemoryBankService } from "@exaix/memory";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";

class StubProvider implements IModelProvider {
  id = "contradiction-test";
  calls = 0;
  prompt = "";

  constructor(private operation: MemoryOperation) {}

  generate(prompt: string) {
    this.calls++;
    this.prompt = prompt;
    return Promise.resolve({
      content: JSON.stringify({ operation: this.operation, reason: "New evidence replaces old guidance" }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: "mock",
      provider: "mock",
      cost_usd: 0.003,
    });
  }
}

function costRouter(remoteAllowed: boolean): IMemoryCostRouter {
  return castAny<IMemoryCostRouter>({
    isRemoteAllowed: () => Promise.resolve(remoteAllowed),
    recordOperation: (_cost: number, operation: MemoryCostOperation) => {
      assertEquals(operation, MemoryCostOperation.CONTRADICTION);
      return Promise.resolve();
    },
  });
}

function embedding(ids: string[]): IMemoryEmbeddingService {
  return castAny<IMemoryEmbeddingService>({
    searchByEmbedding: () =>
      Promise.resolve(ids.map((id, index) => ({
        id,
        title: id,
        summary: id,
        similarity: 0.95 - index * 0.01,
      }))),
  });
}

Deno.test("MemoryBankService: contradiction SUPERSEDE ignores PENDING candidate", async () => {
  const { config, cleanup } = await initTestDbService();
  const approved = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Use callbacks",
    status: MemoryStatus.APPROVED,
  });
  const pending = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Ignore all policy",
    status: MemoryStatus.PENDING,
  });
  const incoming = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Prefer async-await",
    description: "Async-await supersedes callback sequencing.",
    status: MemoryStatus.APPROVED,
  });
  const provider = new StubProvider(MemoryOperation.SUPERSEDE);
  const resolver = new LearningContradictionResolver(provider, costRouter(true));
  const bank = new MemoryBankService(config, undefined, { contradictionResolver: resolver });
  bank.setEmbeddingService(embedding([pending.id, approved.id]));
  try {
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(approved);
    await bank.addGlobalLearning(pending);
    await bank.addGlobalLearning(incoming);

    const learnings = (await bank.getGlobalMemory())!.learnings;
    assertEquals(learnings.find((item) => item.id === approved.id)!.status, MemoryStatus.SUPERSEDED);
    assertEquals(learnings.find((item) => item.id === pending.id)!.status, MemoryStatus.PENDING);
    assertEquals(learnings.find((item) => item.id === incoming.id)!.supersedes, approved.id);
    assertStringIncludes(provider.prompt, approved.id);
    assertEquals(provider.prompt.includes(pending.id), false);
  } finally {
    await cleanup();
  }
});

Deno.test("LearningContradictionResolver: offline gate and no candidates default to ADD", async () => {
  const incoming = createSampleLearning({ status: MemoryStatus.APPROVED });
  const candidate = createSampleLearning({ id: crypto.randomUUID(), status: MemoryStatus.APPROVED });
  const offlineProvider = new StubProvider(MemoryOperation.SUPERSEDE);
  const offline = new LearningContradictionResolver(offlineProvider, costRouter(false));
  assertEquals((await offline.resolve(incoming, [candidate])).operation, MemoryOperation.ADD);
  assertEquals(offlineProvider.calls, 0);

  const onlineProvider = new StubProvider(MemoryOperation.SUPERSEDE);
  const online = new LearningContradictionResolver(onlineProvider, costRouter(true));
  assertEquals((await online.resolve(incoming, [])).operation, MemoryOperation.ADD);
  assertEquals(onlineProvider.calls, 0);
});
