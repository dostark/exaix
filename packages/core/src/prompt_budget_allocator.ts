/**
 * @module PromptBudgetAllocator
 * @path packages/core/src/prompt_budget_allocator.ts
 * @related-files []
 * @architectural-layer Core
 * @description Dynamic prompt budget allocator with waterfall reallocation logic.
 */

import {
  DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED,
  DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED,
  LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK,
  LOCAL_PROVIDER_PREFIXES,
  MODEL_CONTEXT_WINDOWS,
  SECTION_BASE_WEIGHTS,
  SECTION_FLOORS,
} from "../mod.ts";
import type { IBudgetPolicy, IPromptBudget, IPromptBudgetSections } from "@exaix/schemas/prompt_budget.ts";
import type { ITokenizer } from "./func/tokenizer.ts";
import { AiTokenEstimatorTokenizer } from "./func/tokenizer.ts";
import { ContextBudgetExceededError } from "./errors/context_budget_error.ts";

export interface IAllocationHints {
  memoryUsedTokens?: number;
  skillsUsedTokens?: number;
  loopHistoryUsedTokens?: number;
  systemUsedTokens?: number;
  planUsedTokens?: number;
  portalKnowledgeUsedTokens?: number;
}

function normalizeBudgetPolicy(policy?: Partial<IBudgetPolicy>): IBudgetPolicy {
  return {
    cloud: policy?.cloud ?? DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED,
    local: policy?.local ?? DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED,
    enabled: policy?.enabled,
  };
}

export class PromptBudgetAllocator {
  private readonly policy: IBudgetPolicy;
  private readonly tokenizer: ITokenizer;

  constructor(policy?: Partial<IBudgetPolicy>, tokenizer?: ITokenizer) {
    this.policy = normalizeBudgetPolicy(policy);
    this.tokenizer = tokenizer ?? new AiTokenEstimatorTokenizer();
  }

  allocate(modelId: string, hints?: IAllocationHints): Promise<IPromptBudget> {
    const isLocalModel = this._isLocalModel(modelId);
    const totalTokens = this._resolveTotalTokens(modelId, isLocalModel);

    const enforcementEnabled = this.policy.enabled ??
      (isLocalModel ? this.policy.local : this.policy.cloud);

    if (!enforcementEnabled) {
      return Promise.resolve(this._buildRelaxedBudget(modelId, totalTokens));
    }

    const safetyBufferTokens = Math.floor(totalTokens * 0.1);
    const usableTokens = totalTokens - safetyBufferTokens;

    const sections: IPromptBudgetSections = {
      system: Math.floor(usableTokens * SECTION_BASE_WEIGHTS.system),
      plan: Math.floor(usableTokens * SECTION_BASE_WEIGHTS.plan),
      portalKnowledge: Math.floor(usableTokens * SECTION_BASE_WEIGHTS.portalKnowledge),
      memory: Math.floor(usableTokens * SECTION_BASE_WEIGHTS.memory),
      skills: Math.floor(usableTokens * SECTION_BASE_WEIGHTS.skills),
      loopHistory: Math.floor(usableTokens * SECTION_BASE_WEIGHTS.loopHistory),
    };

    if (sections.system < SECTION_FLOORS.system) {
      sections.system = SECTION_FLOORS.system;
    }
    if (sections.plan < SECTION_FLOORS.plan) {
      sections.plan = SECTION_FLOORS.plan;
    }

    const surplus = this._calculateSurplus(sections, hints);

    if (surplus > 0) {
      sections.plan += Math.floor(surplus * 0.5);
      sections.portalKnowledge += Math.floor(surplus * 0.3);
      sections.system += Math.floor(surplus * 0.2);
    }

    // Check if estimated usage exceeds context window
    const hintTotal = this._calculateHintTotal(hints);
    const allocatedTotal = sections.system + sections.plan +
      sections.portalKnowledge + sections.memory +
      sections.skills + sections.loopHistory;
    const estimatedTotal = Math.max(allocatedTotal, hintTotal);

    if (estimatedTotal > totalTokens) {
      return Promise.reject(
        new ContextBudgetExceededError(
          `Budget exceeded for ${modelId}: estimated ${estimatedTotal} > ${totalTokens} context window (${
            Object.keys(sections).length
          } sections)`,
          modelId,
          totalTokens,
          estimatedTotal,
          { ...sections },
        ),
      );
    }

    return Promise.resolve({
      model: modelId,
      totalBudgetTokens: totalTokens,
      safetyBufferTokens,
      sections,
    });
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

  private _calculateSurplus(
    sections: IPromptBudgetSections,
    hints?: IAllocationHints,
  ): number {
    let surplus = 0;

    if (!hints?.memoryUsedTokens || hints.memoryUsedTokens < 100) {
      surplus += sections.memory;
      sections.memory = 0;
    }

    if (!hints?.skillsUsedTokens || hints.skillsUsedTokens < 100) {
      surplus += sections.skills;
      sections.skills = 0;
    }

    if (!hints?.loopHistoryUsedTokens || hints.loopHistoryUsedTokens < 100) {
      surplus += sections.loopHistory;
      sections.loopHistory = 0;
    }

    return surplus;
  }

  /** Sum hinted usage values, or 0 if no hints provided. */
  private _calculateHintTotal(hints?: IAllocationHints): number {
    if (!hints) return 0;
    return (hints.systemUsedTokens ?? 0) +
      (hints.planUsedTokens ?? 0) +
      (hints.portalKnowledgeUsedTokens ?? 0) +
      (hints.memoryUsedTokens ?? 0) +
      (hints.skillsUsedTokens ?? 0) +
      (hints.loopHistoryUsedTokens ?? 0);
  }
}
