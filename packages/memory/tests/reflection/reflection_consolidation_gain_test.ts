/**
 * @module ReflectionConsolidationGainTest
 * @path packages/memory/tests/reflection/reflection_consolidation_gain_test.ts
 * @description Measures Phase 148's `consolidation_gain` metric: distinct-fact recall/precision@k
 *   over a fixed query, before vs after a real `MemoryReflectionService` merge pass. Recall/precision
 *   alone cannot show a duplicate-driven quality problem (a redundant duplicate IS relevant, just
 *   repeats a fact already covered), so ground truth is scored per distinct fact a retrieved title
 *   maps to, not per id — this is what a top-k budget consumed by near-duplicates actually costs,
 *   and what Step 4/7's dedup merge is for. LLM-free (cost router denies remote): isolates the
 *   deterministic merge phase from synthesis/prune, matching Step 25's offline-fallback precedent.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import { MemoryStatus } from "@exaix/core/status";
import { MemoryBankService, MemoryReflectionService, SessionMemoryService } from "@exaix/memory";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";

const RETRIEVAL_QUERY = "How do I make network calls resilient to transient failures?";

const RETRY_TITLE = "Retry flaky network calls";
const RETRY_DUP_TITLE = "Retry flaky network requests";
const CIRCUIT_TITLE = "Use circuit breakers for repeated network failures";
const NOISE_TITLE = "Prefer named exports over default exports";

const GROUND_TRUTH_FACT_COUNT = 2; // { retry-backoff, circuit-breaker }

/** Classifies a retrieved title by the distinct fact it covers; the near-duplicate title maps to
 *  the same fact as its canonical counterpart, so retrieving both never counts as two facts. */
function factIdOf(title: string): string | undefined {
  if (title === RETRY_TITLE || title === RETRY_DUP_TITLE) return "retry-backoff";
  if (title === CIRCUIT_TITLE) return "circuit-breaker";
  return undefined;
}

function distinctFactScore(titles: string[], k: number): { recall: number; precision: number } {
  const topK = titles.slice(0, k);
  const distinctFacts = new Set(topK.map(factIdOf).filter((fact): fact is string => fact !== undefined));
  return { recall: distinctFacts.size / GROUND_TRUTH_FACT_COUNT, precision: distinctFacts.size / k };
}

/** Resolves live against the bank's current APPROVED learnings by exact title, so it tracks the
 *  reflection pass's newly-minted merged-learning id automatically instead of predicting the
 *  `crypto.randomUUID()` it will get. */
function titleKeyedEmbedding(bank: MemoryBankService): IMemoryEmbeddingService {
  const approvedByTitle = async (title: string) => {
    const mem = await bank.getGlobalMemory();
    return (mem?.learnings ?? []).find((l) => l.title === title && l.status === MemoryStatus.APPROVED);
  };
  const asResult = (l: { id: string; title: string; description: string }, similarity: number) => ({
    id: l.id,
    title: l.title,
    summary: l.description,
    similarity,
    kind: "learning",
  });
  return castAny<IMemoryEmbeddingService>({
    initializeManifest: () => Promise.resolve(),
    embedLearning: () => Promise.resolve(),
    embed: () => Promise.resolve(),
    searchByEmbedding: async (query: string) => {
      if (query.startsWith(RETRY_TITLE)) {
        const other = await approvedByTitle(RETRY_DUP_TITLE);
        return other ? [asResult(other, 0.95)] : [];
      }
      if (query.startsWith(RETRY_DUP_TITLE)) {
        const other = await approvedByTitle(RETRY_TITLE);
        return other ? [asResult(other, 0.95)] : [];
      }
      if (query.startsWith(CIRCUIT_TITLE) || query.startsWith(NOISE_TITLE)) return [];
      if (query === RETRIEVAL_QUERY) {
        const results = [];
        const retry = await approvedByTitle(RETRY_TITLE);
        if (retry) results.push(asResult(retry, 0.95));
        const dup = await approvedByTitle(RETRY_DUP_TITLE);
        if (dup) results.push(asResult(dup, 0.9));
        const circuit = await approvedByTitle(CIRCUIT_TITLE);
        if (circuit) results.push(asResult(circuit, 0.7));
        return results;
      }
      return [];
    },
    getEmbedding: () => Promise.resolve(null),
    deleteEmbedding: () => Promise.resolve(),
    getStats: () => Promise.resolve({ total: 0, generated_at: "" }),
  });
}

Deno.test("reflection merge improves distinct-fact recall/precision@k by reclaiming a top-k slot a near-duplicate was consuming", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();

    await bank.addGlobalLearning(createSampleLearning({
      id: crypto.randomUUID(),
      title: RETRY_TITLE,
      description: "Use exponential backoff for flaky network calls to avoid cascading failures.",
      status: MemoryStatus.APPROVED,
      quality_score: 0.9,
    }));
    await bank.addGlobalLearning(createSampleLearning({
      id: crypto.randomUUID(),
      title: RETRY_DUP_TITLE,
      description: "Apply exponential backoff for flaky network requests to avoid cascading failures.",
      status: MemoryStatus.APPROVED,
      quality_score: 0.6,
    }));
    await bank.addGlobalLearning(createSampleLearning({
      id: crypto.randomUUID(),
      title: CIRCUIT_TITLE,
      description: "Trip a circuit breaker after repeated network failures to fail fast.",
      status: MemoryStatus.APPROVED,
      quality_score: 0.8,
    }));
    await bank.addGlobalLearning(createSampleLearning({
      id: crypto.randomUUID(),
      title: NOISE_TITLE,
      description: "Named exports are easier to refactor and tree-shake than default exports.",
      status: MemoryStatus.APPROVED,
      quality_score: 0.5,
    }));

    const embedding = titleKeyedEmbedding(bank);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const before = await sessionMemory.lookupMemories(RETRIEVAL_QUERY, undefined, { topK: 2 });
    const beforeScore = distinctFactScore(before.map((m) => m.title), 2);

    const reflection = new MemoryReflectionService({
      provider: castAny({ id: "unused", generate: () => Promise.reject(new Error("must not call the LLM")) }),
      skillsService: castAny({ getSkill: () => Promise.resolve(null) }),
      memoryBank: bank,
      embeddingService: embedding,
      proposalWriter: castAny({
        createProposal: () => Promise.reject(new Error("no synthesis expected under a denied cost router")),
        listPending: () => Promise.resolve([]),
      }),
      costRouter: castAny({ isRemoteAllowed: () => Promise.resolve(false) }),
    });
    const result = await reflection.runReflectionCycle();
    assertEquals(result.merged_count, 1, "the near-duplicate pair must merge deterministically");
    assertEquals(result.synthesised_count, 0, "cost router denies remote — no LLM synthesis pass");

    const after = await sessionMemory.lookupMemories(RETRIEVAL_QUERY, undefined, { topK: 2 });
    const afterScore = distinctFactScore(after.map((m) => m.title), 2);

    assertEquals(
      beforeScore,
      { recall: 0.5, precision: 0.5 },
      "before merge: the duplicate crowds out circuit-breaker",
    );
    assertEquals(afterScore, { recall: 1, precision: 1 }, "after merge: the reclaimed slot surfaces circuit-breaker");
    assertEquals(afterScore.recall > beforeScore.recall, true, "consolidation_gain (recall) must be positive");
    assertEquals(afterScore.precision > beforeScore.precision, true, "consolidation_gain (precision) must be positive");
  } finally {
    await cleanup();
  }
});
