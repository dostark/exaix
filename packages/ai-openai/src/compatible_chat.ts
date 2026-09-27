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
import {
  COMPATIBLE_REDIRECT_POLICY,
  createOpenAIChatCompletionsRequestInit,
  extractOpenAICompatibleToolCalls,
  type OpenAIResponse,
  type TokenMap,
} from "@exaix/ai/provider_common_utils.ts";

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

/** Pure local-profile projection shared by measurement and transport. */
export function createCompatibleChatRequestInit(
  apiKey: string,
  model: string,
  prompt: string,
  options?: Opt<IModelOptions, Reason.OptionalInput>,
): RequestInit {
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
  const request = createOpenAIChatCompletionsRequestInit(apiKey, model, prompt, options);
  const body = JSON.parse(request.body as string) as Record<string, JSONValue>;
  if (options?.tools?.length) body.parallel_tool_calls = false;
  if (options?.thinking !== undefined) body.thinking = { type: options.thinking ? "enabled" : "disabled" };
  if (options?.effort !== undefined) body.reasoning_effort = options.effort;
  return { ...request, redirect: COMPATIBLE_REDIRECT_POLICY, body: JSON.stringify(body) };
}

/** Rejects malformed or unadvertised calls before any result can reach an executor. */
export function validateCompatibleResponse(
  data: OpenAIResponse,
  providerId: string,
  maxArgumentBytes: number,
  options?: Opt<IModelOptions, Reason.OptionalInput>,
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
  const usage = response.usage;
  if (
    usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens ||
    (usage.prompt_tokens_details?.cached_tokens ?? 0) > usage.prompt_tokens ||
    (usage.completion_tokens_details?.reasoning_tokens ?? 0) > usage.completion_tokens
  ) {
    throw new ProviderProtocolError("Invalid compatible token usage", providerId);
  }
  return response;
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
