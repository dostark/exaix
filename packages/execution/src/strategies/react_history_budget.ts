/**
 * @module ReActHistoryBudget
 * @path packages/execution/src/strategies/react_history_budget.ts
 * @description Fits the ReAct loop history into the loop history budget, by segment priority and by character cap.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/src/context/context_budget_manager.ts]
 */

import type { IAgentFileBlueprint } from "../agent_composer.ts";
import type { IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import {
  CONTEXT_PRIORITY_REFLECTION,
  CONTEXT_PRIORITY_SYSTEM,
  CONTEXT_PRIORITY_TOOL_RESULT,
  LOOP_HISTORY_BUDGET_THRESHOLD,
  REACT_TOOL_RESULT_BUDGET_RATIO,
} from "@exaix/core";
import type { IContextBudgetManagerInput } from "../context/context_budget_manager.ts";
import type { IContextSegment } from "../context/context_segment.ts";
import type { IReActLoopExecutor } from "../react_loop_adapter.ts";
import { ReActRole } from "./react_loop_types.ts";

/** Trims the loop history to the budget of its section and journals budget pressure. */
export class ReActHistoryBudget {
  constructor(
    private readonly executor: IReActLoopExecutor,
    private readonly provider: Opt<IModelProvider, Reason.OptionalDependency>,
  ) {}

  /** Applies IContextBudgetManager to the current iteration's history. Returns filtered
   *  history when the manager is configured, or the original history unchanged when it
   *  is absent (backward-compatible). */
  async applyContextBudget(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    history: Array<{ role: ReActRole; content: string }>,
    iteration: number,
  ): Promise<Array<{ role: ReActRole; content: string }>> {
    const budgetManager = this.executor.contextBudgetManager;
    const promptBudget = this.executor.currentPromptBudget;
    if (!budgetManager || !promptBudget) return history;

    const segments: IContextSegment[] = [];

    // Per-segment cap for tool_result kind in dynamic mode.
    const toolResultCap = Math.floor(
      promptBudget.sections.loopHistory * REACT_TOOL_RESULT_BUDGET_RATIO,
    );

    // System prompt — always protected
    if (blueprint.systemPrompt) {
      segments.push({
        segmentId: `system-${context.trace_id}`,
        kind: "system",
        content: blueprint.systemPrompt,
        priority: CONTEXT_PRIORITY_SYSTEM,
        tokenEstimate: Math.ceil(
          blueprint.systemPrompt.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN,
        ),
        metadata: {},
      });
    }

    // History entries: results → tool_result, thoughts/actions → reflection
    for (let idx = 0; idx < history.length; idx++) {
      const entry = history[idx];
      const kind = entry.role === ReActRole.RESULT ? "tool_result" as const : "reflection" as const;
      let tokenEstimate = Math.ceil(
        entry.content.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN,
      );
      if (kind === "tool_result" && toolResultCap > 0) {
        tokenEstimate = Math.min(tokenEstimate, toolResultCap);
      }
      segments.push({
        segmentId: `hist-${idx}-${context.trace_id}`,
        kind,
        content: entry.content,
        priority: kind === "tool_result" ? CONTEXT_PRIORITY_TOOL_RESULT : CONTEXT_PRIORITY_REFLECTION,
        tokenEstimate,
        metadata: { iterationIndex: iteration },
      });
    }

    const input: IContextBudgetManagerInput = {
      traceId: context.trace_id,
      stepId: `react-iter-${iteration}`,
      model: blueprint.model,
      promptBudget,
      segments,
      provider: this.provider,
    };

    const { snapshot } = await budgetManager.prepare(input);

    // Emit budget pressure journal event if utilisation exceeds the threshold
    if (
      snapshot.maxContextTokens > 0 &&
      snapshot.usedInputTokens / snapshot.maxContextTokens >=
        LOOP_HISTORY_BUDGET_THRESHOLD
    ) {
      void this.executor.budgetLogger?.info(
        DomainEventType.ContextBudgetExceeded,
        context.trace_id,
        {
          model: blueprint.model as string,
          contextWindow: snapshot.maxContextTokens as number,
          estimatedTokens: snapshot.usedInputTokens as number,
          tokenSource: "heuristic" as string,
        },
      );
    }

    // Rebuild history from kept history segments (system segment is not in history)
    const keptHistoryIds = new Set(
      snapshot.decisions
        .filter((d) => d.action === "keep" || d.action === "trim")
        .map((d) => d.segmentId)
        .filter((id) => id.startsWith("hist-")),
    );

    return history.filter((_, idx) => keptHistoryIds.has(`hist-${idx}-${context.trace_id}`));
  }

  buildBudgetedHistoryText(
    history: Array<{ role: ReActRole; content: string }>,
  ): string {
    const historyEntries = history.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`);
    const maxChars = this.getLoopHistoryCharBudget();

    if (!maxChars) {
      return historyEntries.join("\n\n");
    }

    let remainingEntries = [...historyEntries];
    let historyText = remainingEntries.join("\n\n");

    while (remainingEntries.length > 1 && historyText.length > maxChars) {
      remainingEntries = remainingEntries.slice(1);
      historyText = remainingEntries.join("\n\n");
    }

    if (historyText.length <= maxChars) {
      return historyText;
    }

    return historyText.slice(Math.max(0, historyText.length - maxChars));
  }

  private getLoopHistoryCharBudget(): number | undefined {
    const promptBudget = this.executor.currentPromptBudget;
    const loopHistoryTokens = promptBudget?.sections?.loopHistory;

    if (!loopHistoryTokens || loopHistoryTokens <= 0) {
      return undefined;
    }

    return loopHistoryTokens * TOKEN_ESTIMATION_CHARS_PER_TOKEN;
  }
}
