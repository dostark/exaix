/**
 * @module PlanningToolLoop
 * @path packages/execution/src/planning_tool_loop.ts
 * @description Bounded, read-only native-tool loop for the planning LLM call (Phase 199).
 * Given a base prompt and a portal-rooted read-only IToolRegistry, runs exploration rounds
 * (toolChoice auto, parallel disabled) followed by a mandatory tool-less final round
 * (toolChoice none), carrying every tool result forward — the most recent as IProviderTurn,
 * earlier ones as capped transcript blocks. Confines every tool path to the request portal
 * and screens tool results through an optional IGuardrailRunner before they reach the model.
 * @architectural-layer Services
 * @related-files ["packages/execution/src/agent_runner.ts", "packages/execution/src/native_tool_turns.ts", "packages/execution/src/strategies/react_loop_strategy.ts"]
 */

import { resolve, SEPARATOR } from "@std/path";
import type { IModelOptions, IProviderTurn, IToolChoice, IToolDefinition } from "@exaix/ai/types.ts";
import { TOOL_CHOICE_TYPE_AUTO, TOOL_CHOICE_TYPE_NONE } from "@exaix/ai/types.ts";
import type { IGenerateResult, IProviderToolCall } from "@exaix/ai/providers";
import type { ICallSite } from "@exaix/ai/types.ts";
import type { IEventLogger } from "@exaix/core/logger";
import type { ITokenizer } from "@exaix/core/func";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import {
  DomainEventType,
  type IPlanningToolLoopAbortedPayload,
  type IPlanningToolLoopCompletedPayload,
} from "@exaix/core/events";
import {
  PLANNING_TOOL_RESULT_TAG,
  PLANNING_TOOL_RESULT_TRUNCATED_SUFFIX,
  PLANNING_TOOLS_FINAL_ROUND_INSTRUCTION,
  PLANNING_TOOLS_UNTRUSTED_DATA_NOTICE,
  PlanningToolLoopStopReason,
  REACT_TOOL_RESULT_SUMMARY_MAX,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import { PathSecurity } from "@exaix/tool-runtime";
import type { IGuardrailRunner } from "./guardrail_runner.ts";
import { buildNativeToolDefinitions, buildPriorTurn, enrichPortalPathParam } from "./native_tool_turns.ts";
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
  /** Calls executed per round; the rest are answered with an error result. */
  maxToolCallsPerRound: number;
  traceId: string;
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

/** Tool call parameter names the confinement guard checks — every string value under these
 *  keys must resolve inside the request portal before the tool call reaches ToolRegistry.
 *  `file_path` is the alias ToolRegistry accepts in place of `path`. */
const CONFINED_PARAM_NAMES = ["path", "file_path", "repo_path", "from", "file"] as const;

const CONFINEMENT_DENIED_MESSAGE = "Access denied: path is outside the request portal";
const GUARDRAIL_BLOCKED_MESSAGE = "blocked by guardrail";
/** Journal target and `phase` payload value that mark planning-call tool rows. */
const PLANNING_LOG_PHASE = "planning";
const TOOL_CALL_LIMIT_MESSAGE = "tool call limit reached for this round; call skipped";

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
    const allowedToolDefs = buildAllowedToolDefinitions(this.deps.toolRegistry.getTools(), options.allowedTools);
    const basePrompt = options.maxRounds === 1
      ? options.prompt
      : `${options.prompt}\n\n${PLANNING_TOOLS_UNTRUSTED_DATA_NOTICE}`;

    let transcript = "";
    let priorTurn: Opt<IProviderTurn, Reason.OptionalInput> = undefined;
    let priorTurnTool = "";
    let priorTurnRound = 0;
    let finalRoundIndex = options.maxRounds;
    let guardrailForced = false;

    for (let round = 1; round <= finalRoundIndex; round++) {
      progress.rounds = round;
      const isFinalRound = round === finalRoundIndex;
      const callSite = options.nextCallSite();
      let roundPrompt = basePrompt;
      if (options.maxRounds > 1) {
        roundPrompt += transcript;
        if (isFinalRound) roundPrompt += `\n\n${PLANNING_TOOLS_FINAL_ROUND_INSTRUCTION}`;
      }
      const roundOptions = this.buildRoundOptions(
        options.baseOptions,
        allowedToolDefs,
        priorTurn,
        isFinalRound,
        options.maxRounds,
        callSite,
      );

      const response = await this.deps.generate(roundPrompt, roundOptions);
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

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return this.finish({
          response,
          rounds: round,
          toolCalls: progress.toolCalls,
          stopReason: PlanningToolLoopStopReason.NO_TOOL_CALLS,
          promptTokens: progress.promptTokens,
          completionTokens: progress.completionTokens,
        }, options.traceId);
      }

      const executed = await this.executeRoundCalls(response.toolCalls, options, round, progress);
      transcript += executed.transcript;

      // A prior round's priorTurn is about to be superseded by this round's — age it into
      // the transcript (tagged with the round it actually came from) so it is not lost.
      if (priorTurn !== undefined) {
        transcript += this.buildTranscriptBlock(priorTurnTool, priorTurnRound, String(priorTurn.toolResultContent));
      }
      priorTurn = executed.lastTurn;
      priorTurnTool = executed.lastTool;
      priorTurnRound = round;

      if (executed.guardrailBlocked) {
        guardrailForced = true;
        finalRoundIndex = Math.min(finalRoundIndex, round + 1);
      }
    }

    // Unreachable: the loop always returns from inside the for-body (isFinalRound is always
    // hit by round === finalRoundIndex, since finalRoundIndex only ever shrinks toward round+1).
    throw new Error("PlanningToolLoop.run: exited without a final response");
  }

  private finalStopReason(response: IGenerateResult, guardrailForced: boolean): PlanningToolLoopStopReason {
    if (response.content.trim().length === 0) return PlanningToolLoopStopReason.EMPTY_FINAL;
    return guardrailForced ? PlanningToolLoopStopReason.GUARDRAIL_BLOCKED : PlanningToolLoopStopReason.ROUND_CAP;
  }

  /** Runs one round's calls up to the per-round cap. The last call becomes the next priorTurn;
   *  earlier ones are returned as transcript blocks so their results are not lost. */
  private async executeRoundCalls(
    calls: IProviderToolCall[],
    options: IPlanningToolLoopOptions,
    round: number,
    progress: ILoopProgress,
  ): Promise<{
    lastTurn: Opt<IProviderTurn, Reason.OptionalInput>;
    lastTool: string;
    transcript: string;
    guardrailBlocked: boolean;
  }> {
    let transcript = "";
    let guardrailBlocked = false;
    let lastTurn: Opt<IProviderTurn, Reason.OptionalInput> = undefined;
    let lastTool = "";
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const withinCap = i < options.maxToolCallsPerRound;
      const outcome = withinCap ? await this.executeCall(call, options, round) : this.refuseCall(call, round, options);
      if (withinCap) progress.toolCalls++;
      guardrailBlocked ||= outcome.guardrailBlocked;
      if (i === calls.length - 1) {
        lastTurn = outcome.turn;
        lastTool = call.name;
      } else {
        transcript += this.buildTranscriptBlock(call.name, round, String(outcome.turn.toolResultContent));
      }
    }
    return { lastTurn, lastTool, transcript, guardrailBlocked };
  }

  private buildRoundOptions(
    base: IModelOptions,
    toolDefs: IToolDefinition[],
    priorTurn: Opt<IProviderTurn, Reason.OptionalInput>,
    isFinalRound: boolean,
    maxRounds: number,
    callSite: Opt<ICallSite, Reason.TraceAbsent>,
  ): IModelOptions {
    const withCallSite: IModelOptions = { ...base, ...(callSite ? { callSite } : {}) };
    if (maxRounds === 1) return withCallSite;
    const toolChoice: IToolChoice = isFinalRound
      ? { type: TOOL_CHOICE_TYPE_NONE }
      : { type: TOOL_CHOICE_TYPE_AUTO, disable_parallel_tool_use: true };
    return {
      ...withCallSite,
      tools: toolDefs,
      toolChoice,
      ...(priorTurn ? { priorTurn } : {}),
    };
  }

  private async executeCall(
    call: IProviderToolCall,
    options: IPlanningToolLoopOptions,
    round: number,
  ): Promise<{ turn: IProviderTurn; guardrailBlocked: boolean }> {
    let execResult: IToolResult;
    let guardrailBlocked = false;

    if (!options.allowedTools.has(call.name)) {
      execResult = { success: false, error: `Tool '${call.name}' is not in the planning catalog` };
    } else {
      const enrichedParams = enrichPortalPathParam(call.name, call.input, options.portalAlias);
      const confinementError = await this.assertWithinPortal(enrichedParams, options.portalAlias, options.portalRoot);
      if (confinementError) {
        this.logSecurityDenied(call.name, enrichedParams, confinementError, options.traceId);
        execResult = { success: false, error: confinementError };
      } else {
        try {
          execResult = await this.deps.toolRegistry.execute(call.name, enrichedParams);
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
    this.logDynamicToolCall(call.name, call.input, cappedContent, round, options.traceId);
    return { turn, guardrailBlocked };
  }

  /** Answers a call past the per-round cap with an error result without executing it. */
  private refuseCall(
    call: IProviderToolCall,
    round: number,
    options: IPlanningToolLoopOptions,
  ): { turn: IProviderTurn; guardrailBlocked: boolean } {
    const turn = buildPriorTurn(call, { success: false, error: TOOL_CALL_LIMIT_MESSAGE });
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
