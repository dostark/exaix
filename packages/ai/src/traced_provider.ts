/**
 * @module TracedProvider
 * @path packages/ai/src/traced_provider.ts
 * @description Observability wrapper for IModelProvider that emits LLM call lifecycle
 * events (started, completed, failed) through IEventLogger.
 * @architectural-layer AI
 * @related-files ["packages/ai/src/provider_factory.ts", "packages/core/src/events/domain_event_types.ts"]
 */

import type { IModelProvider } from "./types.ts";
import type { IGenerateResult } from "./providers/common.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { IModelOptions } from "./types.ts";
import type { Opt, Reason } from "@exaix/core/types";

export class TracedProvider implements IModelProvider {
  public readonly id: string;

  constructor(
    /** Public (Phase 157) so unwrapModelProvider can reach through a decorator chain to
     *  report on the underlying provider (e.g. MockLLMProvider fixture drift). */
    public readonly inner: IModelProvider,
    private logger: IEventLogger,
  ) {
    this.id = inner.id;
  }

  async generate(prompt: string, options?: Opt<IModelOptions, Reason.OptionalInput>): Promise<IGenerateResult> {
    const traceId = crypto.randomUUID();
    const startTime = performance.now();

    void this.logger.info(DomainEventType.LlmCallStarted, this.id, {
      prompt_length: prompt.length,
      model: this.id,
      trace_id: traceId,
    });

    try {
      const result = await this.inner.generate(prompt, options);
      const durationMs = performance.now() - startTime;

      void this.logger.info(DomainEventType.LlmCallCompleted, this.id, {
        duration_ms: Math.round(durationMs),
        prompt_tokens: result.usage?.promptTokens ?? 0,
        completion_tokens: result.usage?.completionTokens ?? 0,
        total_tokens: result.usage?.totalTokens ?? 0,
        cost_usd: result.cost_usd ?? 0,
        model: this.id,
        trace_id: traceId,
      });

      return result;
    } catch (error) {
      const durationMs = performance.now() - startTime;

      void this.logger.warn(DomainEventType.LlmCallFailed, this.id, {
        duration_ms: Math.round(durationMs),
        error: error instanceof Error ? error.message : String(error),
        error_type: error instanceof Error ? error.constructor.name : "unknown",
        model: this.id,
        trace_id: traceId,
      });

      throw error;
    }
  }

  generateStream?(
    prompt: string,
    options?: Opt<IModelOptions, Reason.AbstractBoundary>,
  ): AsyncGenerator<string> {
    if (!this.inner.generateStream) {
      throw new Error("Inner provider does not support streaming");
    }
    return this.inner.generateStream(prompt, options);
  }
}
