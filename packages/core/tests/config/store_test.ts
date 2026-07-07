/**
 * @module InMemoryConfigStoreTest
 * @path packages/core/tests/config/store_test.ts
 * @description Unit tests for InMemoryConfigStore — the daemon's in-memory config
 *   cache keyed by config key with per-key SwapClass.
 */
import { assertEquals } from "@std/assert";
import { InMemoryConfigStore } from "../../src/config/store.ts";
import { SwapClass } from "../../src/types/enums.ts";

Deno.test("[configuring] InMemoryConfigStore.get/set round-trips", () => {
  const store = new InMemoryConfigStore();
  store.set("ai.timeout_ms", 60000, SwapClass.HOT);
  assertEquals(store.get<number>("ai.timeout_ms"), 60000);
});

Deno.test("[configuring] InMemoryConfigStore.get returns undefined for unset key", () => {
  const store = new InMemoryConfigStore();
  assertEquals(store.get("missing.key"), undefined);
});

Deno.test("[configuring] InMemoryConfigStore.getSwapClass returns default (SwapClass.HOT) for unset key", () => {
  const store = new InMemoryConfigStore();
  assertEquals(store.getSwapClass("unset.key"), SwapClass.HOT);
});

Deno.test("[configuring] InMemoryConfigStore.getSwapClass returns the stored class", () => {
  const store = new InMemoryConfigStore();
  store.set("ai.model", "gemini", SwapClass.RESTART);
  assertEquals(store.getSwapClass("ai.model"), SwapClass.RESTART);
});

Deno.test("[configuring] InMemoryConfigStore.delete removes value and swap class", () => {
  const store = new InMemoryConfigStore();
  store.set("ai.timeout_ms", 60000, SwapClass.HOT);
  store.delete("ai.timeout_ms");
  assertEquals(store.get("ai.timeout_ms"), undefined);
  assertEquals(store.getSwapClass("ai.timeout_ms"), SwapClass.HOT);
});

Deno.test("[configuring] InMemoryConfigStore.entries iterates all set keys", () => {
  const store = new InMemoryConfigStore();
  store.set("a", 1, SwapClass.HOT);
  store.set("b", 2, SwapClass.RESTART);
  const entries = [...store.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  assertEquals(entries, [["a", 1], ["b", 2]]);
});
