/**
 * @module Tokenizer
 * @path packages/core/src/func/tokenizer.ts
 * @description Pluggable ITokenizer interface and AiTokenEstimatorTokenizer wrapping npm:ai-token-estimator
 * @architectural-layer Core
 * @dependencies [ai-token-estimator]
 * @related-files [packages/core/src/func/token_counter.ts, packages/core/src/types/constants.ts]
 */

import { countTokens as aiCountTokens } from "ai-token-estimator";

import { TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "../types/constants.ts";
import { TokenizerBackend } from "../types/enums.ts";

export interface ITokenizer {
  countTokens(text: string, model: string): Promise<number>;
  countTokensBatch(texts: string[], model: string): Promise<number[]>;
}

export class AiTokenEstimatorTokenizer implements ITokenizer {
  constructor(private backend: TokenizerBackend = TokenizerBackend.AUTO) {}

  async countTokens(text: string, model: string): Promise<number> {
    if (text.length === 0) return 0;
    const options: { text: string; model: string; mode?: string } = { text, model };
    if (this.backend === TokenizerBackend.LOCAL) {
      options.mode = "local";
    }
    try {
      const result = await aiCountTokens(options as { text: string; model: string });
      return result.tokens;
    } catch {
      // ai-token-estimator throws on any model id outside its catalog (e.g. a CLI-delegate
      // "claude-cli:..." composite id); a token estimate must never fail the request.
      return Math.ceil(text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
    }
  }

  countTokensBatch(texts: string[], model: string): Promise<number[]> {
    return Promise.all(texts.map((t) => this.countTokens(t, model)));
  }
}
