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
import {
  FLOW_RETRY_BUDGET_EXCEEDED_CODE,
  FLOW_RETRY_BUDGET_UNAVAILABLE_CODE,
  FlowControlError,
} from "./errors/flow_control_errors.ts";

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
    if (!maxFlowRetryCostUsd || maxFlowRetryCostUsd <= 0) {
      return;
    }

    if (!this.db || !request.traceId) {
      throw new FlowControlError(FLOW_RETRY_BUDGET_UNAVAILABLE_CODE, `Retry budget unavailable for ${flowRunId}`);
    }
    let totalCostUsd: number;
    try {
      totalCostUsd = await this.getCumulativeFlowCostUsd(request.traceId);
    } catch {
      throw new FlowControlError(FLOW_RETRY_BUDGET_UNAVAILABLE_CODE, `Retry usage query failed for ${flowRunId}`);
    }
    if (totalCostUsd >= maxFlowRetryCostUsd) {
      throw new FlowControlError(FLOW_RETRY_BUDGET_EXCEEDED_CODE, "Retry budget exceeded");
    }
  }

  private async getCumulativeFlowCostUsd(traceId: string): Promise<number> {
    const tokenEvents = await this.db!.queryActivity({
      traceId,
      actionType: "llm.usage",
      limit: Number.MAX_SAFE_INTEGER,
    });

    let totalCostUsd = 0;
    for (const event of tokenEvents) {
      try {
        const payload = JSON.parse(event.payload) as Record<string, JSONValue>;
        if (payload.cost_status === "unknown") throw new Error("Retry usage cost is unknown");
        const rawCost = payload.cost_usd;
        if (typeof rawCost !== "number" && (typeof rawCost !== "string" || rawCost.trim() === "")) {
          throw new Error("Retry usage cost is missing");
        }
        const costUsd = typeof rawCost === "number" ? rawCost : Number(rawCost);
        if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error("Retry usage cost is invalid");
        totalCostUsd += costUsd;
      } catch {
        throw new Error("Retry usage cost is unavailable");
      }
    }

    return totalCostUsd;
  }
}
