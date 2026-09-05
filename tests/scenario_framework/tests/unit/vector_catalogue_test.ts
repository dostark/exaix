/**
 * @module VectorCatalogueTest
 * @path tests/scenario_framework/tests/unit/vector_catalogue_test.ts
 * @description Phase 145 Step 3: `fixtures/adversarial/vectors.json` matches `AttackVectorSchema`
 *   1:1, and every catalogued vector has at least one clean/attacked task.json pair on disk
 *   whose `attack.vector` names it.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/fixtures/adversarial/vectors.json, tests/scenario_framework/schema/task_schema.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AttackVectorSchema, TaskJsonSchema } from "../../schema/task_schema.ts";

const ADVERSARIAL_FIXTURES_DIR = new URL("../../fixtures/adversarial", import.meta.url).pathname;

interface IVectorManifestEntry {
  id: string;
  injection_site: string;
  predicate: string;
  mechanism: string;
}

interface IVectorManifest {
  vectors: IVectorManifestEntry[];
}

async function loadManifest(): Promise<IVectorManifest> {
  const content = await Deno.readTextFile(join(ADVERSARIAL_FIXTURES_DIR, "vectors.json"));
  return JSON.parse(content) as IVectorManifest;
}

async function loadAttackedTaskVectors(): Promise<string[]> {
  const vectors: string[] = [];
  for await (const entry of Deno.readDir(ADVERSARIAL_FIXTURES_DIR)) {
    if (!entry.isDirectory) continue;
    const taskJsonPath = join(ADVERSARIAL_FIXTURES_DIR, entry.name, "task.json");
    let raw;
    try {
      raw = JSON.parse(await Deno.readTextFile(taskJsonPath));
    } catch {
      continue;
    }
    const parsed = TaskJsonSchema.safeParse(raw);
    if (parsed.success && parsed.data.attack) {
      vectors.push(parsed.data.attack.vector);
    }
  }
  return vectors;
}

Deno.test("[VectorCatalogue] manifest vector ids match AttackVectorSchema's catalogued enum exactly", async () => {
  const manifest = await loadManifest();
  const manifestIds = manifest.vectors.map((v) => v.id).sort();
  const schemaIds = AttackVectorSchema.options.slice().sort();
  assertEquals(manifestIds, schemaIds);
});

Deno.test("[VectorCatalogue] every manifest vector has at least one attacked task.json pair on disk", async () => {
  const manifest = await loadManifest();
  const attackedVectors = new Set(await loadAttackedTaskVectors());
  for (const vector of manifest.vectors) {
    assert(attackedVectors.has(vector.id), `vector "${vector.id}" has no attacked task.json fixture`);
  }
});

Deno.test("[VectorCatalogue] every attacked task.json's vector is catalogued in the manifest", async () => {
  const manifest = await loadManifest();
  const manifestIds = new Set(manifest.vectors.map((v) => v.id));
  const attackedVectors = await loadAttackedTaskVectors();
  for (const vector of attackedVectors) {
    assert(manifestIds.has(vector), `attacked task references uncatalogued vector "${vector}"`);
  }
});

Deno.test("[VectorCatalogue] every manifest entry names a mechanism", async () => {
  const manifest = await loadManifest();
  for (const vector of manifest.vectors) {
    assert(vector.mechanism.length > 0, `vector "${vector.id}" has no mechanism`);
    assert(vector.injection_site.length > 0, `vector "${vector.id}" has no injection_site`);
    assert(vector.predicate.length > 0, `vector "${vector.id}" has no predicate`);
  }
});
