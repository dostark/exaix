/**
 * @module ContextCacheTest
 * @path packages/core/tests/context/context_cache_test.ts
 * @description Tests for ContextCache — LRU context section caching for Anthropic-style cache_control.
 * @architectural-layer Core
 * @related-files [packages/core/src/context/context_cache.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { ContextCache } from "@exaix/core/context";

Deno.test("[ContextCache] markStable stores entry and getStableSections retrieves by key", () => {
  const cache = new ContextCache();
  cache.markStable("systemPrompt", "You are a helpful assistant", 500);
  cache.markStable("portalContext", "Portal: test", 200);

  const stable = cache.getStableSections(["systemPrompt", "portalContext"]);
  assertEquals(stable.length, 2);
  assertEquals(stable[0].content, "You are a helpful assistant");
  assertEquals(stable[1].content, "Portal: test");
});

Deno.test("[ContextCache] getStableSections returns only unchanged sections", () => {
  const cache = new ContextCache();
  cache.markStable("section1", "content1", 100);

  // Only request section1 — it should be returned
  const stable = cache.getStableSections(["section1"]);
  assertEquals(stable.length, 1);
  assertEquals(stable[0].key, "section1");
});

Deno.test("[ContextCache] getStableSections excludes sections not in cache", () => {
  const cache = new ContextCache();
  cache.markStable("section1", "content1", 100);

  // section2 was never cached — should not be in result
  const stable = cache.getStableSections(["section2"]);
  assertEquals(stable.length, 0);
});

Deno.test("[ContextCache] evicts LRU entries when exceeding max entries", () => {
  const cache = new ContextCache(3); // max 3 entries

  cache.markStable("a", "content-a", 10);
  cache.markStable("b", "content-b", 10);
  cache.markStable("c", "content-c", 10);
  // Cache is full: a, b, c

  cache.markStable("d", "content-d", 10);
  // d was inserted, LRU entry 'a' should be evicted

  const stable = cache.getStableSections(["a", "d"]);
  assertEquals(stable.length, 1, "entry 'a' should have been evicted");
  assertEquals(stable[0].key, "d");
});

Deno.test("[ContextCache] invalidateAll clears all entries", () => {
  const cache = new ContextCache();
  cache.markStable("a", "content-a", 10);
  cache.markStable("b", "content-b", 10);
  assertEquals(cache.getStableSections(["a", "b"]).length, 2);

  cache.invalidateAll();
  assertEquals(cache.getStableSections(["a", "b"]).length, 0);
});

Deno.test("[ContextCache] markStable updates lastUsedAt on re-mark", () => {
  const cache = new ContextCache(2);

  cache.markStable("a", "content-a", 10);
  cache.markStable("b", "content-b", 10);
  // Re-mark 'a' — moves it to most recently used via monotonic counter
  cache.markStable("a", "content-a-updated", 10);

  // Now insert 'c' — should evict 'b' (the LRU), not 'a'
  cache.markStable("c", "content-c", 10);

  const stable = cache.getStableSections(["a", "b", "c"]);
  const keys = stable.map((s) => s.key);
  assert(keys.includes("a"), "'a' should survive eviction (recently used)");
  assert(!keys.includes("b"), "'b' should be evicted (least recently used)");
  assert(keys.includes("c"), "'c' should be in cache");
});
