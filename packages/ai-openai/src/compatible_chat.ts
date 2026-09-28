/**
 * @module CompatibleChat
 * @path packages/ai-openai/src/compatible_chat.ts
 * @description Validates the supported serial chat response and maps reported usage without guessing prices.
 * @architectural-layer AI
 * @dependencies [zod, @exaix/ai]
 * @related-files [packages/ai-openai/src/openai_provider.ts]
 */
import { z } from "zod";
import { ProviderProtocolError } from "@exaix/ai/errors.ts";
import { type IModelOptions, TOOL_CHOICE_TYPE_NONE } from "@exaix/ai/types.ts";
import { type JSONValue, ProviderType } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { CompatibleChatConfig } from "@exaix/schemas";
import {
  COMPATIBLE_REDIRECT_POLICY,
  createOpenAIChatCompletionsRequestInit,
  extractOpenAICompatibleToolCalls,
  type OpenAIResponse,
  type TokenMap,
} from "@exaix/ai/provider_common_utils.ts";
import { planStructuredOutput, validateStructuredOutput } from "./compatible_structured_output.ts";
import type { StructuredOutputMode, StructuredOutputModeReason } from "@exaix/ai/providers";

/** Structured-output dispatch treats an absent profile (the local-test fixture calling
 *  compatible_chat helpers directly, without a factory-resolved profile) as OpenAI-shaped. */
const DEFAULT_STRUCTURED_OUTPUT_PROFILE = "openai";

const tokenCount = z.number().int().nonnegative();
const CompatibleResponseSchema = z.object({
  model: z.string().min(1),
  choices: z.array(z.object({
    message: z.object({
      role: z.literal("assistant"),
      content: z.string().nullable(),
      reasoning_content: z.string().optional(),
      refusal: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        id: z.string().min(1),
        type: z.literal("function"),
        function: z.object({ name: z.string().min(1), arguments: z.string() }),
      })).max(1).optional(),
    }),
    finish_reason: z.enum(["stop", "tool_calls"]),
  })).length(1),
  usage: z.object({
    prompt_tokens: tokenCount,
    completion_tokens: tokenCount,
    total_tokens: tokenCount,
    prompt_tokens_details: z.object({ cached_tokens: tokenCount.optional() }).optional(),
    completion_tokens_details: z.object({ reasoning_tokens: tokenCount.optional() }).optional(),
  }),
});

/** The wire RequestInit plus its structured-output mode, for the caller to attach to IGenerateResult. */
export interface ICompatibleChatRequestInit {
  init: RequestInit;
  structuredOutputMode?: StructuredOutputMode;
  structuredOutputModeReason?: StructuredOutputModeReason;
}

/** Per-profile wire projection (DeepSeek omits `parallel_tool_calls` and thinking-mode
 *  sampling fields). `options.jsonSchema` selects strict json_schema or json_object mode. */
export function createCompatibleChatRequestInit(
  apiKey: string,
  model: string,
  prompt: string,
  options?: Opt<IModelOptions, Reason.OptionalInput>,
  profile?: Opt<CompatibleChatConfig["profile"], Reason.OptionalContext>,
): ICompatibleChatRequestInit {
  const snapshot = options?.nativeConversation;
  const ids = snapshot?.turns.map((turn) => turn.toolUseId) ?? [];
  if (
    options?.stream || ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length ||
    (snapshot && prompt !== snapshot.initialPrompt) ||
    (snapshot?.initialPromptSections &&
      snapshot.initialPromptSections.map((section) => section.text).join("") !== prompt)
  ) {
    throw new ProviderProtocolError("Invalid compatible request protocol", ProviderType.OPENAI_CHAT);
  }
  let structuredOutputMode: StructuredOutputMode | undefined;
  let structuredOutputModeReason: StructuredOutputModeReason | undefined;
  let responseFormat: Record<string, JSONValue> | undefined;
  let wirePrompt = prompt;
  if (options?.jsonSchema) {
    let plan;
    try {
      plan = planStructuredOutput(profile ?? DEFAULT_STRUCTURED_OUTPUT_PROFILE, options.jsonSchema);
    } catch (error) {
      throw new ProviderProtocolError(
        `Unsupported structured-output schema: ${error instanceof Error ? error.message : String(error)}`,
        ProviderType.OPENAI_CHAT,
      );
    }
    structuredOutputMode = plan.mode;
    structuredOutputModeReason = plan.reason;
    responseFormat = plan.responseFormat;
    if (plan.promptInstruction) wirePrompt = `${prompt}\n\n${plan.promptInstruction}`;
  }

  // The native conversation contract checks the caller's immutable prompt before wire
  // projection. Add the JSON-mode instruction to the projected first message instead.
  const request = createOpenAIChatCompletionsRequestInit(apiKey, model, prompt, options);
  const body = JSON.parse(request.body as string) as Record<string, JSONValue>;
  applyWirePromptInstruction(body, prompt, wirePrompt, snapshot !== undefined);
  applyProfileOptions(body, profile, options);
  if (responseFormat) body.response_format = responseFormat;
  return {
    init: { ...request, redirect: COMPATIBLE_REDIRECT_POLICY, body: JSON.stringify(body) },
    structuredOutputMode,
    structuredOutputModeReason,
  };
}

function applyWirePromptInstruction(
  body: Record<string, JSONValue>,
  prompt: string,
  wirePrompt: string,
  hasNativeConversation: boolean,
): void {
  if (wirePrompt === prompt) return;
  const messages = body.messages as Array<Record<string, JSONValue>>;
  const promptMessage = hasNativeConversation ? messages[0] : messages[messages.length - 1];
  if (!promptMessage) {
    throw new ProviderProtocolError("Compatible request has no prompt message", ProviderType.OPENAI_CHAT);
  }
  promptMessage.content = wirePrompt;
}

function applyProfileOptions(
  body: Record<string, JSONValue>,
  profile: Opt<CompatibleChatConfig["profile"], Reason.OptionalContext>,
  options: Opt<IModelOptions, Reason.OptionalInput>,
): void {
  const isDeepSeek: boolean = profile === "deepseek";
  if (options?.tools?.length && !isDeepSeek) body.parallel_tool_calls = false;
  if (options?.thinking !== undefined) body.thinking = { type: options.thinking ? "enabled" : "disabled" };
  if (options?.effort !== undefined) body.reasoning_effort = options.effort;
  if (isDeepSeek && options?.thinking === true) {
    delete body.temperature;
    delete body.top_p;
  }
}

/** Rejects malformed or unadvertised calls. A final response's content, when jsonSchema is
 *  set, is re-validated against the original schema and replaced with the normalized JSON. */
export function validateCompatibleResponse(
  data: OpenAIResponse,
  providerId: string,
  maxArgumentBytes: number,
  options?: Opt<IModelOptions, Reason.OptionalInput>,
  profile?: Opt<CompatibleChatConfig["profile"], Reason.OptionalContext>,
): OpenAIResponse {
  const parsed = CompatibleResponseSchema.safeParse(data);
  if (!parsed.success) throw new ProviderProtocolError("Invalid compatible response protocol", providerId);
  const response = parsed.data;
  const { message, finish_reason } = response.choices[0];
  const calls = message.tool_calls ?? [];
  if (message.refusal || (calls.length === 1) !== (finish_reason === "tool_calls")) {
    throw new ProviderProtocolError("Invalid compatible response completion", providerId);
  }
  if (calls.length === 0 && !message.content?.trim()) {
    throw new ProviderProtocolError("Compatible response has no final content", providerId);
  }
  const call = calls[0];
  if (call) {
    const advertised = options?.tools?.some((tool) => tool.name === call.function.name);
    const consumed = options?.nativeConversation?.turns.some((turn) => turn.toolUseId === call.id);
    if (!advertised || consumed || options?.toolChoice?.type === TOOL_CHOICE_TYPE_NONE) {
      throw new ProviderProtocolError("Invalid compatible tool call", providerId);
    }
    extractOpenAICompatibleToolCalls(response, maxArgumentBytes, providerId);
  }
  validateCompatibleUsage(response.usage, providerId);
  if (!call && options?.jsonSchema) {
    let normalized: JSONValue;
    try {
      normalized = validateStructuredOutput(
        message.content!,
        options.jsonSchema,
        profile ?? DEFAULT_STRUCTURED_OUTPUT_PROFILE,
      );
    } catch (error) {
      throw new ProviderProtocolError(
        `Structured output failed schema validation: ${error instanceof Error ? error.message : String(error)}`,
        providerId,
      );
    }
    response.choices[0].message.content = JSON.stringify(normalized);
  }
  return response;
}

function validateCompatibleUsage(usage: z.infer<typeof CompatibleResponseSchema>["usage"], providerId: string): void {
  if (
    usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens ||
    (usage.prompt_tokens_details?.cached_tokens ?? 0) > usage.prompt_tokens ||
    (usage.completion_tokens_details?.reasoning_tokens ?? 0) > usage.completion_tokens
  ) {
    throw new ProviderProtocolError("Invalid compatible token usage", providerId);
  }
}

/** Uses the returned model and reported token breakdowns. Costs remain unknown without verified rates. */
export function mapCompatibleUsage(response: OpenAIResponse): TokenMap {
  return {
    model: response.model,
    prompt_tokens: response.usage!.prompt_tokens,
    completion_tokens: response.usage!.completion_tokens,
    total_tokens: response.usage!.total_tokens,
    cache_read_tokens: response.usage!.prompt_tokens_details?.cached_tokens,
    reasoning_tokens: response.usage!.completion_tokens_details?.reasoning_tokens,
  };
}
