/**
 * @module ContextItems
 * @path packages/core/src/func/context_items.ts
 * @description Pure item-fitting helper: selects the prefix-preserving subset of
 * item texts that fits an explicit token budget, skipping oversized items rather
 * than truncating them. A separate, narrowly scoped seam from PromptBuilder's
 * private applyTokenBudget — does not reuse or change that helper.
 * @architectural-layer Core
 * @related-files [packages/core/src/func/tokenizer.ts, packages/core/src/prompt_budget_allocator.ts]
 */

import type { ITokenizer } from "./tokenizer.ts";

export interface IFitContextItemsResult {
  /** The selected items, in their original relative order. */
  selected: readonly string[];
  /** Total counted tokens across selected items plus the delimiters between them. */
  usedTokens: number;
}

export const DEFAULT_CONTEXT_ITEM_DELIMITER = "\n\n---\n\n";

/** Selects the order-preserving subset of `items` fitting `budgetTokens`, counting real
 *  tokenizer counts plus inter-item delimiter tokens; an oversized item is skipped, never
 *  truncated. `budgetTokens: 0` yields empty (not "uncapped"); invalid values throw. */
export async function fitContextItems(
  tokenizer: ITokenizer,
  model: string,
  items: readonly string[],
  budgetTokens: number,
  delimiter: string = DEFAULT_CONTEXT_ITEM_DELIMITER,
): Promise<IFitContextItemsResult> {
  if (!Number.isFinite(budgetTokens) || budgetTokens < 0) {
    throw new Error(`fitContextItems: budgetTokens must be a non-negative finite number, got ${budgetTokens}`);
  }
  if (budgetTokens === 0 || items.length === 0) {
    return { selected: [], usedTokens: 0 };
  }

  const delimiterTokens = delimiter.length > 0 ? await tokenizer.countTokens(delimiter, model) : 0;
  const itemTokenCounts = await tokenizer.countTokensBatch([...items], model);

  const selected: string[] = [];
  let usedTokens = 0;
  for (let i = 0; i < items.length; i++) {
    const separatorCost = selected.length > 0 ? delimiterTokens : 0;
    const candidateTokens = usedTokens + separatorCost + itemTokenCounts[i];
    if (candidateTokens > budgetTokens) continue;
    selected.push(items[i]);
    usedTokens = candidateTokens;
  }

  return { selected, usedTokens };
}
