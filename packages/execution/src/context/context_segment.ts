/**
 * @module ContextSegment
 * @path packages/execution/src/context/context_segment.ts
 * @description IContextSegment and IContextSegmentMetadata types for the segment-level
 * context budget manager. Segments are typed, prioritised units of prompt content.
 * @architectural-layer Services
 * @dependencies ["@exaix/schemas/execution/context_budget.ts"]
 * @related-files [
 *   "packages/execution/src/context/context_budget_manager.ts",
 *   "packages/schemas/src/execution/context_budget.ts",
 *   "packages/core/src/types/constants.ts"
 * ]
 */

import type { IContextSegmentKind } from "@exaix/schemas/execution/context_budget.ts";

/** Named metadata fields for context segments. */
export interface IContextSegmentMetadata {
  /** ID of the flow/plan step that produced this segment. */
  sourceStepId?: string;
  /** MCP tool name that generated this segment (for tool_result kind). */
  sourceToolName?: string;
  /** ReAct iteration index during which this segment was produced. */
  iterationIndex?: number;
  /** When true, the budget manager always keeps this segment regardless of priority or budget. */
  nonCompactable?: boolean;
}

/** A typed, prioritised unit of prompt content fed to IContextBudgetManager. */
export interface IContextSegment {
  /** Unique ID for this segment within the prepare() call. */
  segmentId: string;
  /** Semantic category determining default priority and compaction eligibility. */
  kind: IContextSegmentKind;
  /** Raw text content of this segment. */
  content: string;
  /** 0–100, higher = more protected. Use CONTEXT_PRIORITY_* constants from @exaix/core.
   *  Tie-break: insertion order (FIFO). */
  priority: number;
  /** Callers must populate this using ITokenizer.countTokens(content, model) from
   *  packages/core/src/func/tokenizer.ts — do not introduce a new estimator. */
  tokenEstimate: number;
  /** Optional named metadata — always use a named interface, not an anonymous map. */
  metadata: IContextSegmentMetadata;
}
