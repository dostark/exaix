/**
 * @module ReActNativeConversation
 * @path packages/execution/src/strategies/react_native_conversation.ts
 * @description The native tool-call side of the ReAct loop: the generate options and tool choice, the round bookkeeping and the conversation budget preflight.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/src/native_tool_turns.ts]
 */

import type { IAgentFileBlueprint } from "../agent_composer.ts";
import type {
  IModelProvider,
  INativeConversationSnapshot,
  IProviderToolRound,
  IProviderTurn,
  IToolDefinition,
  IValidatedProviderRound,
} from "@exaix/ai/types.ts";
import { TOOL_CHOICE_TYPE_AUTO } from "@exaix/ai/types.ts";
import { PromptBudgetAllocator } from "@exaix/core";
import type { IProviderToolCall } from "@exaix/ai/providers";
import type { IGenerateResult } from "@exaix/ai/providers";
import {
  assertRoundWithinBounds,
  buildToolRound,
  type IRoundOutcome,
  providerSupportsNativeRoundReplay,
  roundLimitsOf,
  validateProviderRound,
} from "../native_tool_turns.ts";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import { REACT_DEFAULT_MAX_TOKENS, REACT_DEFAULT_TEMPERATURE, ToolsRoundMode } from "@exaix/core";
import type { IToolsRoundPolicy } from "@exaix/schemas";
import type { IModelCallOptions } from "@exaix/schemas";
import type { IReActLoopExecutor } from "../react_loop_adapter.ts";
import { ContextBudgetExceededError } from "@exaix/core/errors";
import type { IGeneratedOptions, IReActAction } from "./react_loop_types.ts";

/** What the native conversation of one ReAct strategy needs from it. */
export class ReActNativeConversation {
  constructor(
    private readonly executor: IReActLoopExecutor,
    private readonly provider: Opt<IModelProvider, Reason.OptionalDependency>,
    /** The per-call options that the composer sets on the strategy before execute(). */
    private readonly callOptions: () => Opt<IModelCallOptions, Reason.OptionalContext>,
  ) {}

  /** Parses a native tool-use response into actions. Returns empty actions and
   *  isComplete=true when the model chose not to use any tool. */
  parseNativeToolResponse(response: IGenerateResult): {
    toolCalls: IProviderToolCall[] | undefined;
    actions: IReActAction[];
    isComplete: boolean;
  } {
    const toolCalls = response.toolCalls;
    if (toolCalls && toolCalls.length > 0) {
      const actions = toolCalls.map((tc) => ({
        tool: tc.name,
        params: tc.input as Record<string, JSONValue>,
      }));
      return { toolCalls, actions, isComplete: false };
    }
    return { toolCalls: undefined, actions: [], isComplete: true };
  }

  /** Builds the generate options for native tools: tools, tool choice and the prior turn after the first iteration. */
  buildNativeGenerateOptions(
    nativeToolDefinitions?: Opt<IToolDefinition[], Reason.OptionalInput>,
    nativeToolsPriorTurn?: Opt<IProviderTurn, Reason.OptionalInput>,
    nativeToolsUsed = false,
    nativePreferredTool?: Opt<string, Reason.OptionalInput>,
    parallelMode: ToolsRoundMode = ToolsRoundMode.AUTO,
  ): IGeneratedOptions {
    const base = Object.assign({
      temperature: REACT_DEFAULT_TEMPERATURE,
      max_tokens: REACT_DEFAULT_MAX_TOKENS,
    }, this.callOptions()) as IGeneratedOptions;
    // Off asks for one call per response. Auto sends no parallel flag, so the provider default applies.
    const parallel: { disable_parallel_tool_use?: boolean } = parallelMode === ToolsRoundMode.OFF
      ? { disable_parallel_tool_use: true }
      : {};
    if (nativeToolsUsed && nativeToolDefinitions) {
      base.tools = nativeToolDefinitions;
      // A provider that cannot honor an explicit tool_choice still receives the tool list.
      const capabilities = this.provider?.callCapabilities;
      // An unset flag counts as thinking on: DeepSeek models think by default, and only they declare the thinking-only refusal.
      const thinkingOn = this.callOptions()?.thinking !== false;
      const forcedChoiceRefused = capabilities?.supportsForcedToolChoice === false ||
        (thinkingOn && capabilities?.supportsForcedToolChoiceWithThinking === false);
      if (capabilities?.supportsToolChoice !== false) {
        const choice = this.nativeToolChoiceOf(
          nativeToolDefinitions,
          nativeToolsPriorTurn,
          nativePreferredTool,
          parallel,
          forcedChoiceRefused,
        );
        base.toolChoice = choice.toolChoice;
        base.nativeToolChoiceMode = choice.nativeToolChoiceMode;
      }
      // One-line diagnostic of the native toolChoice branch chosen.
      console.debug(
        `[ReActLoopStrategy] native toolChoice=${base.nativeToolChoiceMode ?? "<unset>"} ` +
          `preferredTool=${nativePreferredTool ?? "<unset>"} priorTurn=${nativeToolsPriorTurn ? "yes" : "no"}`,
      );
      if (nativeToolsPriorTurn) {
        base.priorTurn = nativeToolsPriorTurn;
      }
    }
    return base;
  }

  /** The native toolChoice and its mode for one round. */
  nativeToolChoiceOf(
    definitions: IToolDefinition[],
    priorTurn: Opt<IProviderTurn, Reason.OptionalInput>,
    preferredTool: Opt<string, Reason.OptionalInput>,
    parallel: { disable_parallel_tool_use?: boolean },
    forcedChoiceRefused: boolean,
  ): {
    toolChoice: NonNullable<IGeneratedOptions["toolChoice"]>;
    nativeToolChoiceMode: NonNullable<IGeneratedOptions["nativeToolChoiceMode"]>;
  } {
    if (forcedChoiceRefused) {
      return { toolChoice: { type: TOOL_CHOICE_TYPE_AUTO, ...parallel }, nativeToolChoiceMode: TOOL_CHOICE_TYPE_AUTO };
    }
    if (preferredTool && !priorTurn && definitions.some((tool) => tool.name === preferredTool)) {
      // A forced choice must name a tool in the list, or strict upstreams reject the request.
      return { toolChoice: { type: "tool", name: preferredTool, ...parallel }, nativeToolChoiceMode: "forced" };
    }
    return priorTurn
      ? { toolChoice: { type: TOOL_CHOICE_TYPE_AUTO, ...parallel }, nativeToolChoiceMode: TOOL_CHOICE_TYPE_AUTO }
      : { toolChoice: { type: "any", ...parallel }, nativeToolChoiceMode: "any" };
  }

  /** Keep each native tool call paired with its result. Reject an oversized complete snapshot before generation. */
  async preflightNativeConversationBudget(
    blueprint: IAgentFileBlueprint,
    snapshot: Opt<INativeConversationSnapshot, Reason.OptionalContext>,
    options: IGeneratedOptions,
    traceId: string,
  ): Promise<void> {
    if (!snapshot) return;
    if (!this.provider?.measureInputTokens) throw new Error("Native conversation provider requires input measurement");
    const budget = this.executor.currentPromptBudget ?? await new PromptBudgetAllocator(
      { enabled: true },
      this.executor.tokenizer,
    ).allocate(blueprint.model, { loopHistoryUsedTokens: REACT_DEFAULT_MAX_TOKENS });
    const measured = await this.provider.measureInputTokens(snapshot.initialPrompt, options);
    const inputLimit = Math.max(
      0,
      budget.totalBudgetTokens - budget.safetyBufferTokens - (options.max_tokens ?? REACT_DEFAULT_MAX_TOKENS),
    );
    const sectionOverflow = Object.entries(measured.sections).some(([section, count]) =>
      count > budget.sections[section as keyof typeof budget.sections]
    );
    if (measured.totalTokens > inputLimit || sectionOverflow) {
      await this.executor.budgetLogger?.warn(DomainEventType.ContextBudgetExceeded, blueprint.model, {
        model: blueprint.model,
        section_counts: measured.sections,
        limit: inputLimit,
        input_tokens: measured.totalTokens,
        token_source: measured.tokenSource,
      }, traceId);
      throw new ContextBudgetExceededError(
        "Native conversation exceeds its allocated prompt budget",
        blueprint.model,
        inputLimit,
        measured.totalTokens,
        { ...measured.sections },
      );
    }
  }

  /** Refuses a native response that breaks the round ceilings of this turn, before any call runs. */
  assertNativeRoundAdmitted(
    nativeToolsUsed: boolean,
    calls: Opt<IProviderToolCall[], Reason.OptionalInput>,
    policy: IToolsRoundPolicy,
    context: { provider: string; earlierIds: ReadonlySet<string> },
  ): void {
    if (nativeToolsUsed) {
      assertRoundWithinBounds(calls ?? [], roundLimitsOf(policy), context.provider, context.earlierIds);
    }
  }

  /** Call ids of the turns already replayed to the provider. A later response may not reuse one. */
  consumedCallIds(
    turns: readonly IProviderTurn[],
    priorTurn?: Opt<IProviderTurn, Reason.OptionalInput>,
    rounds: readonly IProviderToolRound[] = [],
  ): ReadonlySet<string> {
    const ids = new Set(turns.map((turn) => turn.toolUseId));
    if (priorTurn !== undefined) ids.add(priorTurn.toolUseId);
    for (const round of rounds) for (const call of round.calls) ids.add(call.toolUseId);
    return ids;
  }

  /** A provider that replays whole rounds gets its response validated as one round, before any call runs. */
  groupedRoundFor(
    nativeToolsUsed: boolean,
    nativeConversationEnabled: boolean,
    response: IGenerateResult,
    policy: IToolsRoundPolicy,
    earlierIds: ReadonlySet<string>,
  ): Opt<IValidatedProviderRound, Reason.OptionalInput> {
    if (!nativeToolsUsed || !nativeConversationEnabled || !providerSupportsNativeRoundReplay(this.provider!.id)) {
      return undefined;
    }
    return validateProviderRound(response, roundLimitsOf(policy), earlierIds);
  }

  /** A per-call turn joins the conversation, or the call's outcome joins the round it completes. */
  recordNativeCall(
    completedTurns: IProviderTurn[],
    outcomes: IRoundOutcome[],
    grouped: boolean,
    turn: IProviderTurn,
  ): void {
    if (!grouped) {
      completedTurns.push(turn);
      return;
    }
    outcomes.push({
      toolUseId: turn.toolUseId,
      toolResultContent: turn.toolResultContent,
      toolResultIsError: turn.toolResultIsError,
    });
  }

  /** The rounds a native conversation carries after this response: the prior ones, then this one if grouped. */
  nextNativeRounds(
    prior: Opt<readonly IProviderToolRound[], Reason.OptionalInput>,
    grouped: Opt<IValidatedProviderRound, Reason.OptionalInput>,
    outcomes: readonly IRoundOutcome[],
    policy: IToolsRoundPolicy,
  ): IProviderToolRound[] {
    const rounds = [...(prior ?? [])];
    if (grouped !== undefined) rounds.push(buildToolRound(grouped, outcomes, roundLimitsOf(policy)));
    return rounds;
  }

  /** Text ReAct has no cap. A native response may execute only the calls its policy cap admits. */
  withinNativeCap(nativeToolsUsed: boolean, position: number, executionCap: number): boolean {
    return !nativeToolsUsed || position < executionCap;
  }

  /** Calls of a response that can execute. The whole-run allowance counts these, not the refused extras. */
  admittedCallCount(nativeToolsUsed: boolean, requested: number, executionCap: number): number {
    return nativeToolsUsed ? Math.min(requested, executionCap) : requested;
  }
}
