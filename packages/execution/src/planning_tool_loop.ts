/**
 * @module PlanningToolLoop
 * @path packages/execution/src/planning_tool_loop.ts
 * @description Bounded, read-only native-tool loop for the planning LLM call (Phase 199).
 * Given a base prompt and a portal-rooted read-only IToolRegistry, runs exploration rounds
 * (toolChoice auto, parallel disabled) followed by a mandatory tool-less final round
 * (toolChoice none), carrying every tool result forward — the most recent as IProviderTurn,
 * earlier ones as capped transcript blocks. Confines every tool path to the request portal
 * and screens tool results through an optional IGuardrailRunner before they reach the model.
 * A live OpenRouter Claude Haiku final round accepted replayed results without tool definitions.
 * Native snapshots therefore keep the final round tool-less. Legacy replay retains definitions with toolChoice none.
 * @architectural-layer Services
 * @related-files ["packages/execution/src/agent_runner.ts", "packages/execution/src/native_tool_turns.ts", "packages/execution/src/strategies/react_loop_strategy.ts"]
 */

import { TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/shared";
import { isAbsolute, resolve, SEPARATOR } from "@std/path";
import type {
  IModelOptions,
  IProviderToolRound,
  IProviderTurn,
  IToolChoice,
  IToolDefinition,
  IValidatedProviderRound,
  IValidatedRoundCall,
} from "@exaix/ai/types.ts";
import { TOOL_CHOICE_TYPE_AUTO, TOOL_CHOICE_TYPE_NONE } from "@exaix/ai/types.ts";
import type { IGenerateResult, IProviderToolCall } from "@exaix/ai/providers";
import type { INativeInputMeasurement } from "@exaix/ai";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { ProviderProtocolError } from "@exaix/ai/errors.ts";
import type { ICallSite } from "@exaix/ai/types.ts";
import type { IEventLogger } from "@exaix/core/logger";
import type { ITokenizer } from "@exaix/core/func";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import type { IToolsRoundPolicy } from "@exaix/schemas";
import { ContextBudgetExceededError } from "@exaix/core/errors";
import {
  DomainEventType,
  type IPlanningToolLoopAbortedPayload,
  type IPlanningToolLoopCompletedPayload,
  type IToolAliasRewrittenPayload,
} from "@exaix/core/events";
import {
  canonicalizeToolName,
  isRejectedNativeToolName,
  PLANNING_TOOL_RESULT_TAG,
  PLANNING_TOOL_RESULT_TRUNCATED_SUFFIX,
  PLANNING_TOOLS_CONTINUE_ROUND_INSTRUCTION,
  PLANNING_TOOLS_EXPLORE_ROUND_INSTRUCTION,
  PLANNING_TOOLS_FINAL_ROUND_INSTRUCTION,
  PLANNING_TOOLS_UNTRUSTED_DATA_NOTICE,
  PlanningToolLoopStopReason,
  REACT_TOOL_RESULT_SUMMARY_MAX,
} from "@exaix/core";
import { canonicalizeForRegistry, PathSecurity } from "@exaix/tool-runtime";
import {
  AGENT_EVENT_RESPONSE_REFUSED,
  RESPONSE_STOP_REASON_REFUSAL,
  ToolCallEntryPoint,
  ToolName,
  ToolsRoundMode,
} from "@exaix/core";
import type { IGuardrailRunner } from "./guardrail_runner.ts";
import {
  assertRoundWithinBounds,
  buildNativeToolDefinitions,
  buildPriorTurn,
  buildToolRound,
  enrichPortalPathParam,
  type IRoundOutcome,
  providerRoundCallCount,
  providerSupportsNativeConversation,
  providerSupportsParallelToolReplay,
  roundLimitsOf,
  TOOL_CALL_LIMIT_MESSAGE,
  validateProviderRound,
} from "./native_tool_turns.ts";
import { FIXED_NATIVE_ROUND_LIMITS, type INativeRoundLimits } from "@exaix/ai/native_round_limits.ts";
import { tokenBoundedPrefix } from "./context/token_bounded_prefix.ts";

export interface IPlanningToolLoopDeps {
  toolRegistry: IToolRegistry;
  tokenizer: ITokenizer;
  /** Bare model id passed to tokenizer.countTokens — never throws on an unrecognized model. */
  modelId: string;
  /** One round through AgentRunner.executeWithRetry — retry is per round, never re-executing
   *  a prior round's tool calls. */
  generate: (prompt: string, options: IModelOptions) => Promise<IGenerateResult>;
  logger?: IEventLogger;
  guardrailRunner?: IGuardrailRunner;
  /** The generating provider's instance id — resolves whether it accepts a native-conversation
   *  snapshot (IModelOptions.nativeConversation) via ProviderRegistry. Absent always runs the
   *  legacy priorTurn + text-transcript path. */
  providerId?: string;
  /** Measures a native-conversation round's real input tokens for the pre-flight budget check. */
  measureInputTokens?: IModelProvider["measureInputTokens"];
  /** Reads the resolved tool-round policy once per model turn. Absent, the run's own caps apply
   *  and auto sends no parallel flag. */
  toolsRoundPolicy?: () => IToolsRoundPolicy;
}

export interface IPlanningToolLoopOptions {
  /** Base combinedPrompt (system + context + schema + request), unmodified by the loop
   *  when maxRounds === 1. */
  prompt: string;
  /** conversationId/traceId/jsonSchema/thinking/effort, as AgentRunner.executeWithRetry
   *  builds them today; the loop adds tools/toolChoice/priorTurn/callSite on top. */
  baseOptions: IModelOptions;
  /** Called once per round; a fresh callSite gives fixture replay a distinct callIndex per round. */
  nextCallSite: () => Opt<ICallSite, Reason.TraceAbsent>;
  portalAlias: string;
  /** Absolute portal root every tool path is confined to. */
  portalRoot: string;
  /** The read-only catalog names offered this request (readOnlyEditorTools()'s names). */
  allowedTools: ReadonlySet<string>;
  maxRounds: number;
  maxToolResultTokens: number;
  /** Calls executed per round when no toolsRoundPolicy reader is given. The rest get an error result. */
  maxToolCallsPerRound: number;
  traceId: string;
  /** AgentRunner's already-computed prompt budget for this request — checked before every
   *  native-conversation round via IPlanningToolLoopDeps.measureInputTokens. Absent skips the
   *  preflight (today's unbounded behavior). Ignored entirely in the legacy path. */
  promptBudget?: IPromptBudget;
}

/** Totals accumulated across rounds, kept outside the loop body so an abort can report them. */
interface ILoopProgress {
  rounds: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface IPlanningToolLoopResult {
  final: IGenerateResult;
  rounds: number;
  toolCalls: number;
  stopReason: PlanningToolLoopStopReason;
  promptTokens: number;
  completionTokens: number;
}

/** Replay state one planning run carries between rounds. The replay mode decides which field grows. */
interface IRoundHistory {
  transcript: string;
  priorTurn: Opt<IProviderTurn, Reason.OptionalInput>;
  priorTurnTool: string;
  priorTurnRound: number;
  priorRound: Opt<IProviderToolRound, Reason.OptionalInput>;
  priorRoundNumber: number;
  nativeTurns: IProviderTurn[];
  nativeRounds: IProviderToolRound[];
  /** Call ids of every executed round. A later round may not reuse one. */
  consumedIds: Set<string>;
}

/** Inputs for one generate request, before the replay mode is applied. */
interface IRoundRequest {
  basePrompt: string;
  baseOptions: IModelOptions;
  allowedToolDefs: IToolDefinition[];
  maxRounds: number;
  isFinalRound: boolean;
  callSite: Opt<ICallSite, Reason.TraceAbsent>;
  nativeConversationEnabled: boolean;
  groupedRounds: boolean;
  parallelMode: ToolsRoundMode;
}

/** The outcome of one round's calls, before the round is replayed. */
interface IExecutedRound {
  lastTurn: Opt<IProviderTurn, Reason.OptionalInput>;
  lastTool: string;
  transcript: string;
  guardrailBlocked: boolean;
  outcomes: IRoundOutcome[];
}

/** The call a validated round executes. A call the round could not read is refused, never executed. */
function executableCall(call: IValidatedRoundCall): IProviderToolCall {
  if (call.validationError === undefined) return call.originalCall;
  return {
    ...call.originalCall,
    rawArguments: call.originalCall.rawArguments ?? JSON.stringify(call.originalCall.input),
  };
}

/** Off asks the provider for one call per response. Auto sends no parallel flag, so the provider default applies. */
function autoToolChoice(mode: ToolsRoundMode): IToolChoice {
  return mode === ToolsRoundMode.OFF
    ? { type: TOOL_CHOICE_TYPE_AUTO, disable_parallel_tool_use: true }
    : { type: TOOL_CHOICE_TYPE_AUTO };
}

/** Tool call parameter names the confinement guard checks — every string value under these
 *  keys must resolve inside the request portal before the tool call reaches ToolRegistry.
 *  `file_path` is the alias ToolRegistry accepts in place of `path`. */
const CONFINED_PARAM_NAMES = [
  "path",
  "file_path",
  "filePath",
  "filepath",
  "repo_path",
  "from",
  "file",
  "target_file",
  "absolute_path",
  "dir_path",
  "directory",
  "folder",
] as const;

/** The search_files glob parameter. Its pattern must not climb above the search root. */
const SEARCH_PATTERN_PARAM = "pattern";

const CONFINEMENT_DENIED_MESSAGE = "Access denied: path is outside the request portal";
const GUARDRAIL_BLOCKED_MESSAGE = "blocked by guardrail";
/** Journal target and `phase` payload value that mark planning-call tool rows. */
const PLANNING_LOG_PHASE = "planning";
const INVALID_TOOL_ARGUMENTS_MESSAGE = "tool call arguments are not a valid JSON object; call skipped";

/** True when a search_files pattern is absolute or has a `..` segment. */
function escapesSearchRoot(toolName: string, params: Record<string, JSONValue>): boolean {
  const pattern = params[SEARCH_PATTERN_PARAM];
  if (toolName !== ToolName.SEARCH_FILES || typeof pattern !== "string") return false;
  return isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..");
}

/** Maps ToolRegistry's ITool[] to the provider-agnostic IToolDefinition[] the planner may
 *  call, filtered to the read-only catalog names AgentRunner resolved for this request. */
export function buildAllowedToolDefinitions(tools: ITool[], allowed: ReadonlySet<string>): IToolDefinition[] {
  return buildNativeToolDefinitions(tools.filter((t) => allowed.has(t.name)));
}

/** Bounded read-only native-tool loop for the planning LLM call: reads (never mutates) the
 *  request portal before AgentRunner commits to a plan. Cross-component (ToolRegistry,
 *  guardrail) on the request/plan critical path. @visible */
export class PlanningToolLoop {
  private readonly deps: IPlanningToolLoopDeps;
  private readonly logger?: IEventLogger;

  constructor(deps: IPlanningToolLoopDeps) {
    this.deps = deps;
    this.logger = deps.logger;
  }

  async run(options: IPlanningToolLoopOptions): Promise<IPlanningToolLoopResult> {
    const progress: ILoopProgress = { rounds: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0 };
    try {
      return await this.runRounds(options, progress);
    } catch (error) {
      this.logLoopAborted(
        { ...progress, error: error instanceof Error ? error.message : String(error) },
        options.traceId,
      );
      throw error;
    }
  }

  private async runRounds(
    options: IPlanningToolLoopOptions,
    progress: ILoopProgress,
  ): Promise<IPlanningToolLoopResult> {
    const catalogNames = new Set(this.deps.toolRegistry.getTools().map((tool) => tool.name));
    const canonicalOptions: IPlanningToolLoopOptions = {
      ...options,
      allowedTools: new Set(
        [...options.allowedTools]
          .map(canonicalizeToolName)
          .filter((name) => !isRejectedNativeToolName(name) && catalogNames.has(name)),
      ),
    };
    const allowedToolDefs = buildAllowedToolDefinitions(
      this.deps.toolRegistry.getTools(),
      canonicalOptions.allowedTools,
    );
    const basePrompt = options.maxRounds === 1
      ? options.prompt
      : `${options.prompt}\n\n${PLANNING_TOOLS_UNTRUSTED_DATA_NOTICE}`;
    // A native-conversation provider owns its snapshot instead of the text transcript/priorTurn.
    const nativeConversationEnabled = options.maxRounds > 1 &&
      providerSupportsNativeConversation(this.deps.providerId);
    // A grouped-replay provider validates each round whole before any call executes. A native-conversation
    // one keeps every completed round in its snapshot. Any other grouped provider replays only the latest round.
    const parallelReplayEnabled = options.maxRounds > 1 && providerSupportsParallelToolReplay(this.deps.providerId);

    const history: IRoundHistory = {
      transcript: "",
      priorTurn: undefined,
      priorTurnTool: "",
      priorTurnRound: 0,
      priorRound: undefined,
      priorRoundNumber: 0,
      nativeTurns: [],
      nativeRounds: [],
      consumedIds: new Set(),
    };
    let finalRoundIndex = options.maxRounds;
    let guardrailForced = false;

    for (let round = 1; round <= finalRoundIndex; round++) {
      progress.rounds = round;
      const isFinalRound = round === finalRoundIndex;
      const policy = this.roundPolicy(options);
      const roundOptions: IPlanningToolLoopOptions = {
        ...canonicalOptions,
        maxToolCallsPerRound: policy.executionCap,
        maxToolResultTokens: policy.resultTokenCap,
      };
      const request = this.buildRoundRequest(history, {
        basePrompt,
        baseOptions: options.baseOptions,
        allowedToolDefs,
        maxRounds: options.maxRounds,
        isFinalRound,
        callSite: options.nextCallSite(),
        nativeConversationEnabled,
        groupedRounds: parallelReplayEnabled,
        parallelMode: policy.mode,
      });

      if (options.promptBudget) {
        await this.preflightBudget(request.roundPrompt, request.roundOptions, options.promptBudget, options.traceId);
      }

      const response = await this.generateRound(request.roundPrompt, request.roundOptions, isFinalRound);
      if (response.stop_reason === RESPONSE_STOP_REASON_REFUSAL) {
        // A refused round carries no content, so the loop ends without a plan. The journal says why.
        void this.deps.logger?.warn(AGENT_EVENT_RESPONSE_REFUSED, this.deps.modelId, {
          model: this.deps.modelId,
          round,
          stop_reason: response.stop_reason,
          response_length: response.content.length,
        }, options.traceId);
      }
      progress.promptTokens += response.usage.promptTokens;
      progress.completionTokens += response.usage.completionTokens;

      if (isFinalRound) {
        // Never execute tools on the final round, even if the provider still returned some.
        const stopReason = this.finalStopReason(response, guardrailForced);
        return this.finish({
          response,
          rounds: round,
          toolCalls: progress.toolCalls,
          stopReason,
          promptTokens: progress.promptTokens,
          completionTokens: progress.completionTokens,
        }, options.traceId);
      }

      const roundCallCount = parallelReplayEnabled
        ? providerRoundCallCount(response)
        : (response.toolCalls?.length ?? 0);
      if (roundCallCount === 0) {
        if (options.baseOptions.jsonSchema) {
          // Exploration can return a draft. Finalize it once under the output schema before returning a plan.
          finalRoundIndex = Math.min(finalRoundIndex, round + 1);
          continue;
        }
        return this.finish({
          response,
          rounds: round,
          toolCalls: progress.toolCalls,
          stopReason: PlanningToolLoopStopReason.NO_TOOL_CALLS,
          promptTokens: progress.promptTokens,
          completionTokens: progress.completionTokens,
        }, options.traceId);
      }

      // A grouped round is validated whole, and a legacy round is bounded, before any call of it executes.
      const limits = roundLimitsOf(policy);
      const validated = this.admitRound(response, limits, history.consumedIds, parallelReplayEnabled);
      const calls = validated ? validated.calls.map(executableCall) : (response.toolCalls ?? []);
      const executed = await this.executeRoundCalls(calls, roundOptions, round, progress, {
        provider: response.provider,
        model: response.model,
      });
      this.recordRound(history, round, { executed, validated, limits }, nativeConversationEnabled);

      if (executed.guardrailBlocked) {
        guardrailForced = true;
        finalRoundIndex = Math.min(finalRoundIndex, round + 1);
      }
    }

    // Unreachable: the loop always returns from inside the for-body (isFinalRound is always
    // hit by round === finalRoundIndex, since finalRoundIndex only ever shrinks toward round+1).
    throw new Error("PlanningToolLoop.run: exited without a final response");
  }

  /** Refuses a round that breaks the ceilings or reuses an id, before any call runs. A grouped provider gets
   *  its round validated whole. */
  private admitRound(
    response: IGenerateResult,
    limits: INativeRoundLimits,
    earlierIds: ReadonlySet<string>,
    grouped: boolean,
  ): Opt<IValidatedProviderRound, Reason.OptionalInput> {
    if (grouped) return validateProviderRound(response, limits, earlierIds);
    assertRoundWithinBounds(response.toolCalls ?? [], limits, response.provider, earlierIds);
    return undefined;
  }

  /** The policy for one model turn. Without a reader, the run's own caps apply with auto. */
  private roundPolicy(options: IPlanningToolLoopOptions): IToolsRoundPolicy {
    return this.deps.toolsRoundPolicy?.() ?? {
      mode: ToolsRoundMode.AUTO,
      executionCap: options.maxToolCallsPerRound,
      concurrency: 1,
      maxResponseCalls: FIXED_NATIVE_ROUND_LIMITS.maxResponseCalls,
      maxArgumentBytes: FIXED_NATIVE_ROUND_LIMITS.maxArgumentBytes,
      maxReplayBytes: FIXED_NATIVE_ROUND_LIMITS.maxRoundReplayBytes,
      resultTokenCap: options.maxToolResultTokens,
    };
  }

  /** Builds one generate request in the replay mode the provider needs. */
  private buildRoundRequest(
    history: IRoundHistory,
    request: IRoundRequest,
  ): { roundPrompt: string; roundOptions: IModelOptions } {
    if (request.nativeConversationEnabled) {
      return {
        roundPrompt: request.basePrompt,
        roundOptions: this.buildNativeRoundOptions(history, request),
      };
    }
    return {
      roundPrompt: this.buildLegacyRoundPrompt(
        request.basePrompt,
        history.transcript,
        request.maxRounds,
        request.isFinalRound,
      ),
      roundOptions: this.buildRoundOptions(request, { priorTurn: history.priorTurn, priorRound: history.priorRound }),
    };
  }

  /** Carries one executed round into the next request, in the replay mode the provider needs. */
  private recordRound(
    history: IRoundHistory,
    round: number,
    result: {
      executed: IExecutedRound;
      validated: Opt<IValidatedProviderRound, Reason.OptionalInput>;
      limits: INativeRoundLimits;
    },
    nativeConversationEnabled: boolean,
  ): void {
    const { executed, validated, limits } = result;
    for (const outcome of executed.outcomes) history.consumedIds.add(outcome.toolUseId);
    if (nativeConversationEnabled) {
      if (validated !== undefined) history.nativeRounds.push(buildToolRound(validated, executed.outcomes, limits));
      else if (executed.lastTurn) history.nativeTurns.push(executed.lastTurn);
    } else if (validated !== undefined) {
      // Age the superseded round into the transcript, tagged with its real round.
      if (history.priorRound !== undefined) {
        history.transcript += this.buildRoundTranscript(history.priorRound, history.priorRoundNumber);
      }
      history.priorRound = buildToolRound(validated, executed.outcomes, limits);
      history.priorRoundNumber = round;
    } else {
      history.transcript += executed.transcript;
      // Age the superseded priorTurn into the transcript, tagged with its real round.
      if (history.priorTurn !== undefined) {
        history.transcript += this.buildTranscriptBlock(
          history.priorTurnTool,
          history.priorTurnRound,
          String(history.priorTurn.toolResultContent),
        );
      }
      history.priorTurn = executed.lastTurn;
      history.priorTurnTool = executed.lastTool;
      history.priorTurnRound = round;
    }
  }

  /** Transcript blocks for every result of a superseded grouped round. */
  private buildRoundTranscript(round: IProviderToolRound, roundNumber: number): string {
    return round.calls
      .map((entry) => this.buildTranscriptBlock(entry.toolName, roundNumber, String(entry.toolResultContent)))
      .join("");
  }

  /** One provider call for the round. A final reply that fails its output schema gets one more attempt. */
  private async generateRound(
    roundPrompt: string,
    roundOptions: IModelOptions,
    isFinalRound: boolean,
  ): Promise<IGenerateResult> {
    try {
      return await this.deps.generate(roundPrompt, roundOptions);
    } catch (error) {
      if (!isFinalRound || !(error instanceof ProviderProtocolError)) throw error;
      return await this.deps.generate(roundPrompt, roundOptions);
    }
  }

  private buildLegacyRoundPrompt(
    basePrompt: string,
    transcript: string,
    maxRounds: number,
    isFinalRound: boolean,
  ): string {
    if (!(maxRounds > 1)) return basePrompt;
    const roundPrompt: string = basePrompt + transcript;
    if (isFinalRound) return `${roundPrompt}\n\n${PLANNING_TOOLS_FINAL_ROUND_INSTRUCTION}`;
    return transcript.length === 0 ? `${roundPrompt}\n\n${PLANNING_TOOLS_EXPLORE_ROUND_INSTRUCTION}` : roundPrompt;
  }

  private finalStopReason(response: IGenerateResult, guardrailForced: boolean): PlanningToolLoopStopReason {
    if (response.content.trim().length === 0) return PlanningToolLoopStopReason.EMPTY_FINAL;
    return guardrailForced ? PlanningToolLoopStopReason.GUARDRAIL_BLOCKED : PlanningToolLoopStopReason.ROUND_CAP;
  }

  /** Runs one round's calls up to the per-round cap: one becomes the next priorTurn — the
   *  signed one (Gemini annotates only the first call of a parallel batch), else the last;
   *  the others return as transcript blocks so their results are never lost. */
  private async executeRoundCalls(
    calls: IProviderToolCall[],
    options: IPlanningToolLoopOptions,
    round: number,
    progress: ILoopProgress,
    identity: { provider: string; model: string },
  ): Promise<IExecutedRound> {
    const outcomes: IRoundOutcome[] = [];
    const signedIndex = calls.findIndex((call) => call.thoughtSignature !== undefined);
    const replayIndex = signedIndex === -1 ? calls.length - 1 : signedIndex;
    let transcript = "";
    let guardrailBlocked = false;
    let lastTurn: Opt<IProviderTurn, Reason.OptionalInput> = undefined;
    let lastTool = "";
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const withinCap = i < options.maxToolCallsPerRound;
      const executes = withinCap && call.rawArguments === undefined;
      const outcome = executes
        ? await this.executeCall(call, options, round, { ...identity, modelCallId: call.id })
        : this.refuseCall(
          call,
          round,
          options,
          withinCap ? INVALID_TOOL_ARGUMENTS_MESSAGE : TOOL_CALL_LIMIT_MESSAGE,
        );
      if (executes) progress.toolCalls++;
      guardrailBlocked ||= outcome.guardrailBlocked;
      outcomes.push({
        toolUseId: outcome.turn.toolUseId,
        toolResultContent: outcome.turn.toolResultContent,
        toolResultIsError: outcome.turn.toolResultIsError,
      });
      if (i === replayIndex) {
        lastTurn = outcome.turn;
        lastTool = call.name;
      } else {
        transcript += this.buildTranscriptBlock(call.name, round, String(outcome.turn.toolResultContent));
      }
    }
    return { lastTurn, lastTool, transcript, guardrailBlocked, outcomes };
  }

  private buildRoundOptions(
    request: IRoundRequest,
    replay: {
      priorTurn: Opt<IProviderTurn, Reason.OptionalInput>;
      priorRound: Opt<IProviderToolRound, Reason.OptionalInput>;
    },
  ): IModelOptions {
    const withCallSite: IModelOptions = {
      ...request.baseOptions,
      jsonSchema: request.isFinalRound ? request.baseOptions.jsonSchema : undefined,
      ...(request.callSite ? { callSite: request.callSite } : {}),
    };
    if (request.maxRounds === 1) return withCallSite;
    const toolChoice: IToolChoice = request.isFinalRound
      ? { type: TOOL_CHOICE_TYPE_NONE }
      : autoToolChoice(request.parallelMode);
    return {
      ...withCallSite,
      tools: request.allowedToolDefs,
      toolChoice,
      ...(replay.priorTurn ? { priorTurn: replay.priorTurn } : {}),
      ...(replay.priorRound ? { priorRound: replay.priorRound } : {}),
    };
  }

  /** The prompt stays frozen every round — control lives in nativeConversation.roundInstruction. */
  private buildNativeRoundOptions(history: IRoundHistory, request: IRoundRequest): IModelOptions {
    const withCallSite: IModelOptions = {
      ...request.baseOptions,
      jsonSchema: request.isFinalRound ? request.baseOptions.jsonSchema : undefined,
      ...(request.callSite ? { callSite: request.callSite } : {}),
    };
    const hasHistory = history.nativeTurns.length > 0 || history.nativeRounds.length > 0;
    const roundInstruction = request.isFinalRound
      ? PLANNING_TOOLS_FINAL_ROUND_INSTRUCTION
      : hasHistory
      ? PLANNING_TOOLS_CONTINUE_ROUND_INSTRUCTION
      : PLANNING_TOOLS_EXPLORE_ROUND_INSTRUCTION;
    const roundFields = roundInstruction ? { roundInstruction } : {};
    const initialPrompt = request.basePrompt;
    return {
      ...withCallSite,
      ...(request.isFinalRound ? { toolChoice: { type: TOOL_CHOICE_TYPE_NONE } } : {
        tools: request.allowedToolDefs,
        toolChoice: autoToolChoice(request.parallelMode),
      }),
      nativeConversation: request.groupedRounds
        ? { initialPrompt, turns: [], rounds: [...history.nativeRounds], ...roundFields }
        : { initialPrompt, turns: [...history.nativeTurns], ...roundFields },
    };
  }

  /** Measures this round's real input tokens and aborts BEFORE issuing the call if they exceed
   *  the caller's budget. A no-op without a native conversation or a replayed round, or without
   *  measureInputTokens. */
  private async preflightBudget(
    roundPrompt: string,
    roundOptions: IModelOptions,
    budget: IPromptBudget,
    traceId: string,
  ): Promise<void> {
    if (!roundOptions.nativeConversation && !roundOptions.priorRound) return;
    if (!this.deps.measureInputTokens) return;
    const measured: INativeInputMeasurement = await this.deps.measureInputTokens(roundPrompt, roundOptions);
    const inputLimit = Math.max(0, budget.totalBudgetTokens - budget.safetyBufferTokens);
    const sectionOverflow = Object.entries(measured.sections).some(([section, count]) =>
      count > budget.sections[section as keyof typeof budget.sections]
    );
    if (measured.totalTokens <= inputLimit && !sectionOverflow) return;
    void this.deps.logger?.warn(DomainEventType.ContextBudgetExceeded, this.deps.modelId, {
      model: this.deps.modelId,
      section_counts: measured.sections,
      limit: inputLimit,
      input_tokens: measured.totalTokens,
      token_source: measured.tokenSource,
    }, traceId);
    throw new ContextBudgetExceededError(
      "Planning tool loop's native conversation exceeds its allocated prompt budget",
      this.deps.modelId,
      inputLimit,
      measured.totalTokens,
      { ...measured.sections },
    );
  }

  private async executeCall(
    call: IProviderToolCall,
    options: IPlanningToolLoopOptions,
    round: number,
    identity: { provider: string; model: string; modelCallId?: string },
  ): Promise<{ turn: IProviderTurn; guardrailBlocked: boolean }> {
    const canonical = canonicalizeForRegistry(this.deps.toolRegistry, call.name, call.input);
    this.logAliasRewrite(canonical, options.traceId, identity);
    const canonicalCall: IProviderToolCall = { ...call, name: canonical.name, input: canonical.params };
    let execResult: IToolResult;
    let guardrailBlocked = false;

    if (!options.allowedTools.has(canonicalCall.name)) {
      execResult = { success: false, error: `Tool '${canonicalCall.name}' is not in the planning catalog` };
    } else {
      const enrichedParams = enrichPortalPathParam(canonicalCall.name, canonicalCall.input, options.portalAlias);
      const confinementError = escapesSearchRoot(canonicalCall.name, enrichedParams)
        ? CONFINEMENT_DENIED_MESSAGE
        : await this.assertWithinPortal(enrichedParams, options.portalAlias, options.portalRoot);
      if (confinementError) {
        this.logSecurityDenied(canonicalCall.name, enrichedParams, confinementError, options.traceId);
        execResult = { success: false, error: confinementError };
      } else {
        try {
          execResult = await this.deps.toolRegistry.execute(canonicalCall.name, enrichedParams);
        } catch (error) {
          execResult = { success: false, error: error instanceof Error ? error.message : String(error) };
        }
        if (this.deps.guardrailRunner) {
          const resultText = JSON.stringify(execResult.data ?? execResult.error ?? {});
          await this.deps.guardrailRunner.screen(resultText, options.traceId, round);
          if (this.deps.guardrailRunner.hasBlockingViolation(options.traceId)) {
            execResult = { success: false, error: GUARDRAIL_BLOCKED_MESSAGE };
            guardrailBlocked = true;
          }
        }
      }
    }

    const built = buildPriorTurn(call, execResult);
    const cappedContent = await this.capToTokenLimit(String(built.toolResultContent), options.maxToolResultTokens);
    const turn: IProviderTurn = { ...built, toolResultContent: cappedContent };
    this.logDynamicToolCall(canonicalCall.name, canonicalCall.input, cappedContent, round, options.traceId);
    return { turn, guardrailBlocked };
  }

  private logAliasRewrite(
    call: ReturnType<typeof canonicalizeForRegistry>,
    traceId: string,
    identity: { provider: string; model: string; modelCallId?: string },
  ): void {
    if (!call.rewritten || !this.logger) return;
    const payload: IToolAliasRewrittenPayload = {
      requestedName: call.requestedName,
      canonicalName: call.name,
      renamedParams: [...call.renamedParams],
      droppedParams: [...call.droppedParams],
      entryPoint: ToolCallEntryPoint.PLANNING_LOOP,
      provider: identity.provider,
      model: identity.model,
      ...(identity.modelCallId ? { modelCallId: identity.modelCallId } : {}),
    };
    void this.logger.info(DomainEventType.ToolAliasRewritten, call.name, { ...payload }, traceId);
  }

  /** Answers a call past the per-round cap with an error result without executing it. */
  private refuseCall(
    call: IProviderToolCall,
    round: number,
    options: IPlanningToolLoopOptions,
    message: string,
  ): { turn: IProviderTurn; guardrailBlocked: boolean } {
    const turn = buildPriorTurn(call, { success: false, error: message });
    this.logDynamicToolCall(call.name, call.input, String(turn.toolResultContent), round, options.traceId);
    return { turn, guardrailBlocked: false };
  }

  /** Confines every CONFINED_PARAM_NAMES string param to portalRoot. Returns an error
   *  message when rejected, undefined when confined. Never throws. */
  private async assertWithinPortal(
    params: Record<string, JSONValue>,
    portalAlias: string,
    portalRoot: string,
  ): Promise<Opt<string, Reason.OptionalInput>> {
    const root = resolve(portalRoot);
    for (const key of CONFINED_PARAM_NAMES) {
      const value = params[key];
      if (typeof value !== "string" || value.length === 0) continue;
      if (value.startsWith("/")) return CONFINEMENT_DENIED_MESSAGE;

      let relativePath = value;
      if (value.startsWith("@")) {
        const slashIndex = value.indexOf("/");
        const alias = slashIndex === -1 ? value.slice(1) : value.slice(1, slashIndex);
        if (alias !== portalAlias) return CONFINEMENT_DENIED_MESSAGE;
        relativePath = slashIndex === -1 ? "" : value.slice(slashIndex + 1);
      }

      try {
        const resolved = await PathSecurity.resolveWithinRoots(relativePath, [root], root);
        if (resolved !== root && !resolved.startsWith(root + SEPARATOR)) return CONFINEMENT_DENIED_MESSAGE;
      } catch {
        // Fail closed: any resolution failure (traversal, access, or an unexpected OS error)
        // denies the call rather than crashing the loop.
        return CONFINEMENT_DENIED_MESSAGE;
      }
    }
    return undefined;
  }

  /** tokenizer.countTokens, but never throws: an unrecognized model id must not crash a
   *  bounding utility — falls back to the same chars-per-token heuristic used elsewhere. */
  private async safeCountTokens(text: string): Promise<number> {
    try {
      return await this.deps.tokenizer.countTokens(text, this.deps.modelId);
    } catch {
      return Math.ceil(text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
    }
  }

  /** Truncates (never drops) text exceeding maxTokens, appending a marker so the model
   *  knows content was cut rather than the tool call failing or the file ending there. */
  private async capToTokenLimit(text: string, maxTokens: number): Promise<string> {
    if (await this.safeCountTokens(text) <= maxTokens) return text;
    const prefix = await tokenBoundedPrefix(text, maxTokens, (t) => this.safeCountTokens(t));
    return prefix + PLANNING_TOOL_RESULT_TRUNCATED_SUFFIX;
  }

  private buildTranscriptBlock(toolName: string, round: number, content: string): string {
    return `\n<${PLANNING_TOOL_RESULT_TAG} tool="${toolName}" round="${round}">\n${content}\n</${PLANNING_TOOL_RESULT_TAG}>\n`;
  }

  private logDynamicToolCall(
    tool: string,
    args: Record<string, JSONValue>,
    resultSummary: string,
    iteration: number,
    traceId: string,
  ): void {
    if (!this.logger) return;
    void this.logger.info(
      DomainEventType.AgentDynamicToolCall,
      PLANNING_LOG_PHASE,
      {
        tool,
        args,
        resultSummary: resultSummary.slice(0, REACT_TOOL_RESULT_SUMMARY_MAX),
        iteration,
        phase: PLANNING_LOG_PHASE,
      },
      traceId,
    );
  }

  private logSecurityDenied(
    tool: string,
    params: Record<string, JSONValue>,
    error: string,
    traceId: string,
  ): void {
    if (!this.logger) return;
    void this.logger.warn(
      DomainEventType.SecurityPathAccessDenied,
      tool,
      { tool, params, error },
      traceId,
    );
  }

  private logLoopAborted(payload: IPlanningToolLoopAbortedPayload, traceId: string): void {
    if (!this.logger) return;
    void this.logger.warn(DomainEventType.PlanningToolLoopAborted, PLANNING_LOG_PHASE, { ...payload }, traceId);
  }

  private logLoopCompleted(payload: IPlanningToolLoopCompletedPayload, traceId: string): void {
    if (!this.logger) return;
    void this.logger.info(DomainEventType.PlanningToolLoopCompleted, PLANNING_LOG_PHASE, { ...payload }, traceId);
  }

  private finish(
    result: Omit<IPlanningToolLoopResult, "final"> & { response: IGenerateResult },
    traceId: string,
  ): IPlanningToolLoopResult {
    const { response, ...rest } = result;
    this.logLoopCompleted(rest, traceId);
    return { final: response, ...rest };
  }
}
