/**
 * @module KnowledgePersistenceToleranceTest
 * @path packages/portal/knowledge/tests/knowledge_persistence_tolerance_test.ts
 * @description Tests for the loadKnowledge read-path tolerance (Phase 178 Step 6).
 * A snapshot written by a newer build may carry a relationship kind this build
 * does not know. The reader must drop only that edge, not the whole snapshot.
 * Genuine corruption must still resolve to null.
 * @architectural-layer Portal
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { loadKnowledge, saveKnowledge } from "@exaix/portal/knowledge";
import { PortalAnalysisMode } from "@exaix/core";
import type { IPortalKnowledge } from "@exaix/schemas";

/** A knowledge snapshot as written to disk.
 *  Every field is optional, and an edge kind stays a plain string.
 *  A test can therefore write a kind this build does not know. */
type IRawKnowledgeFixture = Omit<Partial<IPortalKnowledge>, "relationships"> & {
  relationships?: Array<{ from: string; to: string; kind: string }>;
};

function baseKnowledge(): IPortalKnowledge {
  return {
    portal: "tolerance-portal",
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "# Test",
    layers: [{ name: "core", paths: ["src"], responsibility: "core", keyFiles: ["src/a.ts"] }],
    keyFiles: [{ path: "src/a.ts", role: "entrypoint", description: "entry" }],
    conventions: [],
    dependencies: [],
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [{
      name: "Helper",
      kind: "function",
      file: "src/a.ts",
      signature: "function Helper()",
    }],
    stats: { totalFiles: 2, totalDirectories: 1, extensionDistribution: { ".ts": 2 } },
    metadata: { durationMs: 1, mode: PortalAnalysisMode.STANDARD, filesScanned: 2, filesRead: 2 },
    relationships: [
      { from: "src/a.ts", to: "src/b.ts", kind: "file_imports_file_internal" },
    ],
  };
}

async function writeRawKnowledge(raw: IRawKnowledgeFixture): Promise<{ dir: string; alias: string }> {
  const dir = await Deno.makeTempDir({ prefix: "exa_tolerance_" });
  const alias = "tolerance-portal";
  await Deno.mkdir(join(dir, alias), { recursive: true });
  await Deno.writeTextFile(join(dir, alias, "knowledge.json"), JSON.stringify(raw, null, 2));
  return { dir, alias };
}

Deno.test("[loadKnowledge] drops only an unrecognized relationship kind and preserves every other field", async () => {
  const knowledge = baseKnowledge();
  const raw = {
    ...knowledge,
    relationships: [
      ...(knowledge.relationships ?? []),
      { from: "src/a.ts", to: "src/b.ts", kind: "calls_function_from_the_future" },
      { from: "src/a.ts", to: "src/b.ts#Helper", kind: "symbol_references_symbol" },
    ],
  };
  const { dir, alias } = await writeRawKnowledge(raw);
  try {
    const loaded = await loadKnowledge(alias, dir);

    assert(loaded !== null, "a snapshot with one unknown kind must still load");
    assertEquals(loaded!.layers.length, knowledge.layers.length);
    assertEquals(loaded!.keyFiles.length, knowledge.keyFiles.length);
    assertEquals(loaded!.symbolMap.length, knowledge.symbolMap.length);
    assertEquals(loaded!.metadata.mode, knowledge.metadata.mode);
    assertEquals(loaded!.relationships?.length, 2, "only the unknown kind is dropped");
    assertEquals(
      loaded!.relationships!.map((e) => e.kind).sort(),
      ["file_imports_file_internal", "symbol_references_symbol"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[loadKnowledge] still resolves to null for a genuinely corrupt snapshot", async () => {
  const { dir, alias } = await writeRawKnowledge({
    portal: "tolerance-portal",
    // Deliberately missing every required field beyond portal.
  } as IRawKnowledgeFixture);
  try {
    assertEquals(await loadKnowledge(alias, dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[loadKnowledge] still resolves to null for unparseable JSON", async () => {
  const dir = await Deno.makeTempDir({ prefix: "exa_tolerance_bad_" });
  const alias = "tolerance-portal";
  try {
    await Deno.mkdir(join(dir, alias), { recursive: true });
    await Deno.writeTextFile(join(dir, alias, "knowledge.json"), "{ not json");
    assertEquals(await loadKnowledge(alias, dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[loadKnowledge] round-trips a snapshot this build writes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "exa_tolerance_rt_" });
  const alias = "round-trip";
  try {
    const written = { ...baseKnowledge(), portal: alias };
    await saveKnowledge(alias, written, null, dir);
    const loaded = await loadKnowledge(alias, dir);

    assertEquals(loaded?.relationships, written.relationships);
    assertEquals(loaded?.symbolMap, written.symbolMap);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
