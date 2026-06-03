/**
 * @module ContextBudgetEventTypes
 * @path packages/execution/src/context/context_budget_event_types.ts
 * @description Typed payload map for all CONTEXT_BUDGET_* EventLogger events.
 * Prevents fragile weakly-typed assertions in tests and audit code.
 * @architectural-layer Services
 * @dependencies ["@exaix/core", "@exaix/schemas/execution/context_budget.ts"]
 * @related-files [
 *   "packages/execution/src/context/context_budget_manager.ts",
 *   "packages/core/src/types/constants.ts"
 * ]
 */

import type { IContextBudgetSnapshot } from "@exaix/schemas/execution/context_budget.ts";
import type {
  CONTEXT_BUDGET_ALLOCATED,
  CONTEXT_BUDGET_COMPACTED_EVENT,
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
  [CONTEXT_BUDGET_COMPACTED_EVENT]: {
    snapshot: IContextBudgetSnapshot;
    tokensBefore: number;
    tokensAfter: number;
    compressedSegmentCount: number;
  };
}
