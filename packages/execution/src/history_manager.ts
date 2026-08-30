/**
 * @module HistoryManager
 * @path packages/execution/src/history_manager.ts
 * @description Manages loop history ring buffer, compaction, and budget checking.
 *   Extracted from AgentOrchestrator.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_orchestrator.ts]
 */

import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { ProviderFactory } from "@exaix/ai/provider_factory.ts";
import type { ICompactedEntry, ILoopHistoryEntry } from "./types.ts";
import {
  COMPACT_SUMMARY_MAX_TOKENS,
  DEFAULT_KEEP_LAST_N_STEPS,
  LOOP_HISTORY_BUDGET_THRESHOLD,
  LOOP_HISTORY_COMPRESSION_RATIO,
} from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { Config, IModelCallOptions, IPromptBudget } from "@exaix/schemas";
import type { IDatabaseService } from "@exaix/core/types";

/** Provider interface with a generate method used by HistoryManager. */
interface IGenerationProvider {
  generate(prompt: string, options?: IModelCallOptions & { max_tokens?: number }): Promise<{ content: string }>;
}

/** @visible */
export class HistoryManager {
  private _loopHistory: Array<ILoopHistoryEntry | ICompactedEntry> = [];

  constructor(
    private config: Config,
    private logger: IEventLogger,
    private provider?: Opt<IGenerationProvider, Reason.OptionalDependency>,
    private db?: Opt<IDatabaseService, Reason.OptionalDependency>,
    private resolvedCallOptions?: Opt<IModelCallOptions, Reason.OptionalInput>,
  ) {}

  /** Current loop history entries. */
  get loopHistory(): Array<ILoopHistoryEntry | ICompactedEntry> {
    return this._loopHistory;
  }

  /** Add an entry to the history. */
  addEntry(entry: ILoopHistoryEntry): void {
    this._loopHistory.push(entry);
    void this.logger.info(DomainEventType.LoopHistoryEntryAdded, entry.stepId, {
      entry_type: entry.type,
      tokens: entry.tokens,
    });
  }

  /** Total tokens used by current history. */
  getBudgetUsage(): number {
    return this._loopHistory.reduce((sum, e) => sum + e.tokens, 0);
  }

  /**
   * Check if loop history exceeds the budget threshold and trigger compaction.
   */
  async checkBudget(promptBudget: IPromptBudget): Promise<void> {
    const loopBudget = promptBudget.sections.loopHistory;
    const usedTokens = this.getBudgetUsage();
    if (loopBudget > 0 && usedTokens > loopBudget * LOOP_HISTORY_BUDGET_THRESHOLD) {
      await this.compactLoopHistory();
    }
  }

  /** Compact older loop history entries: keeps the last `keepLastN` as individual steps and
   *  replaces all older entries with a single compacted summary. */
  async compactLoopHistory(
    keepLastN: Opt<number, Reason.SensibleDefault> = DEFAULT_KEEP_LAST_N_STEPS,
  ): Promise<void> {
    if (this._loopHistory.length <= keepLastN + 1) return;

    const compressible = this._loopHistory.slice(0, this._loopHistory.length - keepLastN);
    if (compressible.length < 2) return;

    const stepOnlyEntries = compressible.filter(
      (e): e is ILoopHistoryEntry => e.type === "step",
    );
    if (stepOnlyEntries.length < 2) return;

    const stepDescriptions = stepOnlyEntries.map((e) => `- ${e.description} (files: ${e.filesChanged.join(", ")})`)
      .join("\n");

    const summaryPrompt =
      `Summarize the following completed execution steps concisely (2-3 sentences):\n${stepDescriptions}`;

    let summary = `${compressible.length} steps completed`;
    try {
      const summarizationModel = this.config.execution?.summarization_model;
      let summarizationProvider = this.provider;
      if (summarizationModel && this.config) {
        try {
          summarizationProvider = await ProviderFactory.createByName(
            this.config,
            summarizationModel,
            this.db,
            this.logger,
          );
        } catch {
          summarizationProvider = this.provider;
        }
      }
      if (summarizationProvider) {
        const genOptions = { max_tokens: COMPACT_SUMMARY_MAX_TOKENS, ...this.resolvedCallOptions };
        const result = await summarizationProvider.generate(summaryPrompt, genOptions);
        summary = result.content.trim();
      }
    } catch {
      // Use default summary on error
    }

    const compressedTokens = Math.round(
      compressible.reduce((sum, e) => sum + e.tokens, 0) * LOOP_HISTORY_COMPRESSION_RATIO,
    );

    const compressedEntry: ICompactedEntry = {
      type: "compacted",
      summary,
      compressedFrom: stepOnlyEntries.map((e) => e.description),
      originalStepIds: stepOnlyEntries.map((e) => e.stepId),
      tokens: compressedTokens,
      timestamp: Date.now(),
    };

    const tokensBefore = compressible.reduce((sum, e) => sum + e.tokens, 0);
    const tokensAfter = compressedEntry.tokens;
    const preserved = this._loopHistory.slice(this._loopHistory.length - keepLastN);
    this._loopHistory = [compressedEntry, ...preserved];

    this.logger.info(DomainEventType.ExecutionContextCompacted, "", {
      tokensBefore,
      tokensAfter,
      compressedCount: compressible.length,
      preservedCount: preserved.length,
      summarizationModel: this.config.execution?.summarization_model ?? undefined,
    });
  }
}
