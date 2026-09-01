/**
 * @module MemoryCostRouter
 * @path packages/core/src/cost/memory_cost_router.ts
 * @description Cost-aware memory storage tier router. Decides whether
 * remote (paid) memory operations should be allowed based on a daily
 * budget cap, and records operation costs for ongoing budget tracking.
 * Falls back to LOCAL (free) tier when the budget is exhausted.
 * @architectural-layer Domain
 * @related-files [packages/core/src/types/i_memory_cost_router.ts, packages/core/src/cost/cost_tracker.ts, packages/memory/src/embedding/provider_embedding_service.ts]
 */
import type { IEventLogger } from "../logger/mod.ts";
import type { ICostTracker } from "../types/mod.ts";
import type { IMemoryBudgetStatus, IMemoryCostRouter } from "../types/mod.ts";
import type { Opt, Reason } from "../types/optional_marker.ts";
import { MemoryStorageTier } from "../types/enums.ts";
import type { MemoryCostOperation } from "../types/enums.ts";
import { DomainEventType } from "../events/domain_event_types.ts";
import { DEFAULT_MEMORY_REMOTE_BUDGET_USD, MEMORY_EVENT_TIER_SELECTED } from "../types/constants.ts";

const REMOTE_COST_PROVIDER_NAME = "memory_remote";

/**
 * Reason strings emitted in tier_selected events for observability.
 */
const REASON_BUDGET_EXHAUSTED = "daily_budget_exhausted";
const REASON_WITHIN_BUDGET = "within_daily_budget";
const REASON_NO_COST_TRACKER = "no_cost_tracker_configured";

/** Gates remote (paid) memory embedding calls behind a daily USD budget — falls back to
 * LOCAL when no cost tracker is configured or budget is exhausted; costs are recorded
 * under the synthetic "memory_remote" provider so they don't collide with LLM budgets. */
export class MemoryCostRouter implements IMemoryCostRouter {
  private _selectedTier: MemoryStorageTier = MemoryStorageTier.LOCAL;

  /** Without a `costTracker`, `isRemoteAllowed()` always returns LOCAL (conservative
   *  default — no budget data means no remote operations). */
  constructor(
    private costTracker?: Opt<ICostTracker, Reason.OptionalDependency>,
    private logger?: Opt<IEventLogger, Reason.OptionalDependency>,
    private dailyBudgetUsd: number = DEFAULT_MEMORY_REMOTE_BUDGET_USD,
  ) {}

  get selectedTier(): MemoryStorageTier {
    return this._selectedTier;
  }

  /** Gates remote memory ops on the daily budget: no tracker or budget exhausted → LOCAL,
   *  else REMOTE. Emits a `memory.tier_selected` event either way. */
  async isRemoteAllowed(): Promise<boolean> {
    if (!this.costTracker) {
      this._selectedTier = MemoryStorageTier.LOCAL;
      await this.emitTierSelected(
        MemoryStorageTier.LOCAL,
        REASON_NO_COST_TRACKER,
        0,
      );
      return false;
    }

    const dailyCost = await this.costTracker.getDailyCost(REMOTE_COST_PROVIDER_NAME);
    const withinBudget = dailyCost < this.dailyBudgetUsd;

    if (!withinBudget) {
      this._selectedTier = MemoryStorageTier.LOCAL;
      await this.emitTierSelected(
        MemoryStorageTier.LOCAL,
        REASON_BUDGET_EXHAUSTED,
        dailyCost,
      );
      return false;
    }

    this._selectedTier = MemoryStorageTier.REMOTE;
    await this.emitTierSelected(
      MemoryStorageTier.REMOTE,
      REASON_WITHIN_BUDGET,
      dailyCost,
    );
    return true;
  }

  /** Persists cost under the synthetic `"memory_remote"` provider; silently dropped when
   *  no tracker is configured. Tokens are reported as 0 — embedding APIs don't expose
   *  per-request token counts, so `costUsd` is an approximation. */
  async recordOperation(costUsd: number, operation: MemoryCostOperation): Promise<void> {
    if (!this.costTracker) return;

    await this.costTracker.persistEntry({
      id: crypto.randomUUID(),
      provider: REMOTE_COST_PROVIDER_NAME,
      model: operation,
      tokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: costUsd,
      timestamp: new Date(),
    });

    await this.logger?.info(DomainEventType.MemoryCostRecorded, REMOTE_COST_PROVIDER_NAME, {
      costUsd,
      operation,
    });
  }

  async getBudgetStatus(): Promise<IMemoryBudgetStatus> {
    if (!this.costTracker) {
      return {
        dailyBudget: this.dailyBudgetUsd,
        dailyCost: 0,
        withinBudget: true,
      };
    }

    const dailyCost = await this.costTracker.getDailyCost(REMOTE_COST_PROVIDER_NAME);
    return {
      dailyBudget: this.dailyBudgetUsd,
      dailyCost,
      withinBudget: dailyCost < this.dailyBudgetUsd,
    };
  }

  /** Emits `memory.tier_selected` with tier, reason, and daily cost for downstream
   *  log dashboards / CLI reporting. */
  private async emitTierSelected(
    tier: MemoryStorageTier,
    reason: string,
    dailyCost: number,
  ): Promise<void> {
    if (!this.logger) return;

    await this.logger.info(
      MEMORY_EVENT_TIER_SELECTED,
      `memory_tier:${tier}`,
      {
        tier,
        reason,
        dailyCostUsd: dailyCost,
        dailyBudgetUsd: this.dailyBudgetUsd,
      },
    );
  }
}
