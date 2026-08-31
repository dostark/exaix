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

import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import {
  ContextSegmentKindSchema,
  type IContextBudgetDecision,
  type IContextBudgetSnapshot,
} from "@exaix/schemas/execution/context_budget.ts";
import { DomainEventType } from "@exaix/core/events";
import {
  CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA,
  CONTEXT_SECTION_LOOP_HISTORY,
  CONTEXT_SECTION_MEMORY,
  CONTEXT_SECTION_PLAN,
  CONTEXT_SECTION_PORTAL_KNOWLEDGE,
  CONTEXT_SECTION_SYSTEM,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { ITokenizer } from "@exaix/core/func";
import type { IMilestoneEmitter } from "@exaix/core/observability";
import { MILESTONE_CONTEXT_COMPACTION_APPLIED } from "@exaix/core";
import type { IContextSegment } from "./context_segment.ts";
import type { IContextCompactor } from "./context_compactor.ts";
import type { ISnapshotStore } from "./snapshot_store.ts";
import type { Opt, Reason } from "@exaix/core/types";

export interface IContextBudgetManagerInput {
  traceId: string;
  stepId: string;
  model: string;
  /** Section-level token limits from PromptBudgetAllocator.allocate(). */
  promptBudget: IPromptBudget;
  /** Segments to evaluate — may be empty; prepare() never throws on missing kinds. */
  segments: IContextSegment[];
  /** When absent, compactor.summarize() is skipped — snapshot save and event emission
   *  still occur. */
  provider?: IModelProvider;
}

export interface IContextBudgetManagerOutput {
  /** Segments that survived compaction, in original insertion order. */
  segments: IContextSegment[];
  /** Audit record of every decision taken. */
  snapshot: IContextBudgetSnapshot;
}

/** Stateless: prepare() takes all inputs by value and returns results — safe for
 *  concurrent use in parallel flow waves without locking. */
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

/** All kinds that share a section return the same key, ensuring their consumed tokens
 *  are summed against a single counter. */
function sectionNameFor(kind: IContextSegment["kind"]): string {
  const k = ContextSegmentKindSchema.enum;
  switch (kind) {
    case k.system:
      return CONTEXT_SECTION_SYSTEM;
    case k.request:
    case k.acceptance_criteria:
    case k.plan_step:
      return CONTEXT_SECTION_PLAN;
    case k.portal_knowledge:
      return CONTEXT_SECTION_PORTAL_KNOWLEDGE;
    case k.reflection:
      return CONTEXT_SECTION_MEMORY;
    case k.tool_result:
    case k.summary:
    default:
      return CONTEXT_SECTION_LOOP_HISTORY;
  }
}

/**
 * Map a segment kind to its corresponding section budget token limit.
 */
function sectionBudgetFor(
  kind: IContextSegment["kind"],
  sections: IPromptBudget["sections"],
): number {
  const sectionKey = sectionNameFor(kind);
  return sections[sectionKey as keyof typeof sections];
}

/** System/request/acceptance_criteria are protected and never reach this path. */
const ASYNC_COMPACTABLE_KINDS = new Set<IContextSegment["kind"]>([
  ContextSegmentKindSchema.enum.tool_result,
  ContextSegmentKindSchema.enum.portal_knowledge,
  ContextSegmentKindSchema.enum.reflection,
]);

/** Sync tier: greedy-keep by priority within section budgets, no LLM calls. Async tier:
 *  schedules summarization for dropped segments via queueMicrotask.
 * @visible */
export class ContextBudgetManager implements IContextBudgetManager {
  constructor(
    private readonly _tokenizer?: Opt<ITokenizer, Reason.OptionalDependency>,
    private readonly compactor?: Opt<IContextCompactor, Reason.OptionalDependency>,
    private readonly snapshotStore?: Opt<ISnapshotStore, Reason.OptionalDependency>,
    private readonly logger?: Opt<IEventLogger, Reason.OptionalDependency>,
    private readonly milestoneEmitter?: Opt<IMilestoneEmitter, Reason.OptionalDependency>,
  ) {}

  prepare(input: IContextBudgetManagerInput): Promise<IContextBudgetManagerOutput> {
    const startedAt = Date.now();
    const { traceId, stepId, model, promptBudget, segments } = input;

    void this.logger?.info(DomainEventType.ContextBudgetAllocated, null, {
      traceId,
      stepId,
      model,
      maxContextTokens: promptBudget.totalBudgetTokens,
      segmentCount: segments.length,
    }, traceId);

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
      const sectionKey = sectionNameFor(segment.kind);
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
        void this.logger?.info(DomainEventType.ContextSectionTruncated, segment.segmentId, {
          traceId,
          stepId,
          segmentId: segment.segmentId,
          kind: segment.kind,
          sectionKey,
          originalTokens: segment.tokenEstimate,
          resultingTokens: trimmedTokens,
          remainingBudget: remaining,
        }, traceId);
      }
    }

    // Restore original insertion order.
    const segmentIdOrder = new Map(segments.map((s, i) => [s.segmentId, i]));
    kept.sort((a, b) => (segmentIdOrder.get(a.segmentId) ?? 0) - (segmentIdOrder.get(b.segmentId) ?? 0));

    const usedInputTokens = kept.reduce((sum, s) => sum + s.tokenEstimate, 0);
    const durationMs = Date.now() - startedAt;

    void this.logger?.info(DomainEventType.ContextBudgetConsumed, null, {
      traceId,
      stepId,
      model,
      maxContextTokens: promptBudget.totalBudgetTokens,
      usedInputTokens,
      keptSegmentCount: kept.length,
      droppedSegmentCount: sorted.length - kept.length,
    }, traceId);

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
      const provider = input.provider;
      const tokensBefore = droppedCompactable.reduce((s, seg) => s + seg.tokenEstimate, 0);
      queueMicrotask(() => {
        void (async () => {
          if (provider) {
            for (const seg of droppedCompactable) {
              await compactor.summarize(seg, provider);
            }
          }
          await snapshotStore?.save(snapshot);
          void logger?.info(DomainEventType.ExecutionContextCompacted, null, {
            traceId: snapshot.traceId as string,
            stepId: snapshot.stepId as string,
            tokensBefore: tokensBefore as number,
            tokensAfter: 0 as number,
            compressedSegmentCount: droppedCompactable.length as number,
          }, snapshot.traceId);
          void this.milestoneEmitter?.emit({
            milestoneId: crypto.randomUUID(),
            traceId: snapshot.traceId as string,
            milestoneType: MILESTONE_CONTEXT_COMPACTION_APPLIED,
            requiresAttention: false,
            occurredAt: new Date().toISOString(),
            summary:
              `Context compaction: ${droppedCompactable.length} segment(s) compacted, ~${tokensBefore} tokens recovered`,
            progressHint: { currentStepLabel: "Compacting context" },
          });
        })();
      });
    }

    return Promise.resolve({ segments: kept, snapshot });
  }
}
