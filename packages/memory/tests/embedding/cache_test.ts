/**
 * @module DiskBackedEmbeddingCacheTest
 * @path packages/memory/tests/embedding/cache_test.ts
 * @description Tests for DiskBackedEmbeddingCache — filesystem-persisted LRU
 * embedding cache with content-hash keys and LRU eviction.
 * @architectural-layer Memory
 * @related-files [packages/memory/src/embedding/disk_cache.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { computeTextHash, DiskBackedEmbeddingCache } from "../../src/embedding/disk_cache.ts";

const testVectorA = [0.1, 0.2, 0.3];
const testVectorB = [0.4, 0.5, 0.6];

Deno.test("DiskBackedEmbeddingCache: set and get a value", async () => {
  const dir = await Deno.makeTempDir({ prefix: "emb-cache-" });
  try {
    const cache = new DiskBackedEmbeddingCache(dir);
    await cache.init();

    await cache.set("hash-a", testVectorA);
    const got = cache.get("hash-a");
    assert(got !== undefined);
    assertEquals(got, testVectorA);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DiskBackedEmbeddingCache: has returns correctly", async () => {
  const dir = await Deno.makeTempDir({ prefix: "emb-cache-" });
  try {
    const cache = new DiskBackedEmbeddingCache(dir);
    await cache.init();

    assertEquals(cache.has("hash-a"), false);
    await cache.set("hash-a", testVectorA);
    assertEquals(cache.has("hash-a"), true);
    assertEquals(cache.has("hash-b"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DiskBackedEmbeddingCache: delete removes entry", async () => {
  const dir = await Deno.makeTempDir({ prefix: "emb-cache-" });
  try {
    const cache = new DiskBackedEmbeddingCache(dir);
    await cache.init();

    await cache.set("hash-a", testVectorA);
    assertEquals(cache.has("hash-a"), true);

    await cache.delete("hash-a");
    assertEquals(cache.has("hash-a"), false);
    assertEquals(cache.get("hash-a"), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DiskBackedEmbeddingCache: clear removes all entries", async () => {
  const dir = await Deno.makeTempDir({ prefix: "emb-cache-" });
  try {
    const cache = new DiskBackedEmbeddingCache(dir);
    await cache.init();

    await cache.set("hash-a", testVectorA);
    await cache.set("hash-b", testVectorB);
    assertEquals(cache.size, 2);

    await cache.clear();
    assertEquals(cache.size, 0);
    assertEquals(cache.get("hash-a"), undefined);
    assertEquals(cache.get("hash-b"), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DiskBackedEmbeddingCache: persists across instances", async () => {
  const dir = await Deno.makeTempDir({ prefix: "emb-cache-" });
  try {
    const cache1 = new DiskBackedEmbeddingCache(dir);
    await cache1.init();
    await cache1.set("hash-a", testVectorA);
    await cache1.set("hash-b", testVectorB);
    await cache1.flush(); // flush debounced writes before reading from a second instance

    const cache2 = new DiskBackedEmbeddingCache(dir);
    await cache2.init();
    assertEquals(cache2.size, 2);
    assertEquals(cache2.get("hash-a"), testVectorA);
    assertEquals(cache2.get("hash-b"), testVectorB);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DiskBackedEmbeddingCache: LRU eviction evicts oldest", async () => {
  const dir = await Deno.makeTempDir({ prefix: "emb-cache-" });
  try {
    const cache = new DiskBackedEmbeddingCache(dir, 3);
    await cache.init();

    await cache.set("k1", testVectorA);
    await cache.set("k2", testVectorB);
    await cache.set("k3", [0.7, 0.8, 0.9]);
    assertEquals(cache.size, 3);

    cache.get("k1");

    await cache.set("k4", [0.0, 0.1, 0.2]);
    assertEquals(cache.size, 3);
    assertEquals(cache.get("k1") !== undefined, true, "k1 should survive (touched)");
    assertEquals(cache.get("k2"), undefined, "k2 should be evicted (oldest)");
    assertEquals(cache.get("k3") !== undefined, true, "k3 should survive");
    assertEquals(cache.get("k4") !== undefined, true, "k4 should survive");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DiskBackedEmbeddingCache: get updates LRU order", async () => {
  const dir = await Deno.makeTempDir({ prefix: "emb-cache-" });
  try {
    const cache = new DiskBackedEmbeddingCache(dir, 3);
    await cache.init();

    await cache.set("k1", testVectorA);
    await cache.set("k2", testVectorB);
    await cache.set("k3", [0.7, 0.8, 0.9]);

    cache.get("k1");
    cache.get("k2");

    await cache.set("k4", [0.0, 0.1, 0.2]);
    assertEquals(cache.size, 3);
    assertEquals(cache.get("k3"), undefined, "k3 (oldest) should be evicted");
    assertEquals(cache.get("k1") !== undefined, true);
    assertEquals(cache.get("k2") !== undefined, true);
    assertEquals(cache.get("k4") !== undefined, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("computeTextHash: consistent for same text", async () => {
  const hash1 = await computeTextHash("hello world");
  const hash2 = await computeTextHash("hello world");
  assertEquals(hash1, hash2);
});

Deno.test("computeTextHash: different for different text", async () => {
  const hash1 = await computeTextHash("hello world");
  const hash2 = await computeTextHash("goodbye world");
  assert(hash1 !== hash2);
});

Deno.test("DiskBackedEmbeddingCache: size property is accurate", async () => {
  const dir = await Deno.makeTempDir({ prefix: "emb-cache-" });
  try {
    const cache = new DiskBackedEmbeddingCache(dir);
    await cache.init();

    assertEquals(cache.size, 0);
    await cache.set("k1", testVectorA);
    assertEquals(cache.size, 1);
    await cache.set("k2", testVectorB);
    assertEquals(cache.size, 2);
    await cache.delete("k1");
    assertEquals(cache.size, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
