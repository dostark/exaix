/**
 * @module EmbeddingsTemplateTest
 * @path tests/embeddings_template_test.ts
 * @description Verifies the logic for generating embeddings prompts, ensuring that
 * content templates are correctly populated for vectorization.
 */

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.203.0/assert/mod.ts";

Deno.test("example precomputed template is valid JSON and contains required keys", async () => {
  const raw = await Deno.readTextFile(".copilot/embeddings/example_precomputed_template.json");
  const obj = JSON.parse(raw) as { path: string; vecs: Array<{ text: string; vector: number[] }> };

  assertExists(obj.path, "template should include 'path'");
  assert(Array.isArray(obj.vecs), "template should include 'vecs' array");
  const vecs = obj.vecs;
  assert(vecs.length > 0, "vecs should not be empty");

  const first = vecs[0];
  assertExists(first.text, "each vec entry should include text");
  assert(Array.isArray(first.vector), "each vec entry should include a vector array");

  // ensure vectors are numeric
  const vector = first.vector as number[];
  assert(vector.length > 0, "vector should have at least one dimension");
  for (const v of vector) {
    assertEquals(typeof v, "number", "vector dimensions should be numbers");
  }
});
