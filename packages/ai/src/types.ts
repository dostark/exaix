/**
 * @module AiTypes
 * @path packages/ai/src/types.ts
 * @description Shared AI types for the @exaix/ai package.
 * @architectural-layer AI
 */

import type { ConfigSource as _ConfigSource, MockStrategy, ProviderType } from "@exaix/core";

export interface IGenerateResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
  cost_usd?: number;
}

export interface IModelOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
}

export interface IModelProvider {
  id: string;
  generate(prompt: string, options?: IModelOptions): Promise<IGenerateResult>;
}

export interface IResolvedProviderOptions {
  provider: ProviderType;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
  apiKey?: string;
  mockStrategy?: MockStrategy;
  mockFixturesDir?: string;
  id?: string;
  responses?: string[];
  logger?: object;
}
