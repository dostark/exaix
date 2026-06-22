/**
 * @module PromptBudgetAllocator
 * @path packages/core/src/prompt_budget_allocator.ts
 * @related-files []
 * @architectural-layer Core
 * @description Dynamic prompt budget allocator with waterfall reallocation logic.
 */

import {
  ADJUSTMENT_EPSILON,
  ADJUSTMENT_FILE_COUNT_THRESHOLD,
  ADJUSTMENT_PLAN_BOOST,
  ADJUSTMENT_PLAN_REDUCTION,
  ADJUSTMENT_PORTAL_KNOWLEDGE_BOOST,
  ADJUSTMENT_PORTAL_KNOWLEDGE_REDUCTION,
  ADJUSTMENT_PRECISION,
  DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED,
  DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED,
  LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK,
  LOCAL_PROVIDER_PREFIXES,
  MINIMUM_HINT_THRESHOLD,
  MODEL_CONTEXT_WINDOWS,
  SAFETY_BUFFER_RATIO,
  SECTION_BASE_WEIGHTS,
  SECTION_FLOORS,
  SECTION_WEIGHT_RATIO_FLOORS,
  SURPLUS_PLAN_RATIO,
  SURPLUS_PORTAL_KNOWLEDGE_RATIO,
  SURPLUS_SYSTEM_RATIO,
} from "../mod.ts";
import type { IBudgetPolicy, IPromptBudget, IPromptBudgetSections } from "@exaix/schemas/prompt_budget.ts";
import type { ITokenizer } from "./func/tokenizer.ts";
import { AiTokenEstimatorTokenizer } from "./func/tokenizer.ts";
import { ContextBudgetExceededError } from "./errors/context_budget_error.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { IEventLogger } from "./logger/event_logger.ts";
import { DomainEventType } from "@exaix/core/events";
import { TaskType } from "./types/enums.ts";
import type { Opt, Reason } from "@exaix/core/types";

export interface IAllocationHints {
  memoryUsedTokens?: number;
  skillsUsedTokens?: number;
  loopHistoryUsedTokens?: number;
  systemUsedTokens?: number;
  planUsedTokens?: number;
  portalKnowledgeUsedTokens?: number;
}

/** Mutable weight ratios for budget section allocation. */
export interface IPromptBudgetSectionsWeights {
  system: number;
  plan: number;
  portalKnowledge: number;
  memory: number;
  skills: number;
  loopHistory: number;
}

function normalizeBudgetPolicy(
  policy?: Opt<Partial<IBudgetPolicy>, Reason.FactoryPreset>,
): IBudgetPolicy {
  return {
    cloud: policy?.cloud ?? DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED,
    local: policy?.local ?? DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED,
    enabled: policy?.enabled,
  };
}

export class PromptBudgetAllocator {
  private readonly policy: IBudgetPolicy;
  private readonly tokenizer: ITokenizer;
  private readonly logger?: IEventLogger;

  constructor(policy?: Partial<IBudgetPolicy>, tokenizer?: ITokenizer, logger?: IEventLogger) {
    this.policy = normalizeBudgetPolicy(policy);
    this.tokenizer = tokenizer ?? new AiTokenEstimatorTokenizer();
    this.logger = logger;
  }

  allocate(
    modelId: string,
    hints?: Opt<IAllocationHints, Reason.OptionalInput>,
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
  ): Promise<IPromptBudget> {
    const isLocalModel = this._isLocalModel(modelId);
    const totalTokens = this._resolveTotalTokens(modelId, isLocalModel);

    const enforcementEnabled = this.policy.enabled ??
      (isLocalModel ? this.policy.local : this.policy.cloud);

    if (!enforcementEnabled) {
      return Promise.resolve(this._buildRelaxedBudget(modelId, totalTokens));
    }

    // Apply request-adaptive weight reallocation when analysis is provided
    const weights = this._adjustWeights(analysis);

    const safetyBufferTokens = Math.floor(totalTokens * SAFETY_BUFFER_RATIO);
    const usableTokens = totalTokens - safetyBufferTokens;

    const sections: IPromptBudgetSections = {
      system: Math.floor(usableTokens * weights.system),
      plan: Math.floor(usableTokens * weights.plan),
      portalKnowledge: Math.floor(usableTokens * weights.portalKnowledge),
      memory: Math.floor(usableTokens * weights.memory),
      skills: Math.floor(usableTokens * weights.skills),
      loopHistory: Math.floor(usableTokens * weights.loopHistory),
    };

    if (sections.system < SECTION_FLOORS.system) {
      sections.system = SECTION_FLOORS.system;
    }
    if (sections.plan < SECTION_FLOORS.plan) {
      sections.plan = SECTION_FLOORS.plan;
    }

    const surplus = this._calculateSurplus(sections, hints);

    if (surplus > 0) {
      sections.plan += Math.floor(surplus * SURPLUS_PLAN_RATIO);
      sections.portalKnowledge += Math.floor(surplus * SURPLUS_PORTAL_KNOWLEDGE_RATIO);
      sections.system += Math.floor(surplus * SURPLUS_SYSTEM_RATIO);
    }

    // Check if estimated usage exceeds context window
    const hintTotal = this._calculateHintTotal(hints);
    const allocatedTotal = sections.system + sections.plan +
      sections.portalKnowledge + sections.memory +
      sections.skills + sections.loopHistory;
    const estimatedTotal = Math.max(allocatedTotal, hintTotal);

    if (estimatedTotal > totalTokens) {
      this.logger?.info(DomainEventType.ContextBudgetExceeded, "", {
        model: modelId,
        contextWindow: totalTokens,
        estimatedTokens: estimatedTotal,
        sectionBreakdown: { ...sections },
        tokenSource: "bpe",
      });
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

    const budget: IPromptBudget = {
      model: modelId,
      totalBudgetTokens: totalTokens,
      safetyBufferTokens,
      sections,
    };

    this.logger?.info(DomainEventType.ContextBudgetAllocated, "", {
      model: modelId,
      totalTokens,
      safetyBufferTokens,
      sections: { ...sections },
      tokenSource: "bpe",
    });

    return Promise.resolve(budget);
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
    hints?: Opt<IAllocationHints, Reason.OptionalInput>,
  ): number {
    let surplus = 0;

    if (!hints?.memoryUsedTokens || hints.memoryUsedTokens < MINIMUM_HINT_THRESHOLD) {
      surplus += sections.memory;
      sections.memory = 0;
    }

    if (!hints?.skillsUsedTokens || hints.skillsUsedTokens < MINIMUM_HINT_THRESHOLD) {
      surplus += sections.skills;
      sections.skills = 0;
    }

    if (!hints?.loopHistoryUsedTokens || hints.loopHistoryUsedTokens < MINIMUM_HINT_THRESHOLD) {
      surplus += sections.loopHistory;
      sections.loopHistory = 0;
    }

    return surplus;
  }

  /** Sum hinted usage values, or 0 if no hints provided. */
  private _calculateHintTotal(hints?: Opt<IAllocationHints, Reason.OptionalInput>): number {
    if (!hints) return 0;
    return (hints.systemUsedTokens ?? 0) +
      (hints.planUsedTokens ?? 0) +
      (hints.portalKnowledgeUsedTokens ?? 0) +
      (hints.memoryUsedTokens ?? 0) +
      (hints.skillsUsedTokens ?? 0) +
      (hints.loopHistoryUsedTokens ?? 0);
  }

  /**
   * Adjust weight ratios based on request analysis.
   * Returns the adjusted weight object, or SECTION_BASE_WEIGHTS if no analysis.
   */
  private _adjustWeights(
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
  ): IPromptBudgetSectionsWeights {
    if (!analysis) return SECTION_BASE_WEIGHTS;

    const weights: IPromptBudgetSectionsWeights = { ...SECTION_BASE_WEIGHTS };

    // Apply task-type adjustments
    if (analysis.taskType === TaskType.FEATURE || analysis.taskType === TaskType.REFACTOR) {
      weights.plan += ADJUSTMENT_PLAN_BOOST;
      weights.portalKnowledge -= ADJUSTMENT_PORTAL_KNOWLEDGE_REDUCTION;
    } else if (analysis.taskType === TaskType.ANALYSIS || analysis.taskType === TaskType.DOCS) {
      weights.portalKnowledge += ADJUSTMENT_PORTAL_KNOWLEDGE_BOOST;
      weights.plan -= ADJUSTMENT_PLAN_REDUCTION;
    }

    // Apply file-count adjustments
    if (analysis.referencedFiles && analysis.referencedFiles.length > ADJUSTMENT_FILE_COUNT_THRESHOLD) {
      weights.portalKnowledge += ADJUSTMENT_PORTAL_KNOWLEDGE_BOOST;
      weights.skills -= ADJUSTMENT_PORTAL_KNOWLEDGE_BOOST;
    }

    // Re-normalize to sum exactly 1.0
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > ADJUSTMENT_EPSILON) {
      for (const key of Object.keys(weights) as Array<keyof IPromptBudgetSectionsWeights>) {
        weights[key] = +(weights[key] / sum).toFixed(ADJUSTMENT_PRECISION);
      }
    }

    // Clamp to ratio floors
    if (weights.system < SECTION_WEIGHT_RATIO_FLOORS.system) {
      weights.system = SECTION_WEIGHT_RATIO_FLOORS.system;
    }
    if (weights.plan < SECTION_WEIGHT_RATIO_FLOORS.plan) {
      weights.plan = SECTION_WEIGHT_RATIO_FLOORS.plan;
    }

    // Re-normalize again after clamping if needed
    const sum2 = Object.values(weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum2 - 1.0) > ADJUSTMENT_EPSILON) {
      for (const key of Object.keys(weights) as Array<keyof IPromptBudgetSectionsWeights>) {
        weights[key] = +(weights[key] / sum2).toFixed(ADJUSTMENT_PRECISION);
      }
    }

    return weights;
  }
}
