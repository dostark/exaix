/**
 * @module BoundedLruCacheTest
 * @path packages/flow/tests/bounded_lru_cache_test.ts
 * @description Covers the bounded recency cache that holds per-binding DYNAMIC executors.
 */

import { assertEquals } from "@std/assert";
import { BoundedLruCache } from "../src/bounded_lru_cache.ts";

Deno.test("[cache] the least recently used entry is dropped once the cap is exceeded", () => {
  const cache = new BoundedLruCache<string, number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  assertEquals(cache.get("a"), 1);
  cache.set("c", 3);
  assertEquals(cache.get("b"), undefined);
  assertEquals(cache.get("a"), 1);
  assertEquals(cache.get("c"), 3);
  assertEquals(cache.size, 2);
});

Deno.test("[cache] resetting a key replaces the value without growing the cache", () => {
  const cache = new BoundedLruCache<string, number>(2);
  cache.set("a", 1);
  cache.set("a", 2);
  assertEquals(cache.size, 1);
  assertEquals(cache.get("a"), 2);
});
