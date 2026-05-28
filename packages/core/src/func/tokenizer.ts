/**
 * @module Tokenizer
 * @path packages/core/src/func/tokenizer.ts
 * @description Pluggable ITokenizer interface and AiTokenEstimatorTokenizer wrapping npm:ai-token-estimator
 * @architectural-layer Core
 * @dependencies [ai-token-estimator]
 * @related-files [packages/core/src/func/token_counter.ts, packages/core/src/types/constants.ts]
 */

import { countTokens as aiCountTokens } from "ai-token-estimator";

import { TokenizerBackend } from "../types/enums.ts";

export interface ITokenizer {
  countTokens(text: string, model: string): Promise<number>;
  countTokensBatch(texts: string[], model: string): Promise<number[]>;
}

export class AiTokenEstimatorTokenizer implements ITokenizer {
  constructor(private backend: TokenizerBackend = TokenizerBackend.AUTO) {}

  async countTokens(text: string, model: string): Promise<number> {
    if (text.length === 0) return 0;
    const result = await aiCountTokens({ text, model } as { text: string; model: string });
    return result.tokens;
  }

  countTokensBatch(texts: string[], model: string): Promise<number[]> {
    return Promise.all(texts.map((t) => this.countTokens(t, model)));
  }
}
