/**
 * @module ContextBudgetEventTypes
 * @path packages/execution/src/context/context_budget_event_types.ts
 * @description Typed payload map for context budget event types.
 * @architectural-layer Services
 * @dependencies ["@exaix/core", "@exaix/core/events", "@exaix/schemas/execution/context_budget.ts"]
 * @related-files [
 *   "packages/execution/src/context/context_budget_manager.ts",
 *   "packages/core/src/types/constants.ts"
 * ]
 */

import type { IContextBudgetSnapshot } from "@exaix/schemas/execution/context_budget.ts";
import type { DomainEventType } from "@exaix/core/events";
import type {
  CONTEXT_BUDGET_ALLOCATED,
  CONTEXT_BUDGET_CONSUMED,
  CONTEXT_BUDGET_EXCEEDED,
  CONTEXT_SECTION_TRUNCATED,
} from "@exaix/core";
import type { ITokenSource } from "@exaix/schemas/execution/context_budget.ts";

export interface IContextBudgetEventPayloadMap {
  [CONTEXT_BUDGET_ALLOCATED]: {
    model: string;
    totalTokens: number;
    safetyBufferTokens: number;
    sections: Record<string, number>;
    tokenSource: ITokenSource;
  };
  [CONTEXT_BUDGET_CONSUMED]: {
    section: string;
    allocatedTokens: number;
    actualTokens: number;
    truncated: boolean;
    tokenSource: ITokenSource;
  };
  [CONTEXT_SECTION_TRUNCATED]: {
    section: string;
    allocatedTokens: number;
    actualTokens: number;
    truncatedAtChar: number;
    tokenSource: ITokenSource;
  };
  [CONTEXT_BUDGET_EXCEEDED]: {
    model: string;
    contextWindow: number;
    estimatedTokens: number;
    sectionBreakdown: Record<string, number>;
    tokenSource: ITokenSource;
  };
  [DomainEventType.ExecutionContextCompacted]: {
    snapshot: IContextBudgetSnapshot;
    tokensBefore: number;
    tokensAfter: number;
    compressedSegmentCount: number;
  };
}
