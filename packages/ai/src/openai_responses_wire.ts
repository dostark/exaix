/**
 * @module OpenAiResponsesWire
 * @path packages/ai/src/openai_responses_wire.ts
 * @description Wire shape of OpenAI's /v1/responses API for reasoning models that call tools. Chat Completions takes
 *   function tools on gpt-5.6+ and gpt-6 only with reasoning_effort "none", so a tool round on those models goes here.
 *   A completed round is replayed from the reply's output items, unchanged, so the reasoning items come back intact.
 * @architectural-layer AI
 * @related-files ["packages/ai/src/provider_common_utils.ts", "packages/ai-openai/src/openai_provider.ts"]
 */

import type { JSONValue } from "@exaix/core";
import { PROVIDER_OPENAI } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { ProviderProtocolError } from "./errors.ts";
import type { IProviderToolCall } from "./providers/common.ts";
import type {
  IModelOptions,
  IProviderAssistantReplay,
  IProviderToolRound,
  IProviderTurn,
  IToolChoice,
  IToolDefinition,
  JSONObject,
} from "./types.ts";
import {
  calculateCost,
  disablesParallelToolUse,
  isOpenAiReasoningModel,
  mapToolChoiceOpenAI,
  openAiReasoningEffort,
  stringifyOpenAiToolResultContent,
  type TokenMap,
} from "./provider_common_utils.ts";

/** One item of the Responses `input` array. A replayed output item keeps its own shape. */
export type ResponsesInputItem = JSONObject;

/** The Responses reply fields this module reads. `output` holds the items in their original order. */
export interface IResponsesResponse {
  model?: string;
  status?: string;
  error?: { message?: string } | null;
  output?: JSONObject[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
  };
}

/** One function tool in the Responses wire shape. Strict mode is off, because the tool schemas are not strict-mode schemas. */
export type ResponsesWireTool = {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, JSONValue>;
  strict: false;
};

/** The Responses `tool_choice`. A single named function uses the flat form. */
export type ResponsesWireToolChoice = "auto" | "none" | "required" | { type: "function"; name: string };

/** Asks for the encrypted reasoning items, so the next request can replay them without server-side state. */
const REASONING_ENCRYPTED_CONTENT = "reasoning.encrypted_content";
const FUNCTION_TOOL_TYPE = "function";
const RESPONSE_ITEM_FUNCTION_CALL = "function_call";
const RESPONSE_ITEM_MESSAGE = "message";
const RESPONSE_PART_OUTPUT_TEXT = "output_text";
const RESPONSE_STATUS_FAILED = "failed";
const INPUT_ROLE_USER = "user";
const INPUT_ITEM_FUNCTION_CALL_OUTPUT = "function_call_output";

/** Builds the POST body and headers for /v1/responses. The request keeps no server-side state, so reasoning is
 *  requested encrypted and replayed from the round. Reasoning models take no temperature, top_p or reasoning effort
 *  on the wire, because they reject them. The Responses API has no stop sequences, so none is sent. */
export function createOpenAIResponsesRequestInit(
  apiKey: Opt<string, Reason.OptionalInput>,
  model: string,
  prompt: string,
  options?: Opt<IModelOptions, Reason.OptionalInput>,
): RequestInit {
  const hasTools = Boolean(options?.tools?.length);
  const reasoningModel = isOpenAiReasoningModel(model);
  return {
    method: "POST",
    ...(options?.requestSignal ? { signal: options.requestSignal } : {}),
    headers: {
      "Content-Type": "application/json",
      // An absent or empty key means the endpoint needs no credential, so send no header.
      ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      input: responsesInput(prompt, options),
      tools: hasTools ? options?.tools?.map(mapToolDefinitionResponses) : undefined,
      tool_choice: hasTools && options?.toolChoice ? mapToolChoiceResponses(options.toolChoice) : undefined,
      parallel_tool_calls: hasTools && disablesParallelToolUse(options?.toolChoice) ? false : undefined,
      temperature: reasoningModel ? undefined : options?.temperature,
      top_p: reasoningModel ? undefined : options?.top_p,
      // The caller's tier applies here, clamped to high. Without a tier the API default applies.
      reasoning: reasoningModel && options?.effort !== undefined
        ? { effort: openAiReasoningEffort(options.effort) }
        : undefined,
      max_output_tokens: options?.max_tokens,
      store: false,
      include: [REASONING_ENCRYPTED_CONTENT],
    }),
  };
}

/** The calls of a Responses reply, in output order. A call whose arguments are not valid JSON is dropped, as on
 *  Chat Completions. Undefined when the reply has no calls. */
export function extractResponsesToolCalls(response: IResponsesResponse): IProviderToolCall[] | undefined {
  const calls: IProviderToolCall[] = [];
  for (const item of functionCallItems(response)) {
    const callId = textValue(item.call_id);
    const name = textValue(item.name);
    try {
      const input = JSON.parse(textValue(item.arguments)) as Record<string, JSONValue>;
      calls.push({ id: callId, name, input, type: FUNCTION_TOOL_TYPE, responseItems: response.output ?? [] });
    } catch {
      console.warn(
        `extractResponsesToolCalls: dropping tool call "${name}" (call_id=${callId}) - malformed arguments JSON`,
      );
    }
  }
  return calls.length > 0 ? calls : undefined;
}

/** The assistant text of a Responses reply: the output_text parts of its message items, in order. */
export function extractResponsesContent(response: IResponsesResponse): string {
  return (response.output ?? [])
    .filter((item) => item.type === RESPONSE_ITEM_MESSAGE)
    .flatMap(contentParts)
    .filter((part) => part.type === RESPONSE_PART_OUTPUT_TEXT)
    .map((part) => textValue(part.text))
    .join("");
}

/** The replayable content of a Responses reply that made calls. It keeps the text, the calls in chat shape for
 *  validation, and every output item verbatim. Undefined when the reply has no calls. */
export function extractResponsesAssistantReplay(response: IResponsesResponse): IProviderAssistantReplay | undefined {
  const calls = functionCallItems(response);
  if (calls.length === 0) return undefined;
  const text = extractResponsesContent(response);
  return {
    provider: PROVIDER_OPENAI,
    assistantContent: text === "" ? null : text,
    toolCalls: calls.map((item) => ({
      id: textValue(item.call_id),
      type: FUNCTION_TOOL_TYPE,
      function: { name: textValue(item.name), arguments: textValue(item.arguments) },
    })),
    responseItems: response.output ?? [],
  };
}

/** Token mapper for a Responses reply. Input and output tokens map to prompt and completion, and the reasoning share
 *  comes from the output details. */
export function tokenMapperResponses(
  model: string,
): (d: IResponsesResponse, providerId?: string) => TokenMap | undefined {
  return (d, providerId) => {
    if (!d.usage) return undefined;
    const totalTokens = d.usage.total_tokens ?? d.usage.input_tokens + d.usage.output_tokens;
    return {
      prompt_tokens: d.usage.input_tokens,
      completion_tokens: d.usage.output_tokens,
      total_tokens: totalTokens,
      model,
      cost_usd: providerId ? calculateCost(providerId, totalTokens) : undefined,
      reasoning_tokens: d.usage.output_tokens_details?.reasoning_tokens,
    };
  };
}

/** Refuses a reply the API marked failed, so the failure is not read as an empty answer. */
export function assertResponsesNotFailed(response: IResponsesResponse, providerId: string): void {
  if (response.status !== RESPONSE_STATUS_FAILED) return;
  throw new ProviderProtocolError(response.error?.message ?? "The Responses request failed", providerId);
}

function responseItemsOf(replay: IProviderAssistantReplay): readonly JSONObject[] | undefined {
  return "responseItems" in replay ? replay.responseItems : undefined;
}

/** The Responses `input` for one request. The leading user prompt comes first. A snapshot's completed rounds follow
 *  it, then the round instruction. A priorRound follows the prompt. */
function responsesInput(prompt: string, options?: Opt<IModelOptions, Reason.OptionalInput>): ResponsesInputItem[] {
  const snapshot = options?.nativeConversation;
  if (!snapshot) return [userItem(prompt), ...replayedHistory(options)];
  if (prompt !== snapshot.initialPrompt) {
    throw new Error("Native conversation prompt must match its immutable initialPrompt");
  }
  if (snapshot.rounds !== undefined && snapshot.turns.length > 0) {
    throw new Error("A native conversation snapshot cannot carry rounds and legacy turns together");
  }
  return [
    userItem(snapshot.initialPrompt),
    ...(snapshot.rounds ?? []).flatMap((round) => responsesRoundItems(round)),
    ...snapshot.turns.flatMap((turn) => responsesTurnItems(turn)),
    ...(snapshot.roundInstruction !== undefined ? [userItem(snapshot.roundInstruction)] : []),
  ];
}

/** The history after the prompt when there is no snapshot: a priorRound, else a priorTurn. */
function replayedHistory(options?: Opt<IModelOptions, Reason.OptionalInput>): ResponsesInputItem[] {
  if (options?.priorRound) return responsesRoundItems(options.priorRound);
  if (options?.priorTurn) return responsesTurnItems(options.priorTurn);
  return [];
}

/** The input items that replay one completed round: its output items verbatim, then one output per call. */
function responsesRoundItems(round: IProviderToolRound): ResponsesInputItem[] {
  const items = responseItemsOf(round.assistant);
  if (items === undefined) throw new Error("The Responses API can only replay a round from the Responses API");
  return [
    ...items,
    ...round.calls.map((call): ResponsesInputItem => ({
      type: INPUT_ITEM_FUNCTION_CALL_OUTPUT,
      call_id: call.toolUseId,
      output: stringifyOpenAiToolResultContent(call.toolResultContent),
    })),
  ];
}

/** The input items that replay one single-call turn: the reply's other items, its own call, and that call's output.
 *  The reply's other calls are dropped, because each one needs an output that this turn does not carry. */
function responsesTurnItems(turn: IProviderTurn): ResponsesInputItem[] {
  if (turn.responseItems === undefined) {
    throw new Error("The Responses API can only replay a turn from the Responses API");
  }
  return [
    ...turn.responseItems.filter((item) =>
      item.type !== RESPONSE_ITEM_FUNCTION_CALL || item.call_id === turn.toolUseId
    ),
    {
      type: INPUT_ITEM_FUNCTION_CALL_OUTPUT,
      call_id: turn.toolUseId,
      output: stringifyOpenAiToolResultContent(turn.toolResultContent),
    },
  ];
}

function userItem(content: string): ResponsesInputItem {
  return { role: INPUT_ROLE_USER, content };
}

function functionCallItems(response: IResponsesResponse): JSONObject[] {
  return (response.output ?? []).filter((item) => item.type === RESPONSE_ITEM_FUNCTION_CALL);
}

function contentParts(message: JSONObject): JSONObject[] {
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content.filter((part): part is JSONObject =>
    typeof part === "object" && part !== null && !Array.isArray(part)
  );
}

/** A text field of a reply item. A missing or non-text field reads as empty. */
function textValue(value: Opt<JSONValue, Reason.OptionalInput>): string {
  return typeof value === "string" ? value : "";
}

function mapToolDefinitionResponses(tool: IToolDefinition): ResponsesWireTool {
  return {
    type: FUNCTION_TOOL_TYPE,
    name: tool.name,
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    parameters: tool.inputSchema,
    strict: false,
  };
}

/** The Responses tool_choice. It reuses the Chat Completions mapping and flattens a named function. */
function mapToolChoiceResponses(choice: IToolChoice): ResponsesWireToolChoice {
  const mapped = mapToolChoiceOpenAI(choice);
  return typeof mapped === "string" ? mapped : { type: FUNCTION_TOOL_TYPE, name: mapped.function.name };
}
