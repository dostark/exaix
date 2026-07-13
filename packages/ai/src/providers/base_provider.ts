/**
 * @module BaseProvider
 * @path packages/ai/src/providers/base_provider.ts
 * @description Module for BaseProvider.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers.ts, packages/ai-openai/src/openai_provider.ts]
 */

import type { IEventLogger } from "@exaix/core/logger";

import type { Config } from "@exaix/schemas";

import type { IModelOptions, IModelProvider } from "../types.ts";
import { type IGenerateResult, withRetry } from "./common.ts";
/**
 * Options for base provider.
 */
export interface IBaseProviderOptions {
  apiKey: string;
  model?: string;
  id?: string;
  logger?: IEventLogger;
  retryDelayMs?: number;
  maxRetries?: number;
  baseUrl?: string;
  config?: Config;
  timeoutMs?: number;
  /** Provider-specific default model. */
  defaultModel?: string;
  /** Provider-specific default endpoint. */
  defaultEndpoint?: string;
  /** Provider-specific default timeout. */
  defaultTimeout?: number;
  /** Provider-specific default retry delay. */
  defaultRetryDelay?: number;
  /** Provider-specific default max retries. */
  defaultMaxRetries?: number;
}

/**
 * BaseProvider implements common logic for LLM providers.
 */
export abstract class BaseProvider implements IModelProvider {
  public readonly id: string;
  protected readonly apiKey: string;
  protected readonly model: string;
  protected readonly baseUrl: string;
  protected readonly logger?: IEventLogger;
  protected readonly retryDelayMs: number;
  protected readonly maxRetries: number;
  public readonly timeoutMs: number;

  constructor(
    options: IBaseProviderOptions,
    idPrefix: string,
  ) {
    this.apiKey = options.apiKey;
    this.model = options.model || options.defaultModel || "default";
    this.id = options.id || `${idPrefix}-${this.model}`;
    this.logger = options.logger;
    this.baseUrl = options.baseUrl || options.defaultEndpoint || "";
    this.retryDelayMs = options.retryDelayMs || options.defaultRetryDelay || 100;
    this.maxRetries = options.maxRetries || options.defaultMaxRetries || 3;
    this.timeoutMs = options.timeoutMs || options.defaultTimeout || 30000;
  }

  /**
   * Generate a completion from the model.
   */
  async generate(prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    return await withRetry(
      () => this.attemptGenerate(prompt, options),
      { maxRetries: this.maxRetries, baseDelayMs: this.retryDelayMs },
    );
  }

  /**
   * Internal: attempt a single completion call.
   */
  protected abstract attemptGenerate(prompt: string, options?: IModelOptions): Promise<IGenerateResult>;
}
