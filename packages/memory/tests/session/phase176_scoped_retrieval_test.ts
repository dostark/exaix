/**
 * @module Phase176ScopedRetrievalTest
 * @path packages/memory/tests/session/phase176_scoped_retrieval_test.ts
 * @description Phase 176 Step 1 GAP-5: SessionMemoryService.lookupMemories's optional
 * fourth `scope` argument must bind retrieval to one portal's own patterns, decisions,
 * overview and execution summaries plus APPROVED global learnings — denying another
 * portal's content and non-APPROVED entries — without starving authorized results, and
 * legacy unscoped (3-argument) calls must keep their existing cross-portal behavior.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import { ExecutionStatus, MemoryType } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { MemoryBankService, SessionMemoryService } from "@exaix/memory";
import type { IEmbeddableMemoryEntry, IEmbeddingSearchResult, IMemoryEmbeddingService } from "@exaix/core/types";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import { createSampleLearning, initTestDbService } from "@exaix/testing";

interface IKindResult {
  id: string;
  kind: MemoryType;
  similarity: number;
}

/** Mimics the real ProviderEmbeddingService's allowedIds contract: filters its fixed
 *  candidate set to the scope, so tests can assert unauthorized items never surface. */
function scopeAwareEmbedding(results: IKindResult[]): IMemoryEmbeddingService {
  return {
    initializeManifest: () => Promise.resolve(),
    embedLearning: () => Promise.resolve(),
    embed: (_entry: IEmbeddableMemoryEntry) => Promise.resolve(),
    searchByEmbedding: (
      _query: string,
      options?: { allowedIds?: ReadonlySet<string> },
    ): Promise<IEmbeddingSearchResult[]> => {
      const filtered = options?.allowedIds ? results.filter((r) => options.allowedIds!.has(r.id)) : results;
      return Promise.resolve(
        filtered.map(({ id, kind, similarity }) => ({ id, title: id, summary: id, similarity, kind })),
      );
    },
    getEmbedding: () => Promise.resolve(null),
    deleteEmbedding: () => Promise.resolve(),
    getStats: () => Promise.resolve({ total: results.length, generated_at: "" }),
  };
}

Deno.test("[SessionMemoryService] scoped lookup denies another portal's pattern even when it outranks the authorized one", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.createProjectMemory({
      portal: "portal-a",
      overview: "Portal A overview.",
      patterns: [{ name: "Portal A pattern", description: "Belongs to portal-a.", examples: [] }],
      decisions: [],
      references: [],
    });
    await bank.createProjectMemory({
      portal: "portal-b",
      overview: "Portal B overview.",
      patterns: [{ name: "Portal B pattern", description: "Belongs to portal-b.", examples: [] }],
      decisions: [],
      references: [],
    });
    // Force id backfill to persist (matches hybrid_fusion_test.ts) so the ids captured
    // below are the SAME stable ids every later parse (inside lookupMemories) returns.
    await bank.updateProjectMemory("portal-a", {});
    await bank.updateProjectMemory("portal-b", {});
    const patternA = (await bank.getProjectMemory("portal-a"))!.patterns[0];
    const patternB = (await bank.getProjectMemory("portal-b"))!.patterns[0];

    // portal-b's pattern outranks portal-a's on the vector signal — a scope-bypassing
    // implementation would let the higher-scored foreign item starve the authorized one.
    const embedding = scopeAwareEmbedding([
      { id: patternB.id!, kind: MemoryType.PATTERN, similarity: 0.99 },
      { id: patternA.id!, kind: MemoryType.PATTERN, similarity: 0.4 },
    ]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("pattern", undefined, undefined, {
      portalAlias: "portal-a",
    });
    const sources = memories.filter((m) => m.type === MemoryType.PATTERN).map((m) => m.source);

    assertEquals(sources.includes(`pattern:${patternA.id}`), true, "portal-a's own pattern must surface");
    assertEquals(sources.includes(`pattern:${patternB.id}`), false, "portal-b's pattern must never leak into scope");
  } finally {
    await cleanup();
  }
});

Deno.test("[SessionMemoryService] scoped lookup permits an APPROVED global learning alongside the portal's own content", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.createProjectMemory({
      portal: "portal-a",
      overview: "Portal A overview.",
      patterns: [],
      decisions: [],
      references: [],
    });
    const approved: ILearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Approved global insight",
      description: "Reviewed and approved, applies everywhere.",
      status: MemoryStatus.APPROVED,
    });
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(approved);

    const embedding = scopeAwareEmbedding([{ id: approved.id, kind: MemoryType.LEARNING, similarity: 0.9 }]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("insight", undefined, undefined, {
      portalAlias: "portal-a",
    });

    assertEquals(
      memories.some((m) => m.source === `learning:${approved.id}`),
      true,
      "an APPROVED global learning must remain reachable under a portal scope",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[SessionMemoryService] scoped lookup denies a PENDING global learning even when it outranks an APPROVED one", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.createProjectMemory({
      portal: "portal-a",
      overview: "Portal A overview.",
      patterns: [],
      decisions: [],
      references: [],
    });
    const pending: ILearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Pending unreviewed insight",
      description: "Never reviewed.",
      status: MemoryStatus.PENDING,
    });
    const approved: ILearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Approved insight",
      description: "Reviewed and approved.",
      status: MemoryStatus.APPROVED,
    });
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(pending);
    await bank.addGlobalLearning(approved);

    const embedding = scopeAwareEmbedding([
      { id: pending.id, kind: MemoryType.LEARNING, similarity: 0.99 },
      { id: approved.id, kind: MemoryType.LEARNING, similarity: 0.5 },
    ]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("insight", undefined, undefined, {
      portalAlias: "portal-a",
    });
    const sources = memories.filter((m) => m.type === MemoryType.LEARNING).map((m) => m.source);

    assertEquals(sources.includes(`learning:${approved.id}`), true);
    assertEquals(sources.includes(`learning:${pending.id}`), false, "a PENDING learning must never surface");
  } finally {
    await cleanup();
  }
});

Deno.test("[SessionMemoryService] scoped lookup permits the portal's own execution summaries", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.createProjectMemory({
      portal: "portal-a",
      overview: "Portal A overview.",
      patterns: [],
      decisions: [],
      references: [],
    });
    const traceId = crypto.randomUUID();
    await bank.createExecutionRecord({
      trace_id: traceId,
      request_id: crypto.randomUUID(),
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: ExecutionStatus.COMPLETED,
      portal: "portal-a",
      agent_role: "senior-coder",
      summary: "Implemented the scoped retrieval fix.",
      context_files: [],
      context_portals: [],
      changes: { files_created: [], files_modified: [], files_deleted: [] },
    });

    const embedding = scopeAwareEmbedding([{ id: traceId, kind: MemoryType.EXECUTION, similarity: 0.9 }]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("scoped retrieval", undefined, undefined, {
      portalAlias: "portal-a",
    });

    assertEquals(
      memories.some((m) => m.type === MemoryType.EXECUTION && m.source === `execution:${traceId}`),
      true,
      "the portal's own execution summary must be retrievable under scope",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[SessionMemoryService] scoped lookup rejects a zero-limit/invalid config rather than silently returning everything", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.createProjectMemory({
      portal: "portal-a",
      overview: "Portal A overview.",
      patterns: [{ name: "Portal A pattern", description: "Belongs to portal-a.", examples: [] }],
      decisions: [],
      references: [],
    });

    const embedding = scopeAwareEmbedding([]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("pattern", undefined, { topK: 0 }, {
      portalAlias: "portal-a",
    });

    assertEquals(memories, [], "topK: 0 must yield zero results, not the unfiltered full set");
  } finally {
    await cleanup();
  }
});

Deno.test("[SessionMemoryService] scoped lookup never expands links, even when expandLinks: true is requested", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.createProjectMemory({
      portal: "portal-a",
      overview: "Portal A overview.",
      patterns: [],
      decisions: [],
      references: [],
    });
    // Neither title/description shares a keyword with the other, and the query below
    // only names source's marker — target is reachable ONLY via the link, never via
    // its own vector or keyword signal, isolating this test to expansion behavior.
    const source: ILearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Zephyrtoken marker entry",
      description: "Links to a related item.",
      status: MemoryStatus.APPROVED,
    });
    const target: ILearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Completely unrelated topic",
      description: "Should never surface except through expansion.",
      status: MemoryStatus.APPROVED,
    });
    source.links = [{ target_id: target.id, type: "related_to" }];
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(source);
    await bank.addGlobalLearning(target);

    const embedding = scopeAwareEmbedding([{ id: source.id, kind: MemoryType.LEARNING, similarity: 0.9 }]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("zephyrtoken", undefined, { expandLinks: true }, {
      portalAlias: "portal-a",
    });

    assertEquals(
      memories.some((m) => m.source === `learning:${target.id}`),
      false,
      "link expansion must never run for a scoped lookup, regardless of the expandLinks flag",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[SessionMemoryService] legacy unscoped (3-argument) call keeps its existing cross-portal behavior", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.createProjectMemory({
      portal: "portal-a",
      overview: "Portal A overview.",
      patterns: [{ name: "Portal A pattern", description: "Belongs to portal-a.", examples: [] }],
      decisions: [],
      references: [],
    });
    await bank.createProjectMemory({
      portal: "portal-b",
      overview: "Portal B overview.",
      patterns: [{ name: "Portal B pattern", description: "Belongs to portal-b.", examples: [] }],
      decisions: [],
      references: [],
    });
    await bank.updateProjectMemory("portal-a", {});
    await bank.updateProjectMemory("portal-b", {});
    const patternA = (await bank.getProjectMemory("portal-a"))!.patterns[0];
    const patternB = (await bank.getProjectMemory("portal-b"))!.patterns[0];

    const embedding = scopeAwareEmbedding([
      { id: patternA.id!, kind: MemoryType.PATTERN, similarity: 0.9 },
      { id: patternB.id!, kind: MemoryType.PATTERN, similarity: 0.8 },
    ]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    // No 4th argument — the pre-existing 3-argument call shape.
    const memories = await sessionMemory.lookupMemories("pattern", undefined);
    const sources = memories.filter((m) => m.type === MemoryType.PATTERN).map((m) => m.source);

    assertEquals(sources.includes(`pattern:${patternA.id}`), true);
    assertEquals(sources.includes(`pattern:${patternB.id}`), true, "unscoped calls must still see both portals");
  } finally {
    await cleanup();
  }
});
