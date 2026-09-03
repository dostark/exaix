/**
 * @module EmbedAllTypesTest
 * @path packages/memory/tests/embedding/embed_all_types_test.ts
 * @description Verifies the generalized embed path: executions, patterns, decisions, and project overviews are embedded (not just learnings) with their respective identity keys (pattern/decision UUID ids, execution trace_id, `${portal}:overview` for overviews), are retrievable by meaning through a deterministic semantic mock provider, and bank write paths embed on mutation.
 * @architectural-layer Tests
 */
import { assert, assertEquals } from "@std/assert";
import type { IEmbeddingProvider } from "@exaix/ai";
import { MemoryType } from "@exaix/core";
import { MemoryBankService, ProviderEmbeddingService } from "@exaix/memory";
import type { IEmbeddableMemoryEntry } from "@exaix/core/types";
import { createMinimalExecutionMemory, initTestDbService } from "@exaix/testing";
import type { Config } from "@exaix/schemas/config.ts";

const SEMANTIC_DIM = 256;

/** Deterministic bag-of-words vector: each word hashes to one dimension, so texts sharing words have high cosine similarity and "retrievable by meaning" is observable without a live model. */
function semanticVector(text: string): number[] {
  const vector = new Array(SEMANTIC_DIM).fill(0);
  for (const word of text.toLowerCase().split(/\s+/).filter((w) => w.length > 0)) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    vector[Math.abs(hash) % SEMANTIC_DIM] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

/** Provider built on the bag-of-words vectors above. */
function semanticMockProvider(): IEmbeddingProvider {
  return {
    providerId: "mock-semantic",
    dimension: SEMANTIC_DIM,
    embed(texts: string[]): Promise<number[][]> {
      return Promise.resolve(texts.map((text) => semanticVector(text)));
    },
  };
}

function testConfig(tempDir: string): Config {
  return {
    system: { root: tempDir, log_level: "info", schema_version: "1.0.0", version: "1.0.0" },
    paths: {
      memory: "./Memory",
      blueprints: "./Blueprints",
      runtime: "./.exa",
      workspace: "./Workspace",
      portals: "./Portals",
      active: "Active",
      archive: "Archive",
      plans: "Plans",
      requests: "Requests",
      rejected: "Rejected",
      agents: "Agents",
      flows: "Blueprints/Flows",
      memoryProjects: "Projects",
      memoryExecution: "Execution",
      memoryIndex: "Index",
      memorySkills: "Skills",
      memoryPending: "Pending",
      memoryTasks: "Tasks",
      memoryGlobal: "Global",
    },
  } as Config;
}

async function createService(): Promise<{
  service: ProviderEmbeddingService;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-embed-all-test-" });
  return {
    service: new ProviderEmbeddingService(testConfig(tempDir), semanticMockProvider()),
    cleanup: () => Deno.remove(tempDir, { recursive: true }),
  };
}

Deno.test("patterns and decisions embed under their UUID ids and are retrievable by meaning", async () => {
  const { service, cleanup } = await createService();
  try {
    const patternEntry: IEmbeddableMemoryEntry = {
      kind: MemoryType.PATTERN,
      portal: "alpha",
      pattern: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Repository pattern for data access",
        description: "All database access goes through repository classes.",
        examples: [],
      },
    };
    const decisionEntry: IEmbeddableMemoryEntry = {
      kind: MemoryType.DECISION,
      portal: "alpha",
      decision: {
        id: "33333333-3333-4333-8333-333333333333",
        date: "2026-01-04",
        decision: "Adopt SQLite for local storage",
        rationale: "Lightweight with no external dependencies.",
      },
    };
    await service.embed(patternEntry);
    await service.embed(decisionEntry);

    const patternHits = await service.searchByEmbedding("repository classes database access", { threshold: 0.0 });
    assertEquals(patternHits[0]?.id, "22222222-2222-4222-8222-222222222222");
    assertEquals(patternHits[0]?.kind, "pattern");

    const decisionHits = await service.searchByEmbedding("SQLite local storage lightweight", { threshold: 0.0 });
    assertEquals(decisionHits[0]?.id, "33333333-3333-4333-8333-333333333333");
    assertEquals(decisionHits[0]?.kind, "decision");
  } finally {
    await cleanup();
  }
});

Deno.test("executions embed under their trace_id and are retrievable by meaning", async () => {
  const { service, cleanup } = await createService();
  try {
    const traceId = "44444444-4444-4444-8444-444444444444";
    await service.embed({
      kind: MemoryType.EXECUTION,
      execution: {
        ...createMinimalExecutionMemory({ trace_id: traceId }),
        summary: "Migrated the billing module to the repository pattern",
      },
    });

    const hits = await service.searchByEmbedding("billing module repository migration", { threshold: 0.0 });
    assertEquals(hits[0]?.id, traceId);
    assertEquals(hits[0]?.kind, "execution");
  } finally {
    await cleanup();
  }
});

Deno.test("project overviews embed under the synthetic portal key, chunked at the configured budget", async () => {
  const { service, cleanup } = await createService();
  try {
    const longOverview = "The alpha portal manages billing workflows. ".repeat(130); // > 2000 chars
    await service.embed({ kind: MemoryType.PROJECT, portal: "alpha", overview: longOverview });

    const stats = await service.getStats();
    assertEquals(stats.total >= 3, true, `expected chunked overview entries, got ${stats.total}`);
    assert(await service.getEmbedding("alpha:overview") !== null, "base overview key must exist");
    assert(await service.getEmbedding("alpha:overview:1") !== null, "second chunk key must exist");
    assert(await service.getEmbedding("alpha:overview:2") !== null, "third chunk key must exist");

    const hits = await service.searchByEmbedding("alpha portal billing workflows", { threshold: 0.0 });
    assertEquals(hits[0]?.kind, "project");
    assertEquals(hits[0]?.id.startsWith("alpha:overview"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("re-embedding an entry is idempotent and stale overview chunks are cleaned up", async () => {
  const { service, cleanup } = await createService();
  try {
    const longOverview = "Billing workflows for the alpha portal. ".repeat(60); // > 2000 chars
    await service.embed({ kind: MemoryType.PROJECT, portal: "alpha", overview: longOverview });
    const afterLong = (await service.getStats()).total;

    await service.embed({ kind: MemoryType.PROJECT, portal: "alpha", overview: longOverview });
    assertEquals((await service.getStats()).total, afterLong, "re-embedding must not duplicate manifest entries");

    await service.embed({ kind: MemoryType.PROJECT, portal: "alpha", overview: "Short overview now." });
    const afterShort = (await service.getStats()).total;
    assertEquals(afterShort, 1, "stale chunk entries must be deleted when the overview shrinks");
    assertEquals(await service.getEmbedding("alpha:overview:1"), null, "stale chunk file must be gone");
  } finally {
    await cleanup();
  }
});

Deno.test("bank write paths embed patterns, decisions, executions, and overviews on mutation", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const embeddingService = new ProviderEmbeddingService(config, semanticMockProvider());
    const bank = new MemoryBankService(config);
    bank.setEmbeddingService(embeddingService);

    await bank.createProjectMemory({
      portal: "wired-portal",
      overview: "The wired portal handles invoice processing end to end.",
      patterns: [],
      decisions: [],
      references: [],
    });
    await bank.addPattern("wired-portal", {
      name: "Invoice repository pattern",
      description: "Invoice persistence goes through repository classes.",
      examples: [],
    });
    await bank.addDecision("wired-portal", {
      date: "2026-02-01",
      decision: "Queue invoices through a job runner",
      rationale: "Decouples submission from processing spikes.",
    });
    await bank.createExecutionRecord({
      ...createMinimalExecutionMemory({ portal: "wired-portal", trace_id: "66666666-6666-4666-8666-666666666666" }),
      summary: "Processed the monthly invoice batch successfully",
    });

    const patternId = (await bank.getProjectMemory("wired-portal"))!.patterns[0].id!;
    const patternHits = await embeddingService.searchByEmbedding("invoice repository persistence", { threshold: 0.0 });
    assertEquals(patternHits[0]?.id, patternId);
    assertEquals(patternHits[0]?.kind, "pattern");

    const decisionHits = await embeddingService.searchByEmbedding("invoice job queue runner", { threshold: 0.0 });
    assertEquals(decisionHits[0]?.kind, "decision");

    const overviewHits = await embeddingService.searchByEmbedding("invoice processing portal", { threshold: 0.0 });
    assertEquals(overviewHits.some((hit) => hit.id === "wired-portal:overview"), true);

    const executionHits = await embeddingService.searchByEmbedding("monthly invoice batch processed", {
      threshold: 0.0,
    });
    assertEquals(executionHits[0]?.kind, "execution");
  } finally {
    await cleanup();
  }
});
