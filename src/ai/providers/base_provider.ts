/**
 * @module BaseProvider
 * @path src/ai/providers/base_provider.ts
 * @description Module for BaseProvider.
 * @architectural-layer AI
 * * @related-files [src/ai/providers.ts, src/ai/providers/openai_provider.ts]
 */

import type { EventLogger } from "../../services/core/event_logger.ts";
import type { Config } from "../../shared/schemas/config.ts";
import type { IModelOptions, IModelProvider } from "../types.ts";
import { withRetry } from "./common.ts";

/**
 * Options for base provider.
 */
export interface IBaseProviderOptions {
  apiKey: string;
  model?: string;
  id?: string;
  logger?: EventLogger;
  retryDelayMs?: number;
  maxRetries?: number;
  baseUrl?: string;
  config?: Config;
  timeoutMs?: number;
}

/**
 * BaseProvider implements common logic for LLM providers.
 */
export abstract class BaseProvider implements IModelProvider {
  public readonly id: string;
  protected readonly apiKey: string;
  protected readonly model: string;
  protected readonly baseUrl: string;
  protected readonly logger?: EventLogger;
  protected readonly retryDelayMs: number;
  protected readonly maxRetries: number;
  public readonly timeoutMs: number;

  constructor(
    options: IBaseProviderOptions,
    defaultModel: string,
    defaultEndpoint: string,
    defaultTimeout: number,
    defaultRetryDelay: number,
    defaultMaxRetries: number,
    idPrefix: string,
  ) {
    this.apiKey = options.apiKey;
    this.model = options.model || defaultModel;
    this.id = options.id || `${idPrefix}-${this.model}`;
    this.logger = options.logger;
    this.baseUrl = options.baseUrl || defaultEndpoint;
    this.retryDelayMs = options.retryDelayMs || defaultRetryDelay;
    this.maxRetries = options.maxRetries || defaultMaxRetries;
    this.timeoutMs = options.timeoutMs || defaultTimeout;
  }

  /**
   * Generate a completion from the model.
   */
  async generate(prompt: string, options?: IModelOptions): Promise<string> {
    return await withRetry(
      () => this.attemptGenerate(prompt, options),
      { maxRetries: this.maxRetries, baseDelayMs: this.retryDelayMs },
    );
  }

  /**
   * Internal: attempt a single completion call.
   */
  protected abstract attemptGenerate(prompt: string, options?: IModelOptions): Promise<string>;
}
