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
import { MemoryStorageTier } from "../types/enums.ts";
import { DEFAULT_MEMORY_REMOTE_BUDGET_USD, MEMORY_EVENT_TIER_SELECTED } from "../types/constants.ts";

const REMOTE_COST_PROVIDER_NAME = "memory_remote";

/**
 * Reason strings emitted in tier_selected events for observability.
 */
const REASON_BUDGET_EXHAUSTED = "daily_budget_exhausted";
const REASON_WITHIN_BUDGET = "within_daily_budget";
const REASON_NO_COST_TRACKER = "no_cost_tracker_configured";

/**
 * Cost-aware router for memory storage tier selection.
 *
 * ## What it does
 *
 * Before a memory service calls an embedding provider (which
 * costs money), it asks the MemoryCostRouter whether a remote
 * operation is allowed. The router checks:
 *
 * 1. Is a cost tracker configured? If not → LOCAL (no budget
 *    infrastructure available, conservatively use free tier).
 * 2. Has the daily budget for remote memory ops been reached?
 *    If exhausted → LOCAL.
 * 3. Otherwise → REMOTE allowed.
 *
 * ## Budget accounting
 *
 * Every `recordOperation()` call persists the cost via the
 * injected `ICostTracker`. The cost is tracked under a synthetic
 * provider name `"memory_remote"` so it doesn't interfere with
 * LLM provider-specific budgets.
 *
 * ## Event emission
 *
 * Each `isRemoteAllowed()` call emits a `memory.tier_selected`
 * event with the selected tier, reason, and current daily cost
 * for observability.
 */
export class MemoryCostRouter implements IMemoryCostRouter {
  private _selectedTier: MemoryStorageTier = MemoryStorageTier.LOCAL;

  /**
   * @param costTracker Optional cost tracker. When absent, the router
   *   always returns LOCAL (conservative default — no budget data
   *   means no remote operations).
   * @param logger Optional event logger. When absent, tier selection
   *   events are emitted as no-ops.
   * @param dailyBudgetUsd Daily budget cap for remote memory operations
   *   in USD. Defaults to `DEFAULT_MEMORY_REMOTE_BUDGET_USD` (2.00).
   */
  constructor(
    private costTracker?: ICostTracker,
    private logger?: IEventLogger,
    private dailyBudgetUsd: number = DEFAULT_MEMORY_REMOTE_BUDGET_USD,
  ) {}

  get selectedTier(): MemoryStorageTier {
    return this._selectedTier;
  }

  /**
   * Check whether a remote (paid) memory operation is allowed under
   * the current daily budget.
   *
   * Decision flow:
   * - No cost tracker → LOCAL. Without budget infrastructure we
   *   cannot track spend, so we conservatively block remote ops.
   * - Budget exhausted → LOCAL. Daily spend cap has been reached.
   * - Within budget → REMOTE. Remote operations are allowed.
   *
   * Emits `memory.tier_selected` event with the decision reason
   * and current daily cost for observability.
   */
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

  /**
   * Record the cost of a completed remote memory operation.
   *
   * Persists the cost via `ICostTracker.persistEntry()` under the
   * synthetic provider `"memory_remote"` so the daily accumulated
   * spend includes all embedding/remote memory costs.
   *
   * When no cost tracker is configured, the cost is silently dropped
   * (consistent with the conservative LOCAL-only behaviour).
   *
   * @param costUsd Actual cost of the operation in USD. Use a small
   *   value like `0.0002` for a single embedding query.
   */
  async recordOperation(costUsd: number): Promise<void> {
    if (!this.costTracker) return;

    await this.costTracker.persistEntry({
      id: crypto.randomUUID(),
      provider: REMOTE_COST_PROVIDER_NAME,
      model: "embedding",
      tokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: costUsd,
      timestamp: new Date(),
    });
  }

  /**
   * Returns the current budget status — daily budget cap, accumulated
   * daily cost for remote memory operations, and whether the operation
   * is within budget.
   */
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

  /**
   * Emit a `memory.tier_selected` event for observability.
   *
   * The event carries the selected tier, the reason code, and the
   * current daily cost so downstream consumers (log dashboards,
   * CLI reporting) can analyse memory cost behaviour.
   */
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
