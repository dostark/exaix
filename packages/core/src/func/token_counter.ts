/**
 * @module TokenCounter
 * @path packages/core/src/func/token_counter.ts
 * @description Utility for estimating token counts from text using heuristic and optional
 * fast local tokenization. Phase 62 Step 62.2 implementation.
 * @architectural-layer Services
 * @related-files [packages/core/src/context/prompt_budget_allocator.ts, "packages/core/src/types/constants.ts"]
 */

import { TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";

export class TokenCounter {
  countTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    return Math.ceil(text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
  }
}
