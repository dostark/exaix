/**
 * @module TokenCounter
 * @path src/services/context/token_counter.ts
 * @description Utility for estimating token counts from text using heuristic and optional
 * fast local tokenization. Phase 62 Step 62.2 implementation.
 * @architectural-layer Services
 * @related-files [src/services/context/prompt_budget_allocator.ts, "packages/core/src/types/constants.ts"]
 */

import { TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";

/**
 * TokenCounter estimates token counts using a heuristic 4:1 character-to-token ratio.
 * Optional support for fast local BPE tokenization can be added in future iterations.
 */
export class TokenCounter {
  /**
   * Estimate token count from text using the heuristic 4:1 ratio.
   * @param text The text to count tokens for
   * @returns Estimated token count (rounded up)
   */
  countTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    // Use the established 4:1 character-to-token heuristic
    return Math.ceil(text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
  }
}
