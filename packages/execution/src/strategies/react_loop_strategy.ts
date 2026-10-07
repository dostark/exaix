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
import { PlanActionSchema } from "@exaix/schemas/plan_schema.ts";
import type {
  IModelProvider,
  INativeConversationSnapshot,
  IProviderTurn,
  IToolChoice,
  IToolDefinition,
} from "@exaix/ai/types.ts";
import { TOOL_CHOICE_TYPE_AUTO } from "@exaix/ai/types.ts";
import { PromptBudgetSection } from "@exaix/schemas/prompt_budget.ts";
import type { INativePromptSection } from "@exaix/ai";
import { PromptBudgetAllocator, SkillSubmissionKind } from "@exaix/core";
import type { IProviderToolCall } from "@exaix/ai/providers";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { ITool, IToolResult } from "@exaix/core/types";
import {
  AgentExecutionErrorType,
  canonicalizeToolName,
  ExecutionStrategyName,
  ToolCallEntryPoint,
  ToolName,
} from "@exaix/core";
import {
  buildNativeToolDefinitions,
  buildPriorTurn,
  enrichPortalPathParam,
  providerSupportsNativeConversation,
  providerSupportsNativeTools,
} from "../native_tool_turns.ts";
import { GuardrailBlockedError } from "@exaix/core/planning";
import { parse as parseToml } from "@std/toml";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";
import { DomainEventType, type IToolAliasRewrittenPayload } from "@exaix/core/events";
import {
  AGENT_EVENT_RESPONSE_TRUNCATED,
  CONTEXT_PRIORITY_REFLECTION,
  CONTEXT_PRIORITY_SYSTEM,
  CONTEXT_PRIORITY_TOOL_RESULT,
  DEFAULT_AGENT_ACI_DOC_PROMPT_MAX_CHARS,
  DEFAULT_AGENT_MAX_ITERATIONS,
  EXECUTION_HEARTBEAT_INTERVAL_MS,
  LOOP_HISTORY_BUDGET_THRESHOLD,
  REACT_CALLING_TOOL_PREFIX,
  REACT_DEFAULT_MAX_TOKENS,
  REACT_DEFAULT_TEMPERATURE,
  REACT_EVENT_ACTION_PARSE_FAILED,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  REACT_THOUGHT_PREFIX,
  REACT_TOOL_RESULT_BUDGET_RATIO,
  REACT_TOOL_RESULT_SUMMARY_MAX,
  RESPONSE_STOP_REASON_MAX_TOKENS,
  STREAMING_EVENT_HEARTBEAT,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import type { IModelCallOptions } from "@exaix/schemas";
import type { IContextBudgetManagerInput } from "../context/context_budget_manager.ts";
import type { IContextSegment } from "../context/context_segment.ts";
import type { IReActLoopExecutor } from "../react_loop_adapter.ts";
import { ContextBudgetExceededError } from "@exaix/core/errors";
import { computeRegistryPredictedCost } from "../registry_computed_cost.ts";
import type { IPinnedSkillPrompt } from "../skill_pin_transport.ts";
import {
  calculateAciDocBudgetChars,
  canonicalizeForRegistry,
  type IAciRenderResult,
  renderAciDocFragments,
} from "@exaix/tool-runtime";

export interface IReActAction {
  tool: string;
  params: Record<string, JSONValue>;
  description?: string;
}

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

/**
 * Roles for the internal ReAct loop history.
 */
enum ReActRole {
  THOUGHT = "thought",
  ACTION = "action",
  RESULT = "result",
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

export /** Internal type for dynamically-built provider.generate() options. */
interface GeneratedOptions {
  traceId?: string;
  temperature: number;
  max_tokens: number;
  tools?: IToolDefinition[];
  toolChoice?: IToolChoice;
  priorTurn?: IProviderTurn;
  nativeConversation?: INativeConversationSnapshot;
  /** "forced" means the preferred-tool branch chose this iteration's tool choice; "any"
   *  means the unconstrained fallback. Non-wire: ignored by provider request builders. */
  nativeToolChoiceMode?: NativeToolChoiceMode;
}

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

  constructor(
    private executor: IReActLoopExecutor,
    private provider?: Opt<IModelProvider, Reason.OptionalDependency>,
  ) {}

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

  /** Journal each dropped-action TOML parse error so a vanished action is attributable. */
  private journalParseErrors(parseErrors: string[], context: IExecutionContext, iteration: number): void {
    for (const parseError of parseErrors) {
      void this.executor.budgetLogger?.warn(
        REACT_EVENT_ACTION_PARSE_FAILED,
        context.request_id ?? null,
        { iteration, error: parseError, trace_id: context.trace_id },
        context.trace_id,
      );
    }
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

  /** Parses a native tool-use response into actions. Returns empty actions and
   *  isComplete=true when the model chose not to use any tool. */
  private parseNativeToolResponse(response: IGenerateResult): {
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

  /** Builds the options object for provider.generate() when native tools are active:
   *  tools, toolChoice (any + disable_parallel_tool_use), and priorTurn on iterations
   *  after the first. Returns base options when native tools are inactive. */
  private buildNativeGenerateOptions(
    nativeToolDefinitions?: Opt<IToolDefinition[], Reason.OptionalInput>,
    nativeToolsPriorTurn?: Opt<IProviderTurn, Reason.OptionalInput>,
    nativeToolsUsed = false,
    nativePreferredTool?: Opt<string, Reason.OptionalInput>,
  ): GeneratedOptions {
    const base = Object.assign({
      temperature: REACT_DEFAULT_TEMPERATURE,
      max_tokens: REACT_DEFAULT_MAX_TOKENS,
    }, this.callOptions) as GeneratedOptions;
    if (nativeToolsUsed && nativeToolDefinitions) {
      base.tools = nativeToolDefinitions;
      // A provider that cannot honor an explicit tool_choice still receives the tool list.
      const capabilities = this.provider?.callCapabilities;
      const forcedChoiceRefused = this.callOptions?.thinking === true &&
        capabilities?.supportsForcedToolChoiceWithThinking === false;
      if (capabilities?.supportsToolChoice !== false) {
        // PGAP-3: a detected preferred tool forces tool_choice: {type: "tool", name: "..."}.
        // That entry replaces the unconstrained {type: "any"} for a targeted-edit task.
        if (forcedChoiceRefused) {
          base.toolChoice = { type: TOOL_CHOICE_TYPE_AUTO, disable_parallel_tool_use: true };
          base.nativeToolChoiceMode = TOOL_CHOICE_TYPE_AUTO;
        } else if (nativePreferredTool && !nativeToolsPriorTurn) {
          base.toolChoice = { type: "tool" as const, name: nativePreferredTool, disable_parallel_tool_use: true };
          base.nativeToolChoiceMode = "forced";
        } else {
          base.toolChoice = nativeToolsPriorTurn
            ? { type: TOOL_CHOICE_TYPE_AUTO, disable_parallel_tool_use: true }
            : { type: "any" as const, disable_parallel_tool_use: true };
          base.nativeToolChoiceMode = nativeToolsPriorTurn ? TOOL_CHOICE_TYPE_AUTO : "any";
        }
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

  /** Log a warning when the response was truncated at max_tokens. */
  private logMaxTokensTruncation(
    response: IGenerateResult,
    options: IAgentExecutionOptions,
    iteration: number,
    context: IExecutionContext,
  ): void {
    if (response.stop_reason !== RESPONSE_STOP_REASON_MAX_TOKENS) return;
    void this.executor.budgetLogger?.warn(
      AGENT_EVENT_RESPONSE_TRUNCATED,
      context.request_id ?? null,
      {
        agent_role: options.agent_role ?? "",
        iteration,
        stop_reason: response.stop_reason,
        response_length: response.content.length,
        completion_tokens: response.usage.completionTokens,
      },
      context.trace_id,
    );
  }

  /** Journals the prompt_assembled event immediately before the provider-bound call —
   *  exactly one event per enabled iteration, none on the disabled path. */
  private async emitPromptAssembledEvent(
    context: IExecutionContext,
    iteration: number,
    aciSection: Opt<{ result: IAciRenderResult; budgetChars: number }, Reason.OptionalContext>,
  ): Promise<void> {
    if (!this.executor.aciDocsEnabled || !this.executor.logPromptAssembled) return;
    await this.executor.logPromptAssembled(context.trace_id, context.request_id, {
      prompt_kind: "react",
      iteration,
      toolIds: aciSection?.result.toolIds ?? [],
      fragmentCount: aciSection?.result.fragmentCount ?? 0,
      fragmentChars: aciSection?.result.fragmentChars ?? 0,
      budgetChars: aciSection?.budgetChars ?? 0,
      truncated: aciSection?.result.truncated ?? false,
    });
  }

  /** Executes one ReAct iteration; returns accumulated metrics and, if the loop should terminate early, a finished result. */
  private async prepareIterationPrompt(params: IIterationParams): Promise<{
    prompt: string;
    initialPrompt?: string;
    initialSections: INativePromptSection[];
    generateOptions: GeneratedOptions;
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
      : await this.applyContextBudget(blueprint, context, history, i);
    const visibleToolIds = this.deriveVisibleToolIds(options);
    const aciSection = this.renderAciSection(visibleToolIds);
    const initialSections: INativePromptSection[] = [];
    const initialPrompt = params.nativeConversationEnabled
      ? params.nativeConversationInitialPrompt ?? this.buildPrompt(
        blueprint,
        context,
        options,
        [],
        nativeToolsUsed,
        visibleToolIds,
        { aciSection: aciSection?.result, sections: initialSections, skillsText: params.pinnedSkills?.text },
      )
      : undefined;
    const prompt = initialPrompt ?? this.buildPrompt(
      blueprint,
      context,
      options,
      budgetedHistory,
      nativeToolsUsed,
      visibleToolIds,
      { aciSection: aciSection?.result, skillsText: params.pinnedSkills?.text },
    );

    const generateOptions = this.buildNativeGenerateOptions(
      nativeToolDefinitions,
      nativeToolsPriorTurn,
      nativeToolsUsed,
      nativePreferredTool,
    );
    generateOptions.traceId = context.trace_id;
    if (params.nativeConversationEnabled && nativeToolsUsed && initialPrompt !== undefined) {
      generateOptions.nativeConversation = {
        initialPrompt,
        initialPromptSections: params.nativeConversationInitialSections ?? initialSections,
        turns: params.nativeConversationTurns,
        ...(params.nativeConversationTurns.length > 0
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

  private async logIterationGeneration(
    response: IGenerateResult,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
    generateDurationMs: number,
  ): Promise<number | undefined> {
    const registryCostUsd = response.costStatus === undefined
      ? computeRegistryPredictedCost(response.provider, response.model, {
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        cacheReadTokens: response.usage.cacheReadTokens,
        cacheCreationTokens: response.usage.cacheCreationTokens,
      })
      : undefined;
    const costUsd = response.costStatus === "unknown"
      ? undefined
      : response.costStatus !== undefined
      ? response.cost_usd
      : registryCostUsd ?? response.cost_usd ?? 0;

    await this.executor.logGeneration(
      context.trace_id,
      options.agent_role ?? "",
      response.model,
      response.provider,
      {
        ...response.usage,
        costUsd,
        ...(response.costStatus !== undefined
          ? { costSource: costUsd === undefined ? "unknown" as const : "predicted" as const }
          : {}),
        durationMs: generateDurationMs,
      },
    );

    return costUsd;
  }

  private async runSingleIteration(
    params: IIterationParams,
  ): Promise<IIterationResult> {
    const {
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
      nativeToolsPriorTurn,
    } = params;
    if (this.executor.guardrailRunner?.hasBlockingViolation(context.trace_id)) {
      throw new GuardrailBlockedError(
        context.trace_id,
        "Execution halted by a blocking guardrail violation",
      );
    }

    const { prompt, initialPrompt, initialSections, generateOptions, aciSection } = await this.prepareIterationPrompt(
      params,
    );
    await this.preflightNativeConversationBudget(
      blueprint,
      generateOptions.nativeConversation,
      generateOptions,
      context.trace_id,
    );
    await this.emitPromptAssembledEvent(context, i, aciSection);
    await params.pinnedSkills?.record(prompt, SkillSubmissionKind.PROVIDER, i + 1);
    const generateStartTime = Date.now();
    const response = await this.withHeartbeat(context, () => this.provider!.generate(prompt, generateOptions as never));
    const generateDurationMs = Date.now() - generateStartTime;

    this.logMaxTokensTruncation(response, options, i, context);

    const costUsd = await this.logIterationGeneration(response, context, options, generateDurationMs);

    const iterPromptTokens = response.usage.promptTokens;
    const iterCompletionTokens = response.usage.completionTokens;
    const iterCostUsd = costUsd;
    const iterCacheReadTokens = response.usage.cacheReadTokens ?? 0;
    const iterCacheCreationTokens = response.usage.cacheCreationTokens ?? 0;
    const iterReasoningTokens = response.usage.reasoningTokens ?? 0;

    const newTotalPromptTokens = totalPromptTokens + iterPromptTokens;
    const newTotalCompletionTokens = totalCompletionTokens + iterCompletionTokens;
    const newTotalCostUsd = this.accumulateKnownCost(totalCostUsd, iterCostUsd);
    const newTotalCacheReadTokens = totalCacheReadTokens + iterCacheReadTokens;
    const newTotalCacheCreationTokens = totalCacheCreationTokens + iterCacheCreationTokens;
    const newTotalReasoningTokens = totalReasoningTokens + iterReasoningTokens;

    const parsed = this.parseIterationResponse(response, nativeToolsUsed);

    if (!nativeToolsUsed) {
      this.journalParseErrors(parsed.parseErrors, context, i);
    }

    if (parsed.thought) {
      history.push({ role: ReActRole.THOUGHT, content: parsed.thought });
      await this.executor.logAgentOutput(context.trace_id, `${REACT_THOUGHT_PREFIX} ${parsed.thought}`);
    }

    if (parsed.isComplete && parsed.actions.length === 0) {
      const result = this.finishLoop(
        response.content,
        context,
        startTime,
        toolCallCount,
        writtenFiles,
        {
          promptTokens: newTotalPromptTokens,
          completionTokens: newTotalCompletionTokens,
          costUsd: newTotalCostUsd,
          cacheReadTokens: newTotalCacheReadTokens,
          cacheCreationTokens: newTotalCacheCreationTokens,
          reasoningTokens: newTotalReasoningTokens,
        },
      );
      return {
        toolCallCount,
        totalPromptTokens: newTotalPromptTokens,
        totalCompletionTokens: newTotalCompletionTokens,
        totalCostUsd: newTotalCostUsd,
        totalCacheReadTokens: newTotalCacheReadTokens,
        totalCacheCreationTokens: newTotalCacheCreationTokens,
        totalReasoningTokens: newTotalReasoningTokens,
        done: true,
        result,
      };
    }

    if (parsed.actions.length === 0) {
      throw new AgentExecutionError(
        "No actions generated in ReAct iteration",
        AgentExecutionErrorType.EXECUTION_ERROR,
      );
    }

    const maxToolCalls = options.max_tool_calls ?? 100;
    if (toolCallCount + parsed.actions.length > maxToolCalls) {
      throw new AgentExecutionError(
        `Exceeded maximum tool calls (${maxToolCalls})`,
        AgentExecutionErrorType.EXECUTION_ERROR,
      );
    }

    if (response.content) {
      void this.executor.guardrailRunner?.screen(response.content, context.trace_id, i);
    }

    let newToolCallCount = toolCallCount;
    let lastPriorTurn = nativeToolsPriorTurn;
    const completedNativeConversationTurns = [...params.nativeConversationTurns];
    let allActionsSucceeded = true;
    for (let a = 0; a < parsed.actions.length; a++) {
      const action = this.canonicalizeAction(parsed.actions[a], context.trace_id, response.provider, response.model);
      const execResult = await this.executeTool(action, options);
      allActionsSucceeded &&= execResult.success === true;
      this.recordWrittenFile(action, execResult, writtenFiles);

      const toolResultContent = execResult.success
        ? JSON.stringify(execResult.data ?? {})
        : (execResult.error ?? "Unknown error");
      newToolCallCount++;

      const toolCallLine = `${REACT_CALLING_TOOL_PREFIX}${action.tool}(${JSON.stringify(action.params)})`;
      history.push({ role: ReActRole.ACTION, content: toolCallLine });

      const resultEntry = `Tool ${action.tool} result: ${toolResultContent}`;
      const truncatedResult = resultEntry.length > REACT_TOOL_RESULT_SUMMARY_MAX
        ? resultEntry.slice(0, REACT_TOOL_RESULT_SUMMARY_MAX) + "..."
        : resultEntry;
      history.push({ role: ReActRole.RESULT, content: truncatedResult });

      await this.executor.logDynamicToolCall?.(
        context.trace_id,
        action.tool,
        action.params,
        toolResultContent.slice(0, REACT_TOOL_RESULT_SUMMARY_MAX),
        i,
      );

      if (nativeToolsUsed && parsed.nativeToolCalls?.[a]) {
        lastPriorTurn = this.buildPriorTurn(
          parsed.nativeToolCalls[a],
          execResult as never,
        );
        completedNativeConversationTurns.push(lastPriorTurn);
      }
    }

    if (this.shouldFinishActionTurn(parsed.isComplete, allActionsSucceeded)) {
      const result = this.finishLoop(
        response.content,
        context,
        startTime,
        newToolCallCount,
        writtenFiles,
        {
          promptTokens: newTotalPromptTokens,
          completionTokens: newTotalCompletionTokens,
          costUsd: newTotalCostUsd,
          cacheReadTokens: newTotalCacheReadTokens,
          cacheCreationTokens: newTotalCacheCreationTokens,
          reasoningTokens: newTotalReasoningTokens,
        },
      );
      return {
        toolCallCount: newToolCallCount,
        totalPromptTokens: newTotalPromptTokens,
        totalCompletionTokens: newTotalCompletionTokens,
        totalCostUsd: newTotalCostUsd,
        totalCacheReadTokens: newTotalCacheReadTokens,
        totalCacheCreationTokens: newTotalCacheCreationTokens,
        totalReasoningTokens: newTotalReasoningTokens,
        nativeToolsPriorTurn: lastPriorTurn,
        nativeConversationInitialPrompt: initialPrompt,
        nativeConversationInitialSections: params.nativeConversationInitialSections ?? initialSections,
        nativeConversationTurns: completedNativeConversationTurns,
        done: true,
        result,
      };
    }

    return {
      toolCallCount: newToolCallCount,
      totalPromptTokens: newTotalPromptTokens,
      totalCompletionTokens: newTotalCompletionTokens,
      totalCostUsd: newTotalCostUsd,
      totalCacheReadTokens: newTotalCacheReadTokens,
      totalCacheCreationTokens: newTotalCacheCreationTokens,
      totalReasoningTokens: newTotalReasoningTokens,
      nativeToolsPriorTurn: lastPriorTurn,
      nativeConversationInitialPrompt: initialPrompt,
      nativeConversationInitialSections: params.nativeConversationInitialSections ?? initialSections,
      nativeConversationTurns: completedNativeConversationTurns,
      done: false,
    };
  }

  private accumulateKnownCost(
    total: Opt<number, Reason.OptionalContext>,
    next: Opt<number, Reason.OptionalInput>,
  ): number | undefined {
    return total === undefined || next === undefined ? undefined : total + next;
  }

  /** Keep each native tool call paired with its result. Reject an oversized complete snapshot before generation. */
  private async preflightNativeConversationBudget(
    blueprint: IAgentFileBlueprint,
    snapshot: Opt<INativeConversationSnapshot, Reason.OptionalContext>,
    options: GeneratedOptions,
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

  private shouldFinishActionTurn(isComplete: boolean, allActionsSucceeded: boolean): boolean {
    return isComplete && allActionsSucceeded;
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
      const nativeResult = this.parseNativeToolResponse(response);
      return {
        actions: nativeResult.actions,
        isComplete: nativeResult.isComplete,
        parseErrors: [],
        nativeToolCalls: nativeResult.toolCalls,
      };
    }
    const parsed = this.parseResponse(response.content);
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
    if (canonical.rewritten) this.logAliasRewrite(canonical, traceId, provider, model);
    return { ...action, tool: canonical.name, params: canonical.params };
  }

  private logAliasRewrite(
    call: ReturnType<typeof canonicalizeForRegistry>,
    traceId: string,
    provider: string,
    model: string,
  ): void {
    const logger = this.executor.budgetLogger;
    if (!logger) return;
    const payload: IToolAliasRewrittenPayload = {
      requestedName: call.requestedName,
      canonicalName: call.name,
      renamedParams: [...call.renamedParams],
      droppedParams: [...call.droppedParams],
      entryPoint: ToolCallEntryPoint.REACT_LOOP,
      provider,
      model,
    };
    void logger.info(DomainEventType.ToolAliasRewritten, call.name, { ...payload }, traceId);
  }

  /** Wraps an async operation with a heartbeat timer, emitting STREAMING_EVENT_HEARTBEAT
   *  every EXECUTION_HEARTBEAT_INTERVAL_MS while in flight. Timer always cleared in finally. */
  private async withHeartbeat<T>(
    context: IExecutionContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    const bus = this.executor.eventBus;
    const stepName = context.plan;
    const loopStart = Date.now();

    let heartbeatId: ReturnType<typeof setInterval> | undefined;
    if (bus) {
      heartbeatId = setInterval(() => {
        const event: IStreamingEvent = {
          eventId: crypto.randomUUID(),
          traceId: context.trace_id,
          timestamp: new Date().toISOString(),
          type: STREAMING_EVENT_HEARTBEAT,
          payload: {
            step: stepName,
            elapsed_ms: Date.now() - loopStart,
          },
        };
        bus.publish(event);
      }, EXECUTION_HEARTBEAT_INTERVAL_MS);
    }

    try {
      return await operation();
    } finally {
      if (heartbeatId !== undefined) {
        clearInterval(heartbeatId);
      }
    }
  }

  /** Applies IContextBudgetManager to the current iteration's history. Returns filtered
   *  history when the manager is configured, or the original history unchanged when it
   *  is absent (backward-compatible). */
  private async applyContextBudget(
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

  /** Tools visible to this iteration. Uses `options.permitted_tools` when declared, an
   *  explicit empty array stays empty, else the default five. Each entry is canonicalized
   *  then deduplicated, so an alias like `grep` resolves to its canonical id. Computed once
   *  and reused for both the AVAILABLE TOOLS line and ACI rendering. */
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

  private buildPrompt(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
    history: Array<{ role: ReActRole; content: string }>,
    skipToolProse = false,
    visibleToolIds: string[] = this.deriveVisibleToolIds(options),
    extras: IReActPromptExtras = {},
  ): string {
    const aciSection = extras.aciSection ?? this.renderAciSection(visibleToolIds)?.result;
    const sections = extras.sections;
    const skillsSection = extras.skillsText ? `${extras.skillsText}\n\n` : "";
    const historyText = this.buildBudgetedHistoryText(history);

    const roleSection = `${
      sections && blueprint.systemPrompt ? `${blueprint.systemPrompt}\n\n` : ""
    }AGENT ROLE: ${blueprint.name}
CAPABILITIES: ${blueprint.capabilities.join(", ")}

CONTEXT:
Portal: ${options.portal}
Trace ID: ${context.trace_id}
`;
    const planSection = `Request: ${context.request}\nPlan Step: ${context.plan}\n`;
    let prompt = `${roleSection}${skillsSection}${planSection}
${history.length > 0 ? `HISTORY:\n${historyText}` : ""}

INSTRUCTIONS:
1. Reason about the current state.
2. If you need more information or need to make changes, output one or more tool calls.
3. If the task is finished, output "${REACT_STATUS_COMPLETE}" and provide a summary of changes.
4. Output your thought process preceded by "${REACT_THOUGHT_PREFIX}".`;

    // Segment 1: Tool listing — always rendered (PGAP-2)
    prompt += `

AVAILABLE TOOLS:
${visibleToolIds.join(", ")}`;

    // Segment 1.5: ACI tool guidance — appended in both prose and skipToolProse (native-tools)
    // modes when enabled and at least one complete fragment was allocated.
    if (aciSection && aciSection.fragmentCount > 0) {
      prompt += `

ACI TOOL GUIDANCE:
${aciSection.text}`;
    }

    // Segment 2: Behavioral guidance — always rendered (PGAP-2)
    prompt += `

TOOL SELECTION GUIDELINES:
- For reading files or searching code: use read_file, search_text, or search_files.
- For creating NEW files or overwriting entire files: use write_file.
- For small targeted edits (fixing bugs, null-guard fixes): prefer patch_file over write_file.
- For shell commands: use run_command only when no specialized tool exists for your task.`;

    // Segment 3: Format specification — skipped when native tools are active (PGAP-2)
    if (!skipToolProse) {
      prompt += `

FORMAT:
${REACT_THOUGHT_PREFIX}[Your reasoning]
\`\`\`toml
[[actions]]
tool = "[tool_name]"
[actions.params]
[param_name] = [value]
\`\`\`

OR

${REACT_STATUS_COMPLETE}
${REACT_SUMMARY_PREFIX}[What was done]`;
    } else {
      prompt += `

When you are finished, output "${REACT_STATUS_COMPLETE}" followed by "${REACT_SUMMARY_PREFIX}[summary]".`;
    }

    sections?.push(
      { section: PromptBudgetSection.SYSTEM, text: roleSection },
      ...(skillsSection ? [{ section: PromptBudgetSection.SKILLS, text: skillsSection }] : []),
      { section: PromptBudgetSection.PLAN, text: planSection },
      {
        section: PromptBudgetSection.SYSTEM,
        text: prompt.slice(roleSection.length + skillsSection.length + planSection.length),
      },
    );
    return prompt;
  }

  private buildBudgetedHistoryText(
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

  private parseResponse(
    response: string,
  ): { thought?: string; actions: IReActAction[]; isComplete: boolean; parseErrors: string[] } {
    const isComplete = response.includes(REACT_STATUS_COMPLETE);
    const parseErrors: string[] = [];

    // Capture the text after the THOUGHT: prefix up to the first action block, the
    // completion marker, or end of response. No literal spaces inside the lookahead
    // alternatives: the previous pattern required a space-padded " ```toml " / " $",
    // which never matches fence-on-its-own-line responses — so thought was always
    // undefined and the model's reasoning never entered the loop history.
    const thoughtPattern = `${REACT_THOUGHT_PREFIX}\\s*(.*?)(?=\`\`\`toml|${REACT_STATUS_COMPLETE}|$)`;
    const thoughtMatch = response.match(new RegExp(thoughtPattern, "s"));
    const thought = thoughtMatch ? thoughtMatch[1].trim() : undefined;

    const actions: IReActAction[] = [];
    const codeBlockRegex = /```toml\s*([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(response)) !== null) {
      try {
        const block = match[1].trim();
        const parsed = parseToml(block) as { actions?: unknown };

        if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.actions)) {
          continue;
        }

        // Every action is validated with PlanActionSchema at this boundary before the
        // registry sees it. A malformed or hostile action is rejected here and journaled
        // as a parse error, never executed.
        for (const act of parsed.actions) {
          if (act === null || typeof act !== "object") {
            parseErrors.push("ReAct action is not an object");
            continue;
          }
          const candidate = act as { tool?: unknown; params?: unknown; description?: unknown };
          const validated = PlanActionSchema.safeParse({
            tool: candidate.tool,
            params: candidate.params ?? {},
            description: candidate.description,
          });
          if (!validated.success) {
            parseErrors.push(validated.error.issues.map((issue) => issue.message).join("; "));
            continue;
          }
          actions.push(validated.data);
        }
      } catch (error) {
        // A malformed action block must not vanish silently — a dropped action is how a
        // fix disappears while the loop reports success. Collect the error for the caller
        // to journal.
        parseErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return { thought, actions, isComplete, parseErrors };
  }

  private createFinalResult(
    response: string,
    context: IExecutionContext,
    startTime: number,
    toolCallCount: number,
    writtenFiles: ReadonlySet<string>,
  ): IChangesetResult {
    // Try to extract JSON from the response using the executor's parser (Phase 61.2)
    // This allows the agent to provide a summary JSON at the end of the ReAct loop
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
