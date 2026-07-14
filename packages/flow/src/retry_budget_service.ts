/**
 * @module RetryBudgetService
 * @path packages/flow/src/retry_budget_service.ts
 * @description Retry backoff timing and cumulative-cost budget enforcement
 *   for FlowRunner's step retry recovery policy. Extracted from FlowRunner.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import type { IDatabaseService } from "@exaix/storage-sqlite";
import type { Config } from "@exaix/schemas/config.ts";
import type { JSONValue } from "@exaix/core";
import { DEFAULT_TIMEOUT_MS } from "@exaix/core";
import { RetryPolicy } from "@exaix/core/request";
import type { Opt, Reason } from "@exaix/core/types";
import { FlowExecutionError } from "./flow_runner.ts";

/** Computes retry backoff delays and enforces the per-flow cumulative retry-cost budget. */
export class RetryBudgetService {
  constructor(
    private config: Opt<Config, Reason.OptionalDependency>,
    private db: Opt<IDatabaseService, Reason.OptionalDependency>,
  ) {}

  async applyRetryBackoff(backoffMs: number, retryAttempt: number): Promise<void> {
    const retryPolicy = new RetryPolicy({
      initialDelayMs: backoffMs,
      maxDelayMs: DEFAULT_TIMEOUT_MS,
      backoffMultiplier: 2,
      jitterFactor: 0,
    });

    const delayMs = retryPolicy.calculateDelay(retryAttempt);
    if (Deno.env.get("DENO_TEST") !== "1") {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  async enforceRetryCostBudget(
    flowRunId: string,
    request: { traceId?: string },
  ): Promise<void> {
    const maxFlowRetryCostUsd = this.config?.max_flow_retry_cost_usd;
    if (!this.db || !request.traceId || !maxFlowRetryCostUsd || maxFlowRetryCostUsd <= 0) {
      return;
    }

    const totalCostUsd = await this.getCumulativeFlowCostUsd(request.traceId);
    if (totalCostUsd > maxFlowRetryCostUsd) {
      throw new FlowExecutionError("Retry budget exceeded", flowRunId);
    }
  }

  private async getCumulativeFlowCostUsd(traceId: string): Promise<number> {
    const tokenEvents = await this.db!.queryActivity({
      traceId,
      actionType: "llm.usage",
    });

    let totalCostUsd = 0;
    for (const event of tokenEvents) {
      try {
        const payload = JSON.parse(event.payload) as Record<string, JSONValue>;
        const rawCost = payload.cost_usd;
        const costUsd = typeof rawCost === "number" ? rawCost : Number(rawCost ?? 0);
        if (Number.isFinite(costUsd)) {
          totalCostUsd += costUsd;
        }
      } catch {
        // Ignore malformed activity rows when calculating the retry budget.
      }
    }

    return totalCostUsd;
  }
}
