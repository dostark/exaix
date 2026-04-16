/**
 * @module KnowledgePersistenceTest
 * @path tests/services/portal_knowledge/knowledge_persistence_test.ts
 * @description Unit tests for knowledge_persistence: saveKnowledge writes
 * knowledge.json atomically and conditionally updates MemoryBankService Markdown
 * files; loadKnowledge reads and validates knowledge.json.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { loadKnowledge, saveKnowledge } from "../../../src/services/portal_knowledge/knowledge_persistence.ts";
import type { IMemoryBankService } from "../../../src/shared/interfaces/i_memory_bank_service.ts";
import type { IPortalKnowledge } from "../../../src/shared/schemas/portal_knowledge.ts";
import type { IPattern, IProjectMemory } from "../../../src/shared/schemas/memory_bank.ts";
import { PortalAnalysisMode } from "../../../src/shared/enums.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeKnowledge(overrides: Partial<IPortalKnowledge> = {}): IPortalKnowledge {
  return {
    portal: "test-portal",
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "## Overview\n\nThis is a test codebase.",
    layers: [],
    keyFiles: [
      { path: "src/main.ts", role: "entrypoint", description: "Main entry point" },
    ],
    conventions: [
      {
        name: "*.service.ts",
        description: "Service files follow a consistent naming convention",
        evidenceCount: 3,
        confidence: "medium",
        examples: ["auth.service.ts"],
        category: "naming",
      },
    ],
    dependencies: [],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    stats: {
      totalFiles: 10,
      totalDirectories: 3,
      extensionDistribution: { ".ts": 8, ".json": 2 },
    },
    metadata: {
      durationMs: 100,
      mode: PortalAnalysisMode.QUICK,
      filesScanned: 10,
      filesRead: 5,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock MemoryBankService helpers
// ---------------------------------------------------------------------------

type IMemoryBankCalls = {
  getProjectMemory: string[];
  createProjectMemory: IProjectMemory[];
  updateProjectMemory: Array<{
    portal: string;
    updates: Partial<Omit<IProjectMemory, "portal">>;
  }>;
  addPattern: Array<{ portal: string; pattern: IPattern }>;
};

function makeMockMemoryBank(
  initialMemory?: IProjectMemory | null,
): IMemoryBankService & { calls: IMemoryBankCalls; stored: IProjectMemory | null } {
  let stored: IProjectMemory | null = initialMemory ?? null;
  const calls: IMemoryBankCalls = {
    getProjectMemory: [],
    createProjectMemory: [],
    updateProjectMemory: [],
    addPattern: [],
  };

  return {
    calls,
    get stored() {
      return stored;
    },
    getProjectMemory: (portal: string) => {
      calls.getProjectMemory.push(portal);
      return Promise.resolve(stored);
    },
    createProjectMemory: (mem: IProjectMemory) => {
      calls.createProjectMemory.push(mem);
      stored = mem;
      return Promise.resolve();
    },
    updateProjectMemory: (
      portal: string,
      updates: Partial<Omit<IProjectMemory, "portal">>,
    ) => {
      calls.updateProjectMemory.push({ portal, updates });
      if (stored) {
        stored = { ...stored, ...updates };
      }
      return Promise.resolve();
    },
    addPattern: (portal: string, pattern: IPattern) => {
      calls.addPattern.push({ portal, pattern });
      return Promise.resolve();
    },
    addDecision: () => Promise.resolve(),
    createExecutionRecord: () => Promise.resolve(),
    getExecutionByTraceId: () => Promise.resolve(null),
    getExecutionHistory: () => Promise.resolve([]),
    getGlobalMemory: () => Promise.resolve(null),
    getProjects: () => Promise.resolve([]),
  } as Partial<IMemoryBankService> as IMemoryBankService & {
    calls: IMemoryBankCalls;
    stored: IProjectMemory | null;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("[KnowledgePersistence] saves knowledge.json atomically", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const memoryBank = makeMockMemoryBank();
    const knowledge = makeKnowledge();
    await saveKnowledge("test-portal", knowledge, memoryBank, tempDir);

    const knowledgePath = join(tempDir, "test-portal", "knowledge.json");
    const raw = await Deno.readTextFile(knowledgePath);
    const parsed = JSON.parse(raw);
    assertEquals(parsed.portal, "test-portal");
    assertEquals(parsed.version, 1);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[KnowledgePersistence] loads previously saved knowledge", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const memoryBank = makeMockMemoryBank();
    const knowledge = makeKnowledge({ headCommitSha: "0123456789abcdef0123456789abcdef01234567", fullAnalysis: true });
    await saveKnowledge("test-portal", knowledge, memoryBank, tempDir);

    const loaded = await loadKnowledge("test-portal", tempDir);
    assertExists(loaded);
    assertEquals(loaded.portal, "test-portal");
    assertEquals(loaded.version, 1);
    assertEquals(loaded.architectureOverview, knowledge.architectureOverview);
    assertEquals(loaded.headCommitSha, knowledge.headCommitSha);
    assertEquals(loaded.fullAnalysis, knowledge.fullAnalysis);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[KnowledgePersistence] loads legacy knowledge without headCommitSha", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const portalDir = join(tempDir, "legacy-portal");
    await Deno.mkdir(portalDir, { recursive: true });
    const legacyKnowledge = { ...makeKnowledge(), headCommitSha: undefined, fullAnalysis: undefined };
    await Deno.writeTextFile(join(portalDir, "knowledge.json"), JSON.stringify(legacyKnowledge, null, 2));

    const result = await loadKnowledge("legacy-portal", tempDir);
    assertExists(result);
    assertEquals(result.portal, "test-portal");
    assertEquals(result.metadata.mode, PortalAnalysisMode.QUICK);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[KnowledgePersistence] returns null for missing knowledge", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const result = await loadKnowledge("nonexistent-portal", tempDir);
    assertEquals(result, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[KnowledgePersistence] returns null for corrupted knowledge", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const portalDir = join(tempDir, "bad-portal");
    await Deno.mkdir(portalDir, { recursive: true });
    await Deno.writeTextFile(join(portalDir, "knowledge.json"), "{ invalid json }");

    const result = await loadKnowledge("bad-portal", tempDir);
    assertEquals(result, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[KnowledgePersistence] maps architectureOverview to overview.md", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const memoryBank = makeMockMemoryBank();
    const knowledge = makeKnowledge({ architectureOverview: "## Architecture" });
    await saveKnowledge("test-portal", knowledge, memoryBank, tempDir);

    const overviewUpdate = memoryBank.calls.updateProjectMemory.find(
      (c) => c.updates.overview !== undefined,
    );
    assertExists(overviewUpdate, "Should call updateProjectMemory with overview");
    assertEquals(overviewUpdate.updates.overview, "## Architecture");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[KnowledgePersistence] maps conventions to patterns.md", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const memoryBank = makeMockMemoryBank();
    const knowledge = makeKnowledge();
    await saveKnowledge("test-portal", knowledge, memoryBank, tempDir);

    const patternUpdate = memoryBank.calls.updateProjectMemory.find(
      (c) => c.updates.patterns !== undefined,
    );
    assertExists(patternUpdate, "Should call updateProjectMemory with patterns");
    assertEquals(patternUpdate.updates.patterns?.length, 1);
    assertEquals(patternUpdate.updates.patterns?.[0].name, "*.service.ts");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[KnowledgePersistence] does not write references.md", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const memoryBank = makeMockMemoryBank();
    const knowledge = makeKnowledge();
    await saveKnowledge("test-portal", knowledge, memoryBank, tempDir);

    const referencesPath = join(tempDir, "test-portal", "references.md");
    let exists = false;
    try {
      await Deno.stat(referencesPath);
      exists = true;
    } catch {
      exists = false;
    }
    assertEquals(exists, false, "Should NOT write references.md");

    const refUpdate = memoryBank.calls.updateProjectMemory.find(
      (c) => c.updates.references !== undefined,
    );
    assertEquals(refUpdate, undefined, "Should not update references via memoryBank");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[KnowledgePersistence] does not overwrite decisions.md", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const memoryBank = makeMockMemoryBank();
    const knowledge = makeKnowledge();
    await saveKnowledge("test-portal", knowledge, memoryBank, tempDir);

    const decisionsPath = join(tempDir, "test-portal", "decisions.md");
    let exists = false;
    try {
      await Deno.stat(decisionsPath);
      exists = true;
    } catch {
      exists = false;
    }
    assertEquals(exists, false, "Should NOT write decisions.md");

    const decisionsUpdate = memoryBank.calls.updateProjectMemory.find(
      (c) => c.updates.decisions !== undefined,
    );
    assertEquals(decisionsUpdate, undefined, "Should not update decisions via memoryBank");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[KnowledgePersistence] skips overview update when sentinel is present", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const portalDir = join(tempDir, "guarded-portal");
    await Deno.mkdir(portalDir, { recursive: true });
    await Deno.writeTextFile(
      join(portalDir, "overview.md"),
      "<!-- mission-reported -->\n# Mission Context\nThis was written by MissionReporter.",
    );

    const memoryBank = makeMockMemoryBank();
    const knowledge = makeKnowledge({ portal: "guarded-portal" });
    await saveKnowledge("guarded-portal", knowledge, memoryBank, tempDir);

    const overviewUpdate = memoryBank.calls.updateProjectMemory.find(
      (c) => c.updates.overview !== undefined,
    );
    assertEquals(overviewUpdate, undefined, "Should skip overview when sentinel present");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
