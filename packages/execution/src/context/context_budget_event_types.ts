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
import type { ITokenSource } from "@exaix/schemas/execution/context_budget.ts";

export interface IContextBudgetEventPayloadMap {
  [DomainEventType.ContextBudgetAllocated]: {
    model: string;
    totalTokens: number;
    safetyBufferTokens: number;
    sections: Record<string, number>;
    tokenSource: ITokenSource;
  };
  [DomainEventType.ContextBudgetConsumed]: {
    section: string;
    allocatedTokens: number;
    actualTokens: number;
    truncated: boolean;
    tokenSource: ITokenSource;
  };
  [DomainEventType.ContextSectionTruncated]: {
    section: string;
    allocatedTokens: number;
    actualTokens: number;
    truncatedAtChar: number;
    tokenSource: ITokenSource;
  };
  [DomainEventType.ContextBudgetExceeded]: {
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
