/**
 * @module ContextCompactor
 * @path packages/execution/src/context/context_compactor.ts
 * @description IContextCompactor interface and concrete implementations for LLM-based
 * and no-op segment summarization. Used by ContextBudgetManager's async compaction tier.
 * @architectural-layer Services
 * @dependencies [
 *   "@exaix/ai/types.ts",
 *   "packages/execution/src/context/context_segment.ts",
 *   "@exaix/core"
 * ]
 * @related-files [
 *   "packages/execution/src/context/context_budget_manager.ts",
 *   "packages/execution/src/context/context_segment.ts"
 * ]
 */

import type { IModelProvider } from "@exaix/ai/types.ts";
import { COMPACT_SUMMARY_MAX_TOKENS, TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";
import { ContextSegmentKindSchema } from "@exaix/schemas/execution/context_budget.ts";
import type { IContextSegment } from "./context_segment.ts";

/** Contract for segment-level LLM summarization in the async compaction tier. */
export interface IContextCompactor {
  summarize(
    segment: IContextSegment,
    provider: IModelProvider,
  ): Promise<IContextSegment>;
}

/**
 * Calls the LLM provider to produce a compact summary of the segment.
 * On provider failure, returns the original segment unchanged (fail-open).
 */
export class LlmContextCompactor implements IContextCompactor {
  async summarize(
    segment: IContextSegment,
    provider: IModelProvider,
  ): Promise<IContextSegment> {
    const prompt = `Summarize the following content in 1-2 sentences:\n${segment.content}`;
    try {
      const result = await provider.generate(prompt, {
        max_tokens: COMPACT_SUMMARY_MAX_TOKENS,
      });
      const summary = result.content.trim();
      return {
        ...segment,
        kind: ContextSegmentKindSchema.enum.summary,
        content: summary,
        tokenEstimate: Math.ceil(summary.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN),
      };
    } catch {
      return segment;
    }
  }
}

/**
 * No-op compactor — returns the segment unchanged.
 * Used in dry-run mode and tests to isolate budget manager behavior.
 */
export class NoopContextCompactor implements IContextCompactor {
  summarize(
    segment: IContextSegment,
    _provider: IModelProvider,
  ): Promise<IContextSegment> {
    return Promise.resolve(segment);
  }
}
