/**
 * @module NativeToolTurns
 * @path packages/execution/src/native_tool_turns.ts
 * @description Pure, provider-agnostic transformations for native-tool loops: mapping
 * ToolRegistry's ITool[] to provider IToolDefinition[], building the replay IProviderTurn
 * from a completed tool call, prefixing a portal-relative path param with its `@alias/`,
 * and resolving whether a provider id supports native tool-calling. Shared by
 * ReActLoopStrategy (execution loop) and PlanningToolLoop (planning loop) so the two
 * native-tool loops never drift.
 * @architectural-layer Services
 * @related-files ["packages/execution/src/strategies/react_loop_strategy.ts", "packages/execution/src/planning_tool_loop.ts"]
 */

import { NATIVE_TOOL_USE_BLOCK_TYPE } from "@exaix/ai/types.ts";
import type {
  IProviderAssistantReplay,
  IProviderToolResultEntry,
  IProviderToolRound,
  IProviderTurn,
  IToolDefinition,
  IValidatedProviderRound,
  IValidatedRoundCall,
  JSONObject,
  OpenAiFamilyReplayProvider,
} from "@exaix/ai/types.ts";
import type { IGenerateResult, IProviderToolCall } from "@exaix/ai/providers";
import { ProviderProtocolError } from "@exaix/ai/errors.ts";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import type { ITool, IToolResult, JSONValue } from "@exaix/core/types";
import { ProviderType, ToolName } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { INativeRoundLimits } from "@exaix/ai/native_round_limits.ts";

/** One tool result, identified by the call id it answers. */
export interface IRoundOutcome {
  toolUseId: string;
  toolResultContent: string | readonly JSONObject[];
  toolResultIsError: boolean;
}

/** Maps ToolRegistry's ITool[] to provider-agnostic IToolDefinition[]. Pure transformation
 *  — no I/O, no side effects. */
export function buildNativeToolDefinitions(tools: ITool[]): IToolDefinition[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.nativeDescription ?? t.description,
    inputSchema: t.parameters as never,
  }));
}

/** Builds an IProviderTurn from a completed tool call and its result, forwarding every
 *  provider reasoning artifact (thoughtSignature/thinkingBlocks/reasoningContent) verbatim
 *  so the provider can replay it on the next turn. Pure transformation — no I/O. */
export function buildPriorTurn(toolCall: IProviderToolCall, result: IToolResult): IProviderTurn {
  return {
    toolUseId: toolCall.id,
    toolName: toolCall.name,
    toolInput: toolCall.input,
    toolResultContent: JSON.stringify(result.data ?? result.error ?? {}),
    toolResultIsError: !result.success,
    ...(toolCall.thoughtSignature !== undefined ? { thoughtSignature: toolCall.thoughtSignature } : {}),
    ...(toolCall.thinkingBlocks !== undefined ? { thinkingBlocks: toolCall.thinkingBlocks } : {}),
    ...(toolCall.reasoningContent !== undefined ? { reasoningContent: toolCall.reasoningContent } : {}),
    ...(toolCall.responseItems !== undefined ? { responseItems: toolCall.responseItems } : {}),
  };
}

/** Prefixes a tool call's `path` param with `@<portalAlias>/` when it isn't already
 *  alias-prefixed. Filesystem tools use a portal alias; `get_module_dependencies`'s cached
 *  graph edges use portal-relative paths and are exempt. Pure transformation — no I/O. */
export function enrichPortalPathParam(
  toolName: string,
  params: Record<string, JSONValue>,
  portalAlias: Opt<string, Reason.OptionalContext>,
): Record<string, JSONValue> {
  const enriched = { ...params };
  if (
    toolName !== ToolName.GET_MODULE_DEPENDENCIES &&
    portalAlias && enriched.path &&
    typeof enriched.path === "string" &&
    !enriched.path.startsWith("@")
  ) {
    enriched.path = `@${portalAlias}/${enriched.path}`;
  }
  return enriched;
}

/** Resolves whether a provider id supports native tool-calling, falling back from a
 *  composite `"<type>-<model>"` id to its bare-type prefix. Never throws. */
export function providerSupportsNativeTools(providerId: Opt<string, Reason.OptionalContext>): boolean {
  return ProviderRegistry.getMetadataForInstance(providerId)?.supportsNativeTools === true;
}

/** True when a provider accepts a complete invocation-local conversation snapshot. */
export function providerSupportsNativeConversation(providerId: Opt<string, Reason.OptionalContext>): boolean {
  return ProviderRegistry.getMetadataForInstance(providerId)?.supportsNativeConversation === true;
}

/** True when a provider replays a whole completed round (every assistant part and result). */
export function providerSupportsParallelToolReplay(providerId: Opt<string, Reason.OptionalContext>): boolean {
  return ProviderRegistry.getMetadataForInstance(providerId)?.supportsParallelToolReplay === true;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** The functionCall object of a Gemini-shaped part, or undefined for any other part. */
function functionCallOf(part: JSONObject): JSONObject | undefined {
  const call = part.functionCall;
  return typeof call === "object" && call !== null && !Array.isArray(call) ? call : undefined;
}

const MISMATCHED_ASSISTANT_PARTS_MESSAGE = "Tool round assistant parts do not match its calls";
/** The error result a call receives when the round policy cap has no slot for it. */
export const TOOL_CALL_LIMIT_MESSAGE = "tool call limit reached for this round; call skipped";
const CALL_CEILING_MESSAGE = "Tool round exceeds the accepted call ceiling";
const ARGUMENT_CEILING_MESSAGE = "Tool call arguments exceed the byte ceiling";

/** Validates one call's id, name and argument bytes. A non-object input is refused per call. */
function validateCallEntry(
  call: IProviderToolCall,
  index: number,
  seenIds: Set<string>,
  limits: INativeRoundLimits,
  provider: string,
): IValidatedRoundCall {
  if (call.id.trim() === "") throw new ProviderProtocolError("Tool call id is empty", provider);
  if (call.name.trim() === "") throw new ProviderProtocolError("Tool call name is empty", provider);
  if (seenIds.has(call.id)) throw new ProviderProtocolError("Tool call id is duplicated in the round", provider);
  seenIds.add(call.id);
  if (utf8Bytes(JSON.stringify(call.input) ?? "") > limits.maxArgumentBytes) {
    throw new ProviderProtocolError(ARGUMENT_CEILING_MESSAGE, provider);
  }
  const isObject = typeof call.input === "object" && call.input !== null && !Array.isArray(call.input);
  return isObject && call.rawArguments === undefined
    ? { id: call.id, index, originalCall: call, executionInput: call.input }
    : { id: call.id, index, originalCall: call, validationError: "invalid_arguments" };
}

/** Gemini pairs each functionCall part with the call in the same order.
 *  Name, arguments and sibling signature must match, or the replay would invent content. */
function googleCallsMatchParts(calls: readonly IProviderToolCall[], parts: readonly JSONObject[]): boolean {
  const functionParts = parts.filter((part) => functionCallOf(part) !== undefined);
  if (functionParts.length !== calls.length) return false;
  return calls.every((call, index) => {
    const part = functionParts[index];
    const functionCall = functionCallOf(part);
    return functionCall?.name === call.name &&
      JSON.stringify(functionCall?.args) === JSON.stringify(call.input) &&
      (part.thoughtSignature ?? undefined) === call.thoughtSignature;
  });
}

/** Anthropic pairs each tool_use block with the call in the same order. Id, name and input must match. */
function anthropicCallsMatchBlocks(calls: readonly IProviderToolCall[], blocks: readonly JSONObject[]): boolean {
  const toolUses = blocks.filter((block) => block.type === NATIVE_TOOL_USE_BLOCK_TYPE);
  if (toolUses.length !== calls.length) return false;
  return calls.every((call, index) => {
    const block = toolUses[index];
    return block.id === call.id && block.name === call.name &&
      JSON.stringify(block.input) === JSON.stringify(call.input);
  });
}

/** Refuses a round whose calls do not match the replayed assistant content of the same response. */
function assertCallsMatchReplay(
  calls: readonly IProviderToolCall[],
  replay: IProviderAssistantReplay,
  provider: string,
): void {
  // An OpenAI-family round reads its calls from this carrier, so there is no second list to match.
  if (isOpenAiFamilyReplay(replay)) return;
  const matched = replay.provider === "google"
    ? googleCallsMatchParts(calls, replay.parts)
    : anthropicCallsMatchBlocks(calls, replay.blocks);
  if (!matched) throw new ProviderProtocolError(MISMATCHED_ASSISTANT_PARTS_MESSAGE, provider);
}

/** Reads one OpenAI-family tool_calls entry. Arguments that are not a JSON object keep their text
 *  in rawArguments. The call is then refused on its own, with its id and name intact. */
function openAiCarrierCall(raw: JSONObject): IProviderToolCall {
  const fn = typeof raw.function === "object" && raw.function !== null && !Array.isArray(raw.function)
    ? raw.function
    : {};
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof fn.name === "string" ? fn.name : "";
  const text = typeof fn.arguments === "string" ? fn.arguments : "";
  try {
    const parsed: JSONValue = JSON.parse(text);
    const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    if (isObject) return { id, name, input: parsed as Record<string, JSONValue> };
  } catch {
    // Malformed JSON is refused below, with the original text.
  }
  return { id, name, input: {}, rawArguments: text };
}

/** The calls of one round, from the source that can replay them. OpenAI-family calls come from
 *  their carrier, so a call the extractor could not read is still present and refused. */
function roundCalls(result: IGenerateResult): IProviderToolCall[] {
  const replay = result.nativeAssistantReplay;
  if (replay !== undefined && isOpenAiFamilyReplay(replay)) return replay.toolCalls.map(openAiCarrierCall);
  return result.toolCalls ?? [];
}

/** Number of calls a grouped round carries, read from the same source the round is validated from. */
export function providerRoundCallCount(result: IGenerateResult): number {
  return roundCalls(result).length;
}

function isOpenAiFamilyReplay(replay: IProviderAssistantReplay): replay is Extract<
  IProviderAssistantReplay,
  { provider: OpenAiFamilyReplayProvider }
> {
  return replay.provider === ProviderType.OPENAI || replay.provider === ProviderType.OPENROUTER ||
    replay.provider === ProviderType.OPENAI_CHAT;
}

/** The replay content a byte ceiling measures. OpenAI-family carriers count in full. */
function replayPayload(replay: IProviderAssistantReplay): readonly JSONObject[] | IProviderAssistantReplay {
  if (replay.provider === "google") return replay.parts;
  if (replay.provider === "anthropic") return replay.blocks;
  return replay;
}

/** Refuses a response over the call ceiling, or an argument over the byte ceiling, before any call executes.
 *  Used where no grouped validation runs. */
export function assertRoundWithinBounds(
  calls: readonly IProviderToolCall[],
  limits: INativeRoundLimits,
  provider: string,
): void {
  if (calls.length > limits.maxResponseCalls) throw new ProviderProtocolError(CALL_CEILING_MESSAGE, provider);
  for (const call of calls) {
    if (utf8Bytes(JSON.stringify(call.input) ?? "") > limits.maxArgumentBytes) {
      throw new ProviderProtocolError(ARGUMENT_CEILING_MESSAGE, provider);
    }
  }
}

/** Validates one provider response before any tool effect. Throws a protocol error when the round
 *  cannot be replayed exactly. An input that is not a JSON object is refused per call instead. */
export function validateProviderRound(result: IGenerateResult, limits: INativeRoundLimits): IValidatedProviderRound {
  const provider = result.provider;
  const calls = roundCalls(result);
  if (calls.length === 0) throw new ProviderProtocolError("Tool round has no calls", provider);
  if (calls.length > limits.maxResponseCalls) throw new ProviderProtocolError(CALL_CEILING_MESSAGE, provider);
  const replay = result.nativeAssistantReplay;
  if (replay === undefined) throw new ProviderProtocolError("Tool round has no replayable assistant content", provider);
  if (utf8Bytes(JSON.stringify(replayPayload(replay))) > limits.maxRoundReplayBytes) {
    throw new ProviderProtocolError("Tool round assistant content exceeds the replay ceiling", provider);
  }
  const seenIds = new Set<string>();
  const validated = calls.map((call, index) => validateCallEntry(call, index, seenIds, limits, provider));
  assertCallsMatchReplay(calls, replay, provider);
  return { calls: validated, assistant: replay };
}

/** Joins each validated call to exactly one outcome by id. Missing, extra or duplicate outcomes
 *  are invariant errors, never an index-based guess. */
export function buildToolRound(round: IValidatedProviderRound, outcomes: readonly IRoundOutcome[]): IProviderToolRound {
  if (round.calls.length === 0) throw new Error("A tool round with no calls cannot be built");
  const byId = new Map<string, IRoundOutcome>();
  for (const outcome of outcomes) {
    if (byId.has(outcome.toolUseId)) throw new Error(`Duplicate outcome for tool call ${outcome.toolUseId}`);
    byId.set(outcome.toolUseId, outcome);
  }
  const requested = new Set(round.calls.map((call) => call.id));
  for (const id of byId.keys()) {
    if (!requested.has(id)) throw new Error(`Outcome for an unrequested tool call ${id}`);
  }
  const calls: IProviderToolResultEntry[] = round.calls.map((call) => {
    const outcome = byId.get(call.id);
    if (outcome === undefined) throw new Error(`Missing outcome for tool call ${call.id}`);
    const signature = call.originalCall.thoughtSignature;
    return {
      toolUseId: call.id,
      index: call.index,
      toolName: call.originalCall.name,
      toolInput: call.originalCall.input,
      ...(signature !== undefined ? { thoughtSignature: signature } : {}),
      toolResultContent: outcome.toolResultContent,
      toolResultIsError: outcome.toolResultIsError,
    };
  });
  return { calls, assistant: round.assistant };
}
