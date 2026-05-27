/**
 * @module HnswVectorIndexTest
 * @path packages/memory/tests/embedding/vector_index_test.ts
 * @description Tests for HnswVectorIndex covering insert, search, delete,
 * save/load round-trip, high-dimensional vectors, rebuild, and edge cases.
 */
import { assertAlmostEquals, assertEquals, assertGreaterOrEqual } from "@std/assert";
import { HnswVectorIndex } from "../../src/embedding/vector_index.ts";

Deno.test("HnswVectorIndex: empty index returns empty results", () => {
  const index = new HnswVectorIndex();
  const results = index.search([1, 0, 0, 0], 5);
  assertEquals(results, []);
});

Deno.test("HnswVectorIndex: single vector search returns itself", () => {
  const index = new HnswVectorIndex();
  index.insert("a", [1, 0, 0, 0]);
  const results = index.search([1, 0, 0, 0], 5);
  assertEquals(results.length, 1);
  assertEquals(results[0].id, "a");
  assertAlmostEquals(results[0].similarity, 1.0, 0.01);
});

Deno.test("HnswVectorIndex: returns nearest by cosine similarity", () => {
  const index = new HnswVectorIndex();
  index.insert("a", [1, 0, 0, 0]);
  index.insert("b", [0, 1, 0, 0]);
  index.insert("c", [0, 0, 1, 0]);
  // Query near "a"
  const results = index.search([0.9, 0.1, 0, 0], 3);
  assertEquals(results[0].id, "a");
  assertGreaterOrEqual(results[0].similarity, 0.9);
});

Deno.test("HnswVectorIndex: respects top-K limit", () => {
  const index = new HnswVectorIndex();
  for (let i = 0; i < 10; i++) {
    const vec = new Array(4).fill(0);
    vec[i % 4] = 1;
    index.insert(`id-${i}`, vec);
  }
  const results = index.search([1, 0, 0, 0], 3);
  assertEquals(results.length, 3);
});

Deno.test("HnswVectorIndex: returns results sorted by similarity descending", () => {
  const index = new HnswVectorIndex();
  index.insert("close", [0.9, 0.1, 0, 0]);
  index.insert("far", [0, 0, 1, 0]);
  index.insert("closest", [0.95, 0.05, 0, 0]);
  const results = index.search([1, 0, 0, 0], 3);
  assertEquals(results.length, 3);
  assertGreaterOrEqual(results[0].similarity, results[1].similarity);
  assertGreaterOrEqual(results[1].similarity, results[2].similarity);
});

Deno.test("HnswVectorIndex: delete removes from index", () => {
  const index = new HnswVectorIndex();
  index.insert("a", [1, 0, 0, 0]);
  index.insert("b", [0, 1, 0, 0]);
  assertEquals(index.search([1, 0, 0, 0], 5).length, 2);
  index.delete("a");
  const results = index.search([1, 0, 0, 0], 5);
  assertEquals(results.length, 1);
  assertEquals(results[0].id, "b");
});

Deno.test("HnswVectorIndex: size reflects vector count", () => {
  const index = new HnswVectorIndex();
  assertEquals(index.size(), 0);
  index.insert("a", [1, 0, 0]);
  assertEquals(index.size(), 1);
  index.insert("b", [0, 1, 0]);
  assertEquals(index.size(), 2);
  index.delete("a");
  assertEquals(index.size(), 1);
});

Deno.test("HnswVectorIndex: save and load round-trip preserves search", () => {
  const index = new HnswVectorIndex();
  index.insert("a", [1, 0, 0, 0]);
  index.insert("b", [0, 1, 0, 0]);
  index.insert("c", [0, 0, 1, 0]);

  const data = index.save();
  const loaded = new HnswVectorIndex();
  loaded.load(data);

  assertEquals(loaded.size(), 3);
  const results = loaded.search([1, 0, 0, 0], 3);
  assertEquals(results[0].id, "a");
});

Deno.test("HnswVectorIndex: higher-dimensional vectors work (64-dim)", () => {
  const index = new HnswVectorIndex();
  const dim = 64;
  for (let i = 0; i < 5; i++) {
    const vec = new Array(dim).fill(0);
    vec[i] = 1;
    index.insert(`v${i}`, vec);
  }
  const query = new Array(dim).fill(0);
  query[0] = 0.8;
  query[1] = 0.1;
  const results = index.search(query, 5);
  assertGreaterOrEqual(results.length, 1);
  assertEquals(results[0].id, "v0");
});

Deno.test("HnswVectorIndex: delete non-existent id does not throw", () => {
  const index = new HnswVectorIndex();
  index.insert("a", [1, 0, 0]);
  index.delete("nonexistent");
  assertEquals(index.size(), 1);
});

Deno.test("HnswVectorIndex: rebuildFromVectors replaces all data", () => {
  const index = new HnswVectorIndex();
  index.insert("a", [1, 0, 0]);
  index.insert("b", [0, 1, 0]);

  index.rebuildFromVectors(
    new Map([
      ["c", [0, 0, 1]],
      ["d", [1, 0, 0]],
    ]),
  );

  assertEquals(index.size(), 2);
  const results = index.search([0, 0, 1], 2);
  assertEquals(results[0].id, "c");
});

Deno.test("HnswVectorIndex: handles large search result set gracefully", () => {
  const index = new HnswVectorIndex();
  for (let i = 0; i < 20; i++) {
    const vec = new Array(4).fill(0);
    if (i < 10) vec[0] = 1;
    else vec[1] = 1;
    index.insert(`id-${i}`, vec);
  }
  const results = index.search([1, 0, 0, 0], 50);
  assertEquals(results.length, 20);
});
