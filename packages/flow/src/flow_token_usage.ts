/**
 * @module FlowTokenUsage
 * @path packages/flow/src/flow_token_usage.ts
 * @description Aggregates the provider token usage of a finished flow run and journals the totals.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import type { IDatabaseService } from "@exaix/storage-sqlite";
import { DomainEventType } from "@exaix/core/events";
import { DEFAULT_COST_PRECISION_FACTOR } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IFlowEventLogger, IFlowResult } from "./flow_types.ts";

// unslop-ignore-next-line unused-type
/** What the token accounting of one flow runner needs from it. */
export interface IFlowTokenUsageDependencies {
  readonly db: IDatabaseService | undefined;
  readonly eventLogger: IFlowEventLogger;
}

/** Aggregates the token usage of a finished flow and journals it. */
export class FlowTokenUsage {
  private readonly db: IDatabaseService | undefined;
  private readonly eventLogger: IFlowEventLogger;

  constructor(dependencies: IFlowTokenUsageDependencies) {
    this.db = dependencies.db;
    this.eventLogger = dependencies.eventLogger;
  }

  /**
   * Aggregate token usage across all LLM calls in a flow and log summary
   */
  async aggregateAndLogTokenUsage(
    flowRunId: string,
    flowId: string,
    traceId: string,
    requestId?: Opt<string, Reason.OptionalContext>,
  ): Promise<IFlowResult["tokenSummary"] | null> {
    try {
      // Query all LLM usage events for this trace
      const tokenEvents = await this.db!.queryActivity({
        traceId,
        actionType: "llm.usage",
      });

      if (tokenEvents.length === 0) {
        // No token usage found, log zero summary
        await this.eventLogger.log(DomainEventType.FlowTokenSummary, {
          flowRunId,
          flowId,
          totalLlmCalls: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCostUsd: 0,
          providers: {},
          traceId,
          requestId,
        });
        return null;
      }

      // Aggregate token usage by provider
      const providerStats: Record<string, {
        calls: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
      }> = {};

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;
      const models = new Set<string>();

      for (const event of tokenEvents) {
        try {
          const payload = JSON.parse(event.payload);
          const provider = payload.provider || event.target || "unknown";
          const inputTokens = payload.input_tokens ?? payload.prompt_tokens ?? 0;
          const outputTokens = payload.output_tokens ?? payload.completion_tokens ?? 0;
          const costUsd = payload.cost_usd || 0;
          const model = payload.model as string | undefined;

          // Initialize provider stats if not exists
          if (!providerStats[provider]) {
            providerStats[provider] = {
              calls: 0,
              inputTokens: 0,
              outputTokens: 0,
              costUsd: 0,
            };
          }

          // Accumulate stats
          providerStats[provider].calls++;
          providerStats[provider].inputTokens += inputTokens;
          providerStats[provider].outputTokens += outputTokens;
          providerStats[provider].costUsd += costUsd;

          totalInputTokens += inputTokens;
          totalOutputTokens += outputTokens;
          totalCostUsd += costUsd;
          if (model) {
            models.add(model);
          }
        } catch (_parseError) {
          // Skip malformed token events
          console.warn(`Skipping malformed token event: ${event.payload}`);
        }
      }

      // Log aggregated token summary
      await this.eventLogger.log(DomainEventType.FlowTokenSummary, {
        flowRunId,
        flowId,
        totalLlmCalls: tokenEvents.length,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        totalCostUsd: Math.round(totalCostUsd * DEFAULT_COST_PRECISION_FACTOR) / DEFAULT_COST_PRECISION_FACTOR, // Round to 4 decimal places
        providers: providerStats,
        traceId,
        requestId,
      });

      return {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
        token_provider: Object.keys(providerStats).join(", ") || undefined,
        token_model: models.size > 0 ? Array.from(models).join(", ") : undefined,
        token_cost_usd: Math.round(totalCostUsd * DEFAULT_COST_PRECISION_FACTOR) / DEFAULT_COST_PRECISION_FACTOR,
      };
    } catch (error) {
      // Log error but don't fail the flow
      console.warn(`Failed to aggregate token usage for flow ${flowRunId}:`, error);
      try {
        await this.eventLogger.log(DomainEventType.FlowTokenSummaryError, {
          flowRunId,
          flowId,
          error: error instanceof Error ? error.message : String(error),
          traceId,
          requestId,
        });
      } catch {
        // Swallow logging errors to avoid cascading failures
      }
      return null;
    }
  }
}
