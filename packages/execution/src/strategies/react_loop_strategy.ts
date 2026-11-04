/**
 * @module ReActLoopStrategy
 * @path packages/execution/src/strategies/react_loop_strategy.ts
 * @description In-process reasoning strategy using the ReAct (Reasoning + Acting) loop.
 * Executes tasks by prompting an LLM for tool calls and processing results within Exaix.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/src/strategies/execution_strategy.ts]
 */

import type { IExecutionStrategy } from "./execution_strategy.ts";
import { AgentExecutionError, type IAgentFileBlueprint } from "../agent_composer.ts";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";

import type { IModelProvider, IProviderToolRound, IProviderTurn, IToolDefinition } from "@exaix/ai/types.ts";

import type { INativePromptSection } from "@exaix/ai";
import { SkillSubmissionKind, TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";
import type { IProviderToolCall } from "@exaix/ai/providers";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { ITool, IToolResult } from "@exaix/core/types";
import { AgentExecutionErrorType, canonicalizeToolName, ExecutionStrategyName, ToolName } from "@exaix/core";
import {
  buildNativeToolDefinitions,
  buildPriorTurn,
  enrichPortalPathParam,
  type IRoundOutcome,
  providerSupportsNativeConversation,
  providerSupportsNativeTools,
  TOOL_CALL_LIMIT_MESSAGE,
} from "../native_tool_turns.ts";
import { GuardrailBlockedError } from "@exaix/core/planning";

import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

import {
  DEFAULT_AGENT_ACI_DOC_PROMPT_MAX_CHARS,
  DEFAULT_AGENT_MAX_ITERATIONS,
  PLANNING_TOOL_RESULT_TRUNCATED_SUFFIX,
  REACT_CALLING_TOOL_PREFIX,
  REACT_SUMMARY_PREFIX,
  REACT_THOUGHT_PREFIX,
  REACT_TOOL_RESULT_HISTORY_MAX,
  ToolsRoundLoop,
  type ToolsRoundMode,
} from "@exaix/core";
import { defaultToolsRoundPolicy, type IToolsRoundPolicy } from "@exaix/schemas";
import type { IModelCallOptions } from "@exaix/schemas";

import type { IReActLoopExecutor } from "../react_loop_adapter.ts";

import type { IPinnedSkillPrompt } from "../skill_pin_transport.ts";
import {
  calculateAciDocBudgetChars,
  canonicalizeForRegistry,
  type IAciRenderResult,
  renderAciDocFragments,
} from "@exaix/tool-runtime";
import { type IGeneratedOptions, type IReActAction, ReActRole } from "./react_loop_types.ts";
import { parseReActResponse } from "./react_response_parser.ts";
import { ReActHistoryBudget } from "./react_history_budget.ts";
import { ReActNativeConversation } from "./react_native_conversation.ts";
import { ReActJournal } from "./react_journal.ts";

/** The five tools listed when an agent role/skill declares no permitted_tools restriction at all. */
const DEFAULT_REACT_VISIBLE_TOOLS: readonly string[] = [
  ToolName.READ_FILE,
  ToolName.WRITE_FILE,
  ToolName.RUN_COMMAND,
  ToolName.LIST_DIRECTORY,
  ToolName.SEARCH_FILES,
];

interface IToolExecutionResult {
  success?: boolean;
  error?: string;
  data?: JSONValue;
}

/** Tools that mutate a portal file; their `path` param is a change the audit must authorize. */
const REACT_WRITE_TOOLS: ReadonlySet<string> = new Set<string>([
  ToolName.WRITE_FILE,
  ToolName.PATCH_FILE,
  ToolName.DELETE_FILE,
  ToolName.MOVE_FILE,
  ToolName.CREATE_DIRECTORY,
]);

/** Executes an agentic loop: the LLM generates actions, ToolRegistry runs them, until the task completes. */
/** Which native tool-choice branch produced this iteration's options. */
export type NativeToolChoiceMode = "forced" | "any" | "auto";

/** Parameters for runSingleIteration. */
interface IIterationParams {
  i: number;
  startTime: number;
  blueprint: IAgentFileBlueprint;
  context: IExecutionContext;
  options: IAgentExecutionOptions;
  history: Array<{ role: ReActRole; content: string }>;
  writtenFiles: Set<string>;
  toolCallCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number | undefined;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalReasoningTokens: number;
  nativeToolsUsed: boolean;
  nativeToolDefinitions?: Opt<IToolDefinition[], Reason.OptionalInput>;
  nativeToolsPriorTurn?: Opt<IProviderTurn, Reason.OptionalInput>;
  nativeConversationEnabled: boolean;
  nativeConversationInitialPrompt?: string;
  nativeConversationInitialSections?: readonly INativePromptSection[];
  nativeConversationTurns: IProviderTurn[];
  /** Completed rounds of a provider that replays whole rounds, carried beside the per-call turns. */
  nativeConversationRounds?: readonly IProviderToolRound[];
  nativePreferredTool?: Opt<string, Reason.OptionalInput>;
  pinnedSkills?: Opt<IPinnedSkillPrompt | null, Reason.OptionalContext>;
}

/** Optional prompt segments `buildPrompt` places around the plan step. */
interface IReActPromptExtras {
  aciSection?: Opt<IAciRenderResult, Reason.OptionalContext>;
  sections?: Opt<INativePromptSection[], Reason.OptionalInput>;
  /** Rendered pinned skill blocks, placed ahead of the plan step. */
  skillsText?: Opt<string, Reason.OptionalContext>;
}

/** Result of a single iteration in execute(). */
interface IIterationResult {
  toolCallCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number | undefined;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalReasoningTokens: number;
  nativeToolsPriorTurn?: IProviderTurn;
  nativeConversationInitialPrompt?: string;
  nativeConversationInitialSections?: readonly INativePromptSection[];
  nativeConversationTurns?: IProviderTurn[];
  nativeConversationRounds?: IProviderToolRound[];
  done: boolean;
  result?: IChangesetResult;
}

export class ReActLoopStrategy implements IExecutionStrategy {
  public readonly name = ExecutionStrategyName.REACT;
  /** Per-call options (thinking/effort/max_tokens) set by agent_executor before execute(). */
  public callOptions?: IModelCallOptions;
  /** Resolved per execute() call from the executor's config, not cached. One strategy
   *  instance serves several executions. */
  private get maxIterations(): number {
    return this.executor.maxIterations ?? DEFAULT_AGENT_MAX_ITERATIONS;
  }

  private readonly historyBudget: ReActHistoryBudget;
  private readonly native: ReActNativeConversation;
  private readonly journal: ReActJournal;

  constructor(
    private executor: IReActLoopExecutor,
    private provider?: Opt<IModelProvider, Reason.OptionalDependency>,
  ) {
    this.historyBudget = new ReActHistoryBudget(executor, provider);
    this.journal = new ReActJournal(executor, provider);
    this.native = new ReActNativeConversation(executor, provider, () => this.callOptions);
  }

  async execute(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
    pinnedSkills?: Opt<IPinnedSkillPrompt | null, Reason.OptionalContext>,
  ): Promise<IChangesetResult> {
    if (!this.provider) {
      throw new AgentExecutionError(
        "Model provider required for ReAct loop strategy",
        AgentExecutionErrorType.CONFIGURATION_ERROR,
      );
    }
    const skillsBudgetTokens = this.executor.currentPromptBudget?.sections.skills;
    const skills = pinnedSkills && skillsBudgetTokens !== undefined
      ? pinnedSkills.fit(skillsBudgetTokens * TOKEN_ESTIMATION_CHARS_PER_TOKEN)
      : pinnedSkills;

    const startTime = Date.now();
    const history: Array<{ role: ReActRole; content: string }> = [];
    const writtenFiles = new Set<string>();
    let toolCallCount = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCostUsd: number | undefined = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalReasoningTokens = 0;

    // Native-tools gate requires both the opt-in flag and provider capability.
    const useNativeTools = options.native_tools_enabled === true && providerSupportsNativeTools(this.provider!.id);
    let nativeToolsPriorTurn: IProviderTurn | undefined;
    const nativeConversationEnabled = useNativeTools && providerSupportsNativeConversation(this.provider!.id);
    let nativeConversationInitialPrompt: string | undefined;
    let nativeConversationInitialSections: readonly INativePromptSection[] | undefined;
    let nativeConversationTurns: IProviderTurn[] = [];
    let nativeConversationRounds: IProviderToolRound[] = [];
    let nativeToolDefinitions: IToolDefinition[] | undefined;
    let nativeToolsUsed = false;
    if (useNativeTools) {
      const visibleToolIds = this.deriveVisibleToolIds(options);
      const tools = (this.executor.toolRegistry?.getTools() ?? []).filter((t) => visibleToolIds.includes(t.name));
      nativeToolDefinitions = this.buildNativeToolDefinitions(tools);
      nativeToolsUsed = true;
    }
    // PGAP-3: detect targeted-edit tasks from plan context and prefer patch_file
    const TARGETED_EDIT_PATTERN = /fix|patch|null.guard|refactor|edit|bug|repair/i;
    const nativePreferredTool = nativeToolsUsed && TARGETED_EDIT_PATTERN.test(context.plan)
      ? ("patch_file" satisfies string)
      : undefined;
    // Records iteration-0's context.plan + derived nativePreferredTool so non-convergence
    // is attributable (did an exploration step run first, leaving the pattern unmatched
    // and tool_choice unconstrained?).
    console.debug("[ReActLoopStrategy] native tools:", {
      enabled: useNativeTools,
      planMatch: TARGETED_EDIT_PATTERN.test(context.plan),
      preferredTool: nativePreferredTool ?? null,
      planPreview: context.plan.slice(0, Math.min(context.plan.length, 120)),
    });

    for (let i = 0; i < this.maxIterations; i++) {
      const iterResult = await this.runSingleIteration({
        i,
        startTime,
        blueprint,
        context,
        options,
        history,
        writtenFiles,
        toolCallCount,
        totalPromptTokens,
        totalCompletionTokens,
        totalCostUsd,
        totalCacheReadTokens,
        totalCacheCreationTokens,
        totalReasoningTokens,
        nativeToolsUsed,
        nativeToolDefinitions,
        nativeToolsPriorTurn,
        nativeConversationEnabled,
        nativeConversationInitialPrompt,
        nativeConversationInitialSections,
        nativeConversationTurns,
        nativeConversationRounds,
        nativePreferredTool,
        pinnedSkills: skills,
      });
      toolCallCount = iterResult.toolCallCount;
      totalPromptTokens = iterResult.totalPromptTokens;
      totalCompletionTokens = iterResult.totalCompletionTokens;
      totalCostUsd = iterResult.totalCostUsd;
      totalCacheReadTokens = iterResult.totalCacheReadTokens;
      totalCacheCreationTokens = iterResult.totalCacheCreationTokens;
      totalReasoningTokens = iterResult.totalReasoningTokens;
      nativeToolsPriorTurn = iterResult.nativeToolsPriorTurn;
      nativeConversationInitialPrompt = iterResult.nativeConversationInitialPrompt ?? nativeConversationInitialPrompt;
      nativeConversationInitialSections = iterResult.nativeConversationInitialSections ??
        nativeConversationInitialSections;
      nativeConversationTurns = iterResult.nativeConversationTurns ?? nativeConversationTurns;
      nativeConversationRounds = iterResult.nativeConversationRounds ?? nativeConversationRounds;
      if (iterResult.done) {
        return iterResult.result!;
      }
    }

    throw new AgentExecutionError(
      `Reached maximum iterations (${this.maxIterations}) without completing task`,
      AgentExecutionErrorType.EXECUTION_ERROR,
    );
  }

  /** Screen final output, build the changeset result, and attach accumulated usage. */
  private finishLoop(
    content: string,
    context: IExecutionContext,
    startTime: number,
    toolCallCount: number,
    writtenFiles: ReadonlySet<string>,
    usage: {
      promptTokens: number;
      completionTokens: number;
      costUsd: number | undefined;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      reasoningTokens: number;
    },
  ): IChangesetResult {
    // Screens the final output before review. Uses FINAL_ITERATION sentinel — the runner
    // honours screen_final_output config.
    if (content) {
      void this.executor.guardrailRunner?.screen(content, context.trace_id, Number.MAX_SAFE_INTEGER);
      if (this.executor.guardrailRunner?.hasBlockingViolation(context.trace_id)) {
        throw new GuardrailBlockedError(
          context.trace_id,
          "Guardrail blocked final output before review",
        );
      }
    }

    const finalResult = this.createFinalResult(content, context, startTime, toolCallCount, writtenFiles);
    finalResult.usage = {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      cost_usd: usage.costUsd ?? null,
      cache_read_tokens: usage.cacheReadTokens,
      cache_creation_tokens: usage.cacheCreationTokens,
      reasoning_tokens: usage.reasoningTokens,
      cost_source: usage.costUsd === undefined ? "unknown" : "predicted",
    };
    return this.executor.validateReviewResult(finalResult);
  }

  /** Record a successful write-type tool's target path as a change the audit must authorize. */
  private recordWrittenFile(
    action: IReActAction,
    result: IToolExecutionResult,
    writtenFiles: Set<string>,
  ): void {
    if (!result.success || !REACT_WRITE_TOOLS.has(action.tool)) return;
    const path = action.params.path;
    if (typeof path === "string" && path.length > 0) writtenFiles.add(path);
  }

  /** Executes one ReAct iteration; returns accumulated metrics and, if the loop should terminate early, a finished result. */
  private async prepareIterationPrompt(
    params: IIterationParams,
    parallelMode: ToolsRoundMode,
  ): Promise<{
    prompt: string;
    initialPrompt?: string;
    initialSections: INativePromptSection[];
    generateOptions: IGeneratedOptions;
    aciSection?: { result: IAciRenderResult; budgetChars: number };
  }> {
    const {
      blueprint,
      context,
      options,
      history,
      i,
      nativeToolsUsed,
      nativeToolDefinitions,
      nativeToolsPriorTurn,
      nativePreferredTool,
    } = params;
    const budgetedHistory = params.nativeConversationEnabled
      ? []
      : await this.historyBudget.applyContextBudget(blueprint, context, history, i);
    const visibleToolIds = this.deriveVisibleToolIds(options);
    const aciSection = this.renderAciSection(visibleToolIds);
    const initialSections: INativePromptSection[] = [];
    const initialPrompt = params.nativeConversationEnabled
      ? params.nativeConversationInitialPrompt ?? await this.buildPrompt(
        blueprint,
        context,
        options,
        [],
        nativeToolsUsed,
        visibleToolIds,
        { aciSection: aciSection?.result, sections: initialSections, skillsText: params.pinnedSkills?.text },
      )
      : undefined;
    const prompt = initialPrompt ?? await this.buildPrompt(
      blueprint,
      context,
      options,
      budgetedHistory,
      nativeToolsUsed,
      visibleToolIds,
      { aciSection: aciSection?.result, skillsText: params.pinnedSkills?.text },
    );

    const generateOptions = this.native.buildNativeGenerateOptions(
      nativeToolDefinitions,
      nativeToolsPriorTurn,
      nativeToolsUsed,
      nativePreferredTool,
      parallelMode,
    );
    generateOptions.traceId = context.trace_id;
    if (params.nativeConversationEnabled && nativeToolsUsed && initialPrompt !== undefined) {
      const rounds = params.nativeConversationRounds ?? [];
      const hasHistory = params.nativeConversationTurns.length > 0 || rounds.length > 0;
      generateOptions.nativeConversation = {
        initialPrompt,
        initialPromptSections: params.nativeConversationInitialSections ?? initialSections,
        turns: params.nativeConversationTurns,
        ...(rounds.length > 0 ? { rounds } : {}),
        ...(hasHistory
          ? {
            roundInstruction: `Iteration ${
              i + 1
            } of ${this.maxIterations}. Continue with the next permitted tool call or return the final answer.`,
          }
          : {}),
      };
      delete generateOptions.priorTurn;
    }
    return { prompt, initialPrompt, initialSections, generateOptions, aciSection };
  }

  private async runSingleIteration(
    params: IIterationParams,
  ): Promise<IIterationResult> {
    const { i, context, options, history } = params;
    // One policy per model turn: the request hint, the cap and the result cap all come from it.
    const policy = this.roundPolicy();
    if (this.executor.guardrailRunner?.hasBlockingViolation(context.trace_id)) {
      throw new GuardrailBlockedError(
        context.trace_id,
        "Execution halted by a blocking guardrail violation",
      );
    }

    const { prompt, initialPrompt, initialSections, generateOptions, aciSection } = await this.prepareIterationPrompt(
      params,
      policy.mode,
    );
    await this.native.preflightNativeConversationBudget(
      params.blueprint,
      generateOptions.nativeConversation,
      generateOptions,
      context.trace_id,
    );
    await this.journal.emitPromptAssembledEvent(context, i, aciSection);
    await params.pinnedSkills?.record(prompt, SkillSubmissionKind.PROVIDER, i + 1);
    const generateStartTime = Date.now();
    const response = await this.journal.withHeartbeat(
      context,
      () => this.provider!.generate(prompt, generateOptions as never),
    );
    const generateDurationMs = Date.now() - generateStartTime;

    this.journal.logMaxTokensTruncation(response, options, i, context);
    this.journal.logRefusal(response, options, i, context);
    const costUsd = await this.journal.logIterationGeneration(response, context, options, generateDurationMs);
    const totals = this.iterationTotalsOf(params, response, costUsd);
    const parsed = this.parseIterationResponse(response, params.nativeToolsUsed);

    if (!params.nativeToolsUsed) {
      this.journal.journalParseErrors(parsed.parseErrors, context, i);
    }
    if (parsed.thought) {
      history.push({ role: ReActRole.THOUGHT, content: parsed.thought });
      await this.executor.logAgentOutput(context.trace_id, `${REACT_THOUGHT_PREFIX} ${parsed.thought}`);
    }
    if (parsed.isComplete && parsed.actions.length === 0) {
      const result = this.finishLoop(
        response.content,
        context,
        params.startTime,
        params.toolCallCount,
        params.writtenFiles,
        totals,
      );
      return this.iterationResultOf(
        params,
        totals,
        {
          toolCallCount: params.toolCallCount,
          lastPriorTurn: params.nativeToolsPriorTurn,
          turns: params.nativeConversationTurns,
          rounds: params.nativeConversationRounds === undefined ? undefined : [...params.nativeConversationRounds],
          allActionsSucceeded: true,
        },
        initialPrompt,
        initialSections,
        result,
      );
    }
    if (parsed.actions.length === 0) {
      throw new AgentExecutionError(
        "No actions generated in ReAct iteration",
        AgentExecutionErrorType.EXECUTION_ERROR,
      );
    }
    this.native.assertNativeRoundAdmitted(params.nativeToolsUsed, parsed.nativeToolCalls, policy, {
      provider: response.provider,
      earlierIds: this.native.consumedCallIds(
        params.nativeConversationTurns,
        params.nativeToolsPriorTurn,
        params.nativeConversationRounds,
      ),
    });
    const groupedRound = this.native.groupedRoundFor(
      params.nativeToolsUsed,
      params.nativeConversationEnabled,
      response,
      policy,
      this.native.consumedCallIds(
        params.nativeConversationTurns,
        params.nativeToolsPriorTurn,
        params.nativeConversationRounds,
      ),
    );
    this.assertToolCallBudget(params, parsed, policy);
    if (response.content) {
      void this.executor.guardrailRunner?.screen(response.content, context.trace_id, i);
    }

    const actions = await this.attemptIterationActions(params, parsed, response, policy, groupedRound);
    if (this.shouldFinishActionTurn(parsed.isComplete, actions.allActionsSucceeded)) {
      const result = this.finishLoop(
        response.content,
        context,
        params.startTime,
        actions.toolCallCount,
        params.writtenFiles,
        totals,
      );
      return this.iterationResultOf(params, totals, actions, initialPrompt, initialSections, result);
    }
    return this.iterationResultOf(params, totals, actions, initialPrompt, initialSections, undefined);
  }

  /** The accumulated token and cost totals after one iteration. */
  private iterationTotalsOf(
    params: IIterationParams,
    response: IGenerateResult,
    costUsd: Opt<number, Reason.OptionalContext>,
  ): {
    promptTokens: number;
    completionTokens: number;
    costUsd: Opt<number, Reason.OptionalContext>;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    reasoningTokens: number;
  } {
    return {
      promptTokens: params.totalPromptTokens + response.usage.promptTokens,
      completionTokens: params.totalCompletionTokens + response.usage.completionTokens,
      costUsd: this.accumulateKnownCost(params.totalCostUsd, costUsd),
      cacheReadTokens: params.totalCacheReadTokens + (response.usage.cacheReadTokens ?? 0),
      cacheCreationTokens: params.totalCacheCreationTokens + (response.usage.cacheCreationTokens ?? 0),
      reasoningTokens: params.totalReasoningTokens + (response.usage.reasoningTokens ?? 0),
    };
  }

  /** Rejects a round that would exceed the configured tool-call budget. */
  private assertToolCallBudget(
    params: IIterationParams,
    parsed: ReturnType<ReActLoopStrategy["parseIterationResponse"]>,
    policy: ReturnType<ReActLoopStrategy["roundPolicy"]>,
  ): void {
    const maxToolCalls = params.options.max_tool_calls ?? 100;
    const admitted = params.toolCallCount +
      this.native.admittedCallCount(params.nativeToolsUsed, parsed.actions.length, policy.executionCap);
    if (admitted > maxToolCalls) {
      throw new AgentExecutionError(
        `Exceeded maximum tool calls (${maxToolCalls})`,
        AgentExecutionErrorType.EXECUTION_ERROR,
      );
    }
  }

  /** Executes every action of one parsed iteration and accumulates its tool results. */
  private async attemptIterationActions(
    params: IIterationParams,
    parsed: ReturnType<ReActLoopStrategy["parseIterationResponse"]>,
    response: IGenerateResult,
    policy: ReturnType<ReActLoopStrategy["roundPolicy"]>,
    groupedRound: ReturnType<ReActNativeConversation["groupedRoundFor"]>,
  ): Promise<{
    toolCallCount: number;
    lastPriorTurn: IIterationResult["nativeToolsPriorTurn"];
    turns: IIterationResult["nativeConversationTurns"];
    rounds: IIterationResult["nativeConversationRounds"];
    allActionsSucceeded: boolean;
  }> {
    let newToolCallCount = params.toolCallCount;
    let lastPriorTurn = params.nativeToolsPriorTurn;
    const completedNativeConversationTurns = [...params.nativeConversationTurns];
    const roundOutcomes: IRoundOutcome[] = [];
    let allActionsSucceeded = true;
    for (let a = 0; a < parsed.actions.length; a++) {
      const action = this.canonicalizeAction(
        parsed.actions[a],
        params.context.trace_id,
        response.provider,
        response.model,
      );
      // A native response past the policy cap executes nothing. Each extra call replays as an error result.
      const withinCap = this.native.withinNativeCap(params.nativeToolsUsed, a, policy.executionCap);
      const execResult = await this.attemptAction(action, params.options, withinCap);
      allActionsSucceeded &&= execResult.success === true;
      this.recordWrittenFile(action, execResult, params.writtenFiles);

      const toolResultContent = execResult.success
        ? JSON.stringify(execResult.data ?? {})
        : (execResult.error ?? "Unknown error");
      newToolCallCount += Number(withinCap);

      const toolCallLine = `${REACT_CALLING_TOOL_PREFIX}${action.tool}(${JSON.stringify(action.params)})`;
      params.history.push({ role: ReActRole.ACTION, content: toolCallLine });

      const resultEntry = `Tool ${action.tool} result: ${toolResultContent}`;
      const truncatedResult = resultEntry.length > REACT_TOOL_RESULT_HISTORY_MAX
        ? resultEntry.slice(0, REACT_TOOL_RESULT_HISTORY_MAX) + "..."
        : resultEntry;
      params.history.push({ role: ReActRole.RESULT, content: truncatedResult });

      await this.journal.journalAction(params.context, action, toolResultContent, params.i);

      if (params.nativeToolsUsed && parsed.nativeToolCalls?.[a]) {
        const turn = this.buildPriorTurn(parsed.nativeToolCalls[a], execResult as never);
        lastPriorTurn = {
          ...turn,
          toolResultContent: this.capResultTokens(String(turn.toolResultContent), policy.resultTokenCap),
        };
        this.native.recordNativeCall(
          completedNativeConversationTurns,
          roundOutcomes,
          groupedRound !== undefined,
          lastPriorTurn,
        );
      }
    }
    const completedNativeConversationRounds = this.native.nextNativeRounds(
      params.nativeConversationRounds,
      groupedRound,
      roundOutcomes,
      policy,
    );
    return {
      toolCallCount: newToolCallCount,
      lastPriorTurn,
      turns: completedNativeConversationTurns,
      rounds: completedNativeConversationRounds,
      allActionsSucceeded,
    };
  }

  /** Builds one iteration result from its accumulated totals and native conversation state. */
  private iterationResultOf(
    params: IIterationParams,
    totals: ReturnType<ReActLoopStrategy["iterationTotalsOf"]>,
    state: {
      readonly toolCallCount: number;
      readonly lastPriorTurn: IIterationResult["nativeToolsPriorTurn"];
      readonly turns: IIterationResult["nativeConversationTurns"];
      readonly rounds: IIterationResult["nativeConversationRounds"];
      readonly allActionsSucceeded: boolean;
    },
    initialPrompt: IIterationResult["nativeConversationInitialPrompt"],
    initialSections: IIterationResult["nativeConversationInitialSections"],
    result: Opt<IIterationResult["result"], Reason.OptionalInput>,
  ): IIterationResult {
    const base: IIterationResult = {
      toolCallCount: state.toolCallCount,
      totalPromptTokens: totals.promptTokens,
      totalCompletionTokens: totals.completionTokens,
      totalCostUsd: totals.costUsd,
      totalCacheReadTokens: totals.cacheReadTokens,
      totalCacheCreationTokens: totals.cacheCreationTokens,
      totalReasoningTokens: totals.reasoningTokens,
      nativeToolsPriorTurn: state.lastPriorTurn,
      nativeConversationInitialPrompt: initialPrompt,
      nativeConversationInitialSections: params.nativeConversationInitialSections ?? initialSections,
      nativeConversationTurns: state.turns,
      nativeConversationRounds: state.rounds,
      done: result !== undefined,
    };
    return result === undefined ? base : { ...base, result };
  }

  private accumulateKnownCost(
    total: Opt<number, Reason.OptionalContext>,
    next: Opt<number, Reason.OptionalInput>,
  ): number | undefined {
    return total === undefined || next === undefined ? undefined : total + next;
  }

  private shouldFinishActionTurn(isComplete: boolean, allActionsSucceeded: boolean): boolean {
    return isComplete && allActionsSucceeded;
  }

  /** Executes one action, or returns the cap refusal without touching the tool. */
  private async attemptAction(
    action: IReActAction,
    options: IAgentExecutionOptions,
    withinCap: boolean,
  ): Promise<IToolExecutionResult> {
    return withinCap ? await this.executeTool(action, options) : { success: false, error: TOOL_CALL_LIMIT_MESSAGE };
  }

  /** The tool-round policy for this model turn. Static callers without a reader get schema defaults. */
  private roundPolicy(): IToolsRoundPolicy {
    return this.executor.getToolsRoundPolicy?.() ?? defaultToolsRoundPolicy(ToolsRoundLoop.REACT);
  }

  /** Caps one native tool result to the policy's token cap, with the chars-per-token estimate ReAct budgets with. */
  private capResultTokens(text: string, maxTokens: number): string {
    const maxChars = maxTokens * TOKEN_ESTIMATION_CHARS_PER_TOKEN;
    return text.length <= maxChars ? text : text.slice(0, maxChars) + PLANNING_TOOL_RESULT_TRUNCATED_SUFFIX;
  }

  /** Parses the provider response into thought, actions, and completion state.
   *  Dispatches to either the native-tools branch or the TOML-block branch. */
  private parseIterationResponse(
    response: IGenerateResult,
    nativeToolsUsed: boolean,
  ): {
    thought?: string;
    actions: IReActAction[];
    isComplete: boolean;
    parseErrors: string[];
    nativeToolCalls?: IProviderToolCall[];
  } {
    if (nativeToolsUsed) {
      const nativeResult = this.native.parseNativeToolResponse(response);
      return {
        actions: nativeResult.actions,
        isComplete: nativeResult.isComplete,
        parseErrors: [],
        nativeToolCalls: nativeResult.toolCalls,
      };
    }
    const parsed = parseReActResponse(response.content);
    return {
      thought: parsed.thought,
      actions: parsed.actions,
      isComplete: parsed.isComplete,
      parseErrors: parsed.parseErrors,
    };
  }

  private async executeTool(
    action: IReActAction,
    options: IAgentExecutionOptions,
  ): Promise<IToolExecutionResult> {
    // Enforced here, not just in prompt/ACI rendering: deriveVisibleToolIds already governs
    // what the model is shown, but nothing previously stopped a hallucinated or copied call
    // to an unlisted tool name from reaching ToolRegistry.execute.
    const visibleToolIds = this.deriveVisibleToolIds(options);
    if (!visibleToolIds.includes(action.tool)) {
      return { success: false, error: `Tool '${action.tool}' is not in this role's permitted_tools` };
    }

    if (!this.executor.toolRegistry) {
      throw new AgentExecutionError(
        "ToolRegistry not available",
        AgentExecutionErrorType.CONFIGURATION_ERROR,
      );
    }

    const enrichedParams = enrichPortalPathParam(action.tool, action.params, options.portal);

    return await this.executor.toolRegistry.execute(
      action.tool,
      enrichedParams,
    ) as IToolExecutionResult;
  }

  /** Canonicalizes one parsed action's name and parameter keys. Every later consumer sees
   *  only the canonical form: the allowlist check, portal prefixing, write tracking, history
   *  and the journal. Journals the rewrite when one occurred. */
  private canonicalizeAction(action: IReActAction, traceId: string, provider: string, model: string): IReActAction {
    if (!this.executor.toolRegistry) return action;
    const canonical = canonicalizeForRegistry(this.executor.toolRegistry, action.tool, action.params);
    if (canonical.rewritten) this.journal.logAliasRewrite(canonical, traceId, provider, model);
    return { ...action, tool: canonical.name, params: canonical.params };
  }

  /** Tools visible to this iteration. Uses `options.permitted_tools` when declared, an empty array stays empty, otherwise the default five.
   *  Entries are canonicalized and deduplicated, so an alias like `grep` resolves to its canonical id.
   *  Computed once for both the AVAILABLE TOOLS line and ACI rendering. */
  private deriveVisibleToolIds(options: IAgentExecutionOptions): string[] {
    const requested = options.permitted_tools ?? DEFAULT_REACT_VISIBLE_TOOLS;
    return [...new Set(requested.map(canonicalizeToolName))];
  }

  /** Renders this iteration's ACI guidance, or undefined when disabled. Pure with respect
   *  to this call: reads the executor's registry/budget getters, never mutates state. */
  private renderAciSection(visibleToolIds: string[]): { result: IAciRenderResult; budgetChars: number } | undefined {
    if (!this.executor.aciDocsEnabled) return undefined;
    const tools = this.executor.toolRegistry?.getTools() ?? [];
    const budgetChars = calculateAciDocBudgetChars(
      this.executor.aciDocPromptMaxChars ?? DEFAULT_AGENT_ACI_DOC_PROMPT_MAX_CHARS,
      this.executor.currentPromptBudget,
    );
    return { result: renderAciDocFragments(tools, visibleToolIds, budgetChars), budgetChars };
  }

  private async buildPrompt(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
    history: Array<{ role: ReActRole; content: string }>,
    skipToolProse = false,
    visibleToolIds: string[] = this.deriveVisibleToolIds(options),
    extras: IReActPromptExtras = {},
  ): Promise<string> {
    const aciSection = extras.aciSection ?? this.renderAciSection(visibleToolIds)?.result;
    return await this.executor.promptBuilder.buildExecutionPrompt(
      blueprint,
      context,
      options,
      {
        historyText: history.length > 0 ? this.historyBudget.buildBudgetedHistoryText(history) : "",
        skipToolProse,
        visibleToolIds,
        aciText: aciSection && aciSection.fragmentCount > 0 ? aciSection.text : undefined,
        nativeSections: extras.sections,
      },
      extras.skillsText,
    );
  }

  private createFinalResult(
    response: string,
    context: IExecutionContext,
    startTime: number,
    toolCallCount: number,
    writtenFiles: ReadonlySet<string>,
  ): IChangesetResult {
    // Extracts JSON from the response with the executor's parser, so the agent can end the loop with a summary JSON.
    const jsonResult = this.executor.parseAgentResponse(
      response,
      context,
      startTime,
    );

    // Always merge tool call count from the loop with any manual count in JSON
    jsonResult.tool_calls = (jsonResult.tool_calls || 0) + toolCallCount;

    // Report the files the loop actually wrote (union with any the parser found), so
    // the git audit can authorize the step's own changes rather than reverting them.
    jsonResult.files_changed = [...new Set([...(jsonResult.files_changed ?? []), ...writtenFiles])];

    // If we have a summary text but no explicit JSON description, use the summary
    const summaryMatch = response.match(
      new RegExp(`${REACT_SUMMARY_PREFIX}\\s*(.*)`, "s"),
    );
    if (
      summaryMatch &&
      (!jsonResult.description || jsonResult.description === context.plan)
    ) {
      jsonResult.description = summaryMatch[1].trim();
    }

    return jsonResult;
  }

  /** Delegates to the shared `native_tool_turns.ts` implementation (kept as an instance
   *  method for its existing direct-call test coverage). */
  private buildNativeToolDefinitions(tools: ITool[]): IToolDefinition[] {
    return buildNativeToolDefinitions(tools);
  }

  /** Delegates to the shared `native_tool_turns.ts` implementation (kept as an instance
   *  method for its existing direct-call test coverage). */
  private buildPriorTurn(toolCall: IProviderToolCall, result: IToolResult): IProviderTurn {
    return buildPriorTurn(toolCall, result);
  }
}
