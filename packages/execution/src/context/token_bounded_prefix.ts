/**
 * @module TokenBoundedPrefix
 * @path packages/execution/src/context/token_bounded_prefix.ts
 * @description Finds the longest leading text slice that fits a tokenizer-backed limit.
 * @architectural-layer Execution
 * @related-files [
 *   "packages/execution/src/agent_runner.ts",
 *   "packages/execution/src/context/context_budget_manager.ts"
 * ]
 */

const BINARY_SEARCH_DIVISOR = 2;

/** Returns a non-empty leading slice whose recounted size does not exceed `maxTokens`. */
export async function tokenBoundedPrefix(
  content: string,
  maxTokens: number,
  estimate: (text: string) => Promise<number>,
): Promise<string> {
  if (content.length === 0 || maxTokens <= 0) return "";

  let low = 1;
  let high = content.length;
  let best = "";
  while (low <= high) {
    const length = Math.floor((low + high) / BINARY_SEARCH_DIVISOR);
    const candidate = content.slice(0, length);
    if (await estimate(candidate) <= maxTokens) {
      best = candidate;
      low = length + 1;
    } else {
      high = length - 1;
    }
  }
  return best;
}
