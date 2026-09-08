/**
 * @module Phase176ContextItemsTest
 * @path packages/core/tests/context/phase176_context_items_test.ts
 * @description Phase 176 Step 1: fitContextItems selects the prefix-preserving subset
 * of items that fits an explicit token budget — zero budget yields empty (not
 * "uncapped", unlike PromptBuilder's private applyTokenBudget), an oversized first item
 * is skipped in favor of a smaller later one, and an invalid budget throws.
 * @architectural-layer Tests
 * @related-files [packages/core/src/func/context_items.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { fitContextItems } from "@exaix/core/func";
import type { ITokenizer } from "@exaix/core/func";

/** One token per character — deterministic and easy to reason about in assertions. */
function charCountTokenizer(): ITokenizer {
  return {
    countTokens: (text: string, _model: string) => Promise.resolve(text.length),
    countTokensBatch: (texts: string[], _model: string) => Promise.resolve(texts.map((t) => t.length)),
  };
}

Deno.test("[fitContextItems] budgetTokens: 0 yields an empty selection, not uncapped", async () => {
  const result = await fitContextItems(charCountTokenizer(), "mock-model", ["short"], 0);
  assertEquals(result, { selected: [], usedTokens: 0 });
});

Deno.test("[fitContextItems] empty items list yields an empty selection", async () => {
  const result = await fitContextItems(charCountTokenizer(), "mock-model", [], 100);
  assertEquals(result, { selected: [], usedTokens: 0 });
});

Deno.test("[fitContextItems] a tiny budget that fits nothing yields an empty selection", async () => {
  const result = await fitContextItems(charCountTokenizer(), "mock-model", ["twenty characters!!!"], 1);
  assertEquals(result, { selected: [], usedTokens: 0 });
});

Deno.test("[fitContextItems] skips an oversized first item and selects a smaller later one — never splits", async () => {
  const items = ["this-item-is-far-too-large-for-the-budget", "fits", "also-too-large-for-remaining-budget"];
  const result = await fitContextItems(charCountTokenizer(), "mock-model", items, 4, "");
  assertEquals(result.selected, ["fits"]);
  assertEquals(result.usedTokens, 4);
});

Deno.test("[fitContextItems] counts the delimiter's tokens between selected items, not before the first", async () => {
  const items = ["ab", "cd"];
  const delimiter = "|";
  const result = await fitContextItems(charCountTokenizer(), "mock-model", items, 5, delimiter);
  // "ab" (2) + "|" (1) + "cd" (2) = 5, fits exactly; a single extra token would not.
  assertEquals(result.selected, ["ab", "cd"]);
  assertEquals(result.usedTokens, 5);
});

Deno.test("[fitContextItems] one token under the exact combined cost drops the second item", async () => {
  const items = ["ab", "cd"];
  const result = await fitContextItems(charCountTokenizer(), "mock-model", items, 4, "|");
  // "ab" (2) fits alone; "ab" + "|" + "cd" (5) does not fit in 4.
  assertEquals(result.selected, ["ab"]);
  assertEquals(result.usedTokens, 2);
});

Deno.test("[fitContextItems] selects all items when the budget comfortably covers everything", async () => {
  const items = ["one", "two", "three"];
  const result = await fitContextItems(charCountTokenizer(), "mock-model", items, 1000);
  assertEquals(result.selected, items);
});

Deno.test("[fitContextItems] preserves original relative order of selected items", async () => {
  const items = ["aaaaaaaaaa", "b", "cccccccccc", "d"];
  const result = await fitContextItems(charCountTokenizer(), "mock-model", items, 2, "");
  assertEquals(result.selected, ["b", "d"]);
});

Deno.test("[fitContextItems] rejects a negative budget", async () => {
  await assertRejects(
    () => fitContextItems(charCountTokenizer(), "mock-model", ["x"], -1),
    Error,
    "budgetTokens",
  );
});

Deno.test("[fitContextItems] rejects a NaN budget", async () => {
  await assertRejects(
    () => fitContextItems(charCountTokenizer(), "mock-model", ["x"], NaN),
    Error,
    "budgetTokens",
  );
});

Deno.test("[fitContextItems] a synthetic 20-item full dump fits fewer than 20 items under a bounded budget", async () => {
  const items = Array.from({ length: 20 }, (_, i) => `item-${i}-`.repeat(10));
  const result = await fitContextItems(charCountTokenizer(), "mock-model", items, 500);
  assertEquals(result.selected.length < 20, true, "a bounded budget must not admit the full synthetic dump");
  assertEquals(result.usedTokens <= 500, true);
});
