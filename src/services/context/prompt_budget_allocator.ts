/**
 * @module PromptBudgetAllocator
 * @path src/services/context/prompt_budget_allocator.ts
 * @description Dynamic prompt budget allocator with waterfall reallocation logic.
 * Phase 62 Step 62.2 implementation.
 * @architectural-layer Services
 * @related-files ["packages/schemas/src/prompt_budget.ts", "packages/core/src/types/constants.ts"]
 */

import {
  LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK,
  LOCAL_PROVIDER_PREFIXES,
  MODEL_CONTEXT_WINDOWS,
  SECTION_BASE_WEIGHTS,
  SECTION_FLOORS,
} from "@exaix/core";
import {
  type IBudgetPolicy,
  type IPromptBudget,
  type IPromptBudgetSections,
  ZBudgetPolicy,
} from "@exaix/schemas/prompt_budget.ts";

/**
 * Options to hint at actual content usage for waterfall reallocation.
 */
export interface IAllocationHints {
  memoryUsedTokens?: number;
  skillsUsedTokens?: number;
  loopHistoryUsedTokens?: number;
  systemUsedTokens?: number;
  planUsedTokens?: number;
  portalKnowledgeUsedTokens?: number;
}

/**
 * PromptBudgetAllocator calculates dynamic context budgets for each prompt section,
 * enforcing minimum floors and reallocating surplus from empty sections to high-priority ones.
 */
export class PromptBudgetAllocator {
  private readonly policy: IBudgetPolicy;

  constructor(policy?: Partial<IBudgetPolicy>) {
    this.policy = ZBudgetPolicy.parse(policy ?? {});
  }

  /**
   * Allocate budgets across prompt sections for a given model.
   *
   * @param modelId Provider:model identifier (e.g., "openai:gpt-4o-mini")
   * @param hints Optional usage hints for waterfall reallocation
   * @returns Allocated budget enforcing floors and waterfall logic
   */
  allocate(modelId: string, hints?: IAllocationHints): IPromptBudget {
    const isLocalModel = this._isLocalModel(modelId);
    const totalTokens = this._resolveTotalTokens(modelId, isLocalModel);
    const enforcementEnabled = isLocalModel ? this.policy.local : this.policy.cloud;

    if (!enforcementEnabled) {
      return this._buildRelaxedBudget(modelId, totalTokens);
    }

    // Apply 10% safety buffer
    const safetyBufferTokens = Math.floor(totalTokens * 0.1);
    const usableTokens = totalTokens - safetyBufferTokens;

    // Initialize sections with base weights
    const sections: IPromptBudgetSections = {
      system: Math.floor(usableTokens * SECTION_BASE_WEIGHTS.system),
      plan: Math.floor(usableTokens * SECTION_BASE_WEIGHTS.plan),
      portalKnowledge: Math.floor(
        usableTokens * SECTION_BASE_WEIGHTS.portalKnowledge,
      ),
      memory: Math.floor(usableTokens * SECTION_BASE_WEIGHTS.memory),
      skills: Math.floor(usableTokens * SECTION_BASE_WEIGHTS.skills),
      loopHistory: Math.floor(usableTokens * SECTION_BASE_WEIGHTS.loopHistory),
    };

    // Enforce minimum floors for critical sections
    if (sections.system < SECTION_FLOORS.system) {
      sections.system = SECTION_FLOORS.system;
    }
    if (sections.plan < SECTION_FLOORS.plan) {
      sections.plan = SECTION_FLOORS.plan;
    }

    // Waterfall reallocation: shift surplus from empty low-priority sections
    // to high-priority sections (Plan, then System, then Portal Knowledge)
    const surplus = this._calculateSurplus(sections, hints);

    if (surplus > 0) {
      // Give surplus to Plan first (highest priority after System)
      sections.plan += Math.floor(surplus * 0.5);
      // Then give remainder to Portal Knowledge (second priority)
      sections.portalKnowledge += Math.floor(surplus * 0.3);
      // Remaining goes to System
      sections.system += Math.floor(surplus * 0.2);
    }

    return {
      model: modelId,
      totalBudgetTokens: totalTokens,
      safetyBufferTokens,
      sections,
    };
  }

  private _isLocalModel(modelId: string): boolean {
    return LOCAL_PROVIDER_PREFIXES.some((prefix) => modelId.startsWith(prefix));
  }

  private _resolveTotalTokens(modelId: string, isLocalModel: boolean): number {
    const configuredWindow = MODEL_CONTEXT_WINDOWS[modelId as keyof typeof MODEL_CONTEXT_WINDOWS];
    if (configuredWindow !== undefined) {
      return configuredWindow;
    }

    if (isLocalModel) {
      return LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK;
    }

    return MODEL_CONTEXT_WINDOWS["openai:gpt-4o-mini"] ?? 128_000;
  }

  private _buildRelaxedBudget(modelId: string, totalTokens: number): IPromptBudget {
    const uncappedSections: IPromptBudgetSections = {
      system: totalTokens,
      plan: totalTokens,
      portalKnowledge: totalTokens,
      memory: totalTokens,
      skills: totalTokens,
      loopHistory: totalTokens,
    };

    return {
      model: modelId,
      totalBudgetTokens: totalTokens,
      safetyBufferTokens: 0,
      sections: uncappedSections,
    };
  }

  /**
   * Calculate surplus tokens from empty low-priority sections.
   */
  private _calculateSurplus(
    sections: IPromptBudgetSections,
    hints?: IAllocationHints,
  ): number {
    let surplus = 0;

    // If memory is empty or has very little content, its allocation becomes surplus
    if (!hints?.memoryUsedTokens || hints.memoryUsedTokens < 100) {
      surplus += sections.memory;
      sections.memory = 0;
    }

    // If skills is empty or has very little content, its allocation becomes surplus
    if (!hints?.skillsUsedTokens || hints.skillsUsedTokens < 100) {
      surplus += sections.skills;
      sections.skills = 0;
    }

    // If loop history is empty or has very little content, its allocation becomes surplus
    if (!hints?.loopHistoryUsedTokens || hints.loopHistoryUsedTokens < 100) {
      surplus += sections.loopHistory;
      sections.loopHistory = 0;
    }

    return surplus;
  }
}
