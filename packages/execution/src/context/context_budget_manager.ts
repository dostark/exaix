/**
 * @module ContextBudgetManager
 * @path packages/execution/src/context/context_budget_manager.ts
 * @description IContextBudgetManager interface and ContextBudgetManager implementation.
 * Operates at segment level, consuming an IPromptBudget from PromptBudgetAllocator and
 * applying priority-driven keep/trim/drop decisions within each section's token limit.
 * @architectural-layer Services
 * @dependencies [
 *   "@exaix/schemas/execution/context_budget.ts",
 *   "@exaix/schemas/prompt_budget.ts",
 *   "packages/execution/src/context/context_segment.ts",
 *   "packages/core/src/types/constants.ts"
 * ]
 * @related-files ["packages/execution/src/agent_runner.ts"]
 */

import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import {
  ContextSegmentKindSchema,
  type IContextBudgetDecision,
  type IContextBudgetSnapshot,
} from "@exaix/schemas/execution/context_budget.ts";
import {
  CONTEXT_BUDGET_COMPACTED_EVENT,
  CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { ITokenizer } from "@exaix/core/func";
import type { IContextSegment } from "./context_segment.ts";
import type { IContextCompactor } from "./context_compactor.ts";
import type { ISnapshotStore } from "./snapshot_store.ts";

export interface IContextBudgetManagerInput {
  traceId: string;
  stepId: string;
  model: string;
  /** Section-level token limits from PromptBudgetAllocator.allocate(). */
  promptBudget: IPromptBudget;
  /** Segments to evaluate — may be empty; prepare() never throws on missing kinds. */
  segments: IContextSegment[];
}

export interface IContextBudgetManagerOutput {
  /** Segments that survived compaction, in original insertion order. */
  segments: IContextSegment[];
  /** Audit record of every decision taken. */
  snapshot: IContextBudgetSnapshot;
}

/**
 * Stateless contract for segment-level budget management.
 * prepare() takes all inputs by value and returns results — no mutable instance state.
 * Safe for concurrent use in parallel flow waves without locking.
 */
export interface IContextBudgetManager {
  prepare(input: IContextBudgetManagerInput): Promise<IContextBudgetManagerOutput>;
}

// ─── Protected kinds ──────────────────────────────────────────────────────────
// Segments of these kinds are always kept regardless of priority or budget pressure.
const ALWAYS_KEEP_KINDS = new Set<IContextSegment["kind"]>([
  ContextSegmentKindSchema.enum.system,
  ContextSegmentKindSchema.enum.request,
  ContextSegmentKindSchema.enum.acceptance_criteria,
]);

function isProtected(segment: IContextSegment): boolean {
  return ALWAYS_KEEP_KINDS.has(segment.kind) ||
    segment.metadata.nonCompactable === true ||
    segment.priority >= CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA;
}

/**
 * Map a segment kind to its corresponding section budget key.
 * Segments that don't map to a specific section fall back to the loopHistory budget.
 */
function sectionBudgetFor(
  kind: IContextSegment["kind"],
  sections: IPromptBudget["sections"],
): number {
  const k = ContextSegmentKindSchema.enum;
  switch (kind) {
    case k.system:
      return sections.system;
    case k.request:
    case k.acceptance_criteria:
    case k.plan_step:
      return sections.plan;
    case k.portal_knowledge:
      return sections.portalKnowledge;
    case k.reflection:
      return sections.memory;
    case k.tool_result:
    case k.summary:
    default:
      return sections.loopHistory;
  }
}

/**
 * Segment kinds that are eligible for async LLM summarization when dropped.
 * System/request/acceptance_criteria are protected and never reach this path.
 */
const ASYNC_COMPACTABLE_KINDS = new Set<IContextSegment["kind"]>([
  ContextSegmentKindSchema.enum.tool_result,
  ContextSegmentKindSchema.enum.portal_knowledge,
  ContextSegmentKindSchema.enum.reflection,
]);

/**
 * Default ContextBudgetManager implementation.
 * Synchronous tier: sort by priority descending, greedy-keep within section budgets.
 * No LLM calls in this tier — must complete within CONTEXT_BUDGET_OVERHEAD_TARGET_MS.
 * Async tier: schedules summarization for compactable dropped segments via queueMicrotask.
 */
export class ContextBudgetManager implements IContextBudgetManager {
  constructor(
    private readonly _tokenizer?: ITokenizer,
    private readonly compactor?: IContextCompactor,
    private readonly snapshotStore?: ISnapshotStore,
    private readonly logger?: IEventLogger,
  ) {}

  prepare(input: IContextBudgetManagerInput): Promise<IContextBudgetManagerOutput> {
    const startedAt = Date.now();
    const { traceId, stepId, model, promptBudget, segments } = input;

    const decisions: IContextBudgetDecision[] = [];
    const kept: IContextSegment[] = [];

    // Track consumed tokens per section key to respect section limits.
    const consumed: Record<string, number> = {};

    // Sort protected segments first, then by priority descending, preserving FIFO within ties.
    const sorted = [...segments].sort((a, b) => {
      const ap = isProtected(a) ? 1000 : a.priority;
      const bp = isProtected(b) ? 1000 : b.priority;
      return bp - ap;
    });

    for (const segment of sorted) {
      const sectionBudget = sectionBudgetFor(segment.kind, promptBudget.sections);
      const sectionKey = segment.kind;
      const used = consumed[sectionKey] ?? 0;

      if (isProtected(segment)) {
        kept.push(segment);
        consumed[sectionKey] = used + segment.tokenEstimate;
        decisions.push({
          segmentId: segment.segmentId,
          kind: segment.kind,
          action: "keep",
          originalTokens: segment.tokenEstimate,
          resultingTokens: segment.tokenEstimate,
          reason: "protected segment",
          createdAt: new Date().toISOString(),
        });
        continue;
      }

      const remaining = sectionBudget - used;

      if (remaining <= 0) {
        decisions.push({
          segmentId: segment.segmentId,
          kind: segment.kind,
          action: "drop",
          originalTokens: segment.tokenEstimate,
          resultingTokens: 0,
          reason: `section budget exhausted (${sectionKey}: ${sectionBudget} tokens)`,
          createdAt: new Date().toISOString(),
        });
        continue;
      }

      if (segment.tokenEstimate <= remaining) {
        kept.push(segment);
        consumed[sectionKey] = used + segment.tokenEstimate;
        decisions.push({
          segmentId: segment.segmentId,
          kind: segment.kind,
          action: "keep",
          originalTokens: segment.tokenEstimate,
          resultingTokens: segment.tokenEstimate,
          reason: "fits within section budget",
          createdAt: new Date().toISOString(),
        });
      } else {
        // Trim: truncate content to remaining budget (chars approximation).
        const maxChars = remaining * TOKEN_ESTIMATION_CHARS_PER_TOKEN;
        const trimmedContent = segment.content.slice(0, maxChars);
        const trimmedTokens = Math.floor(trimmedContent.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
        const trimmed: IContextSegment = {
          ...segment,
          content: trimmedContent,
          tokenEstimate: trimmedTokens,
        };
        kept.push(trimmed);
        consumed[sectionKey] = used + trimmedTokens;
        decisions.push({
          segmentId: segment.segmentId,
          kind: segment.kind,
          action: "trim",
          originalTokens: segment.tokenEstimate,
          resultingTokens: trimmedTokens,
          reason: `truncated to fit remaining section budget (${remaining} tokens)`,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Restore original insertion order.
    const segmentIdOrder = new Map(segments.map((s, i) => [s.segmentId, i]));
    kept.sort((a, b) => (segmentIdOrder.get(a.segmentId) ?? 0) - (segmentIdOrder.get(b.segmentId) ?? 0));

    const usedInputTokens = kept.reduce((sum, s) => sum + s.tokenEstimate, 0);
    const durationMs = Date.now() - startedAt;

    // Async tier: schedule LLM summarization for compactable dropped segments.
    const droppedCompactable = sorted.filter(
      (s) =>
        !kept.some((k) => k.segmentId === s.segmentId) &&
        ASYNC_COMPACTABLE_KINDS.has(s.kind) &&
        !isProtected(s),
    );
    const overflowRecovered = droppedCompactable.length > 0 && this.compactor !== undefined;

    const snapshot: IContextBudgetSnapshot = {
      traceId,
      stepId,
      model,
      maxContextTokens: promptBudget.totalBudgetTokens,
      usedInputTokens,
      decisions,
      overflowRecovered,
      durationMs,
    };

    if (overflowRecovered && this.compactor) {
      const compactor = this.compactor;
      const snapshotStore = this.snapshotStore;
      const logger = this.logger;
      const tokensBefore = droppedCompactable.reduce((s, seg) => s + seg.tokenEstimate, 0);
      queueMicrotask(() => {
        void (async () => {
          for (const seg of droppedCompactable) {
            // Summarise for next-iteration benefit; result is not used in current prompt.
            await compactor.summarize(seg, {
              // Noop provider placeholder — real integration wires IModelProvider in Step 3.
              generate: () => Promise.resolve({ content: "", model: "", usage: undefined }),
            } as never);
          }
          await snapshotStore?.save(snapshot);
          void logger?.info(CONTEXT_BUDGET_COMPACTED_EVENT, null, {
            traceId: snapshot.traceId as string,
            stepId: snapshot.stepId as string,
            tokensBefore: tokensBefore as number,
            tokensAfter: 0 as number,
            compressedSegmentCount: droppedCompactable.length as number,
          });
        })();
      });
    }

    return Promise.resolve({ segments: kept, snapshot });
  }
}
