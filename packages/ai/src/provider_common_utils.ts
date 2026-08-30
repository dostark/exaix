/**
 * @module ProviderUtils
 * @path packages/ai/src/provider_common_utils.ts
 * @description Shared utilities for AI providers, including token mapping, cost calculation, response handling, and retry logic.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers.ts, packages/ai/src/types.ts, packages/ai/src/providers/common.ts]
 */
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";

import {
  AuthenticationError,
  ConnectionError,
  type IGenerateResult,
  type IProviderToolCall,
  ModelProviderError,
  RateLimitError,
  withRetry,
} from "./providers/common.ts";
import {
  type IModelOptions,
  type IProviderTurn,
  type IToolChoice,
  type IToolDefinition,
  TOOL_CHOICE_TYPE_NONE,
  TOOL_CHOICE_TYPE_TOOL,
} from "./types.ts";
import type { JSONValue } from "@exaix/core";
import { DEFAULT_AI_RETRY_BACKOFF_BASE_MS, DEFAULT_AI_RETRY_MAX_ATTEMPTS, PROVIDER_MOCK } from "@exaix/ai";
import {
  COST_RATE_ANTHROPIC,
  COST_RATE_GOOGLE,
  COST_RATE_MOCK,
  COST_RATE_OLLAMA,
  COST_RATE_OPENAI,
  PROVIDER_ANTHROPIC,
  PROVIDER_EVENT_RESPONSE_DEBUG_DUMP,
  PROVIDER_GOOGLE,
  PROVIDER_OLLAMA,
  PROVIDER_OPENAI,
  TOKENS_PER_COST_UNIT,
} from "@exaix/core";
import { HTTP_FORBIDDEN, HTTP_TOO_MANY_REQUESTS, HTTP_UNAUTHORIZED } from "@exaix/core";
import { type Opt, type Reason, type SafeJsonInput, toSafeJson } from "@exaix/core/types";

export type TokenMap = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  model?: string;
  cost_usd?: number;
  provider?: string;
  /** Anthropic prompt-cache read tokens. undefined when the provider doesn't report
   *  cache usage or no cache_control was set on this call — never 0 for "unknown". */
  cache_read_tokens?: number;
  /** Anthropic prompt-cache write (creation) tokens, one-time per cache segment. */
  cache_creation_tokens?: number;
  /** Reasoning/thinking tokens, when the provider reports a breakdown (subset of
   *  completion_tokens, billed as output, not additional). undefined when the provider/
   *  model doesn't report one — never 0 for "no reasoning happened". */
  reasoning_tokens?: number;
};

type ResponseTokenMapper<T> = (data: T, providerId?: string) => TokenMap | undefined;

// Provider Response Interfaces
export type OllamaResponse = {
  model: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
};

export type OpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  /** Official OpenAI Chat Completions field for reasoning models (o1/o3/gpt-5 family):
   *  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
   *  reasoning_tokens is a SUBSET of completion_tokens (billed as output). */
  completion_tokens_details?: { reasoning_tokens?: number };
};

/** One OpenAI-format tool call, as it appears on the wire — `arguments` is a
 *  JSON-ENCODED STRING (unlike Anthropic's already-parsed `input` object), parsed by
 *  extractOpenAIToolCalls(). */
export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAIResponse = {
  usage?: OpenAIUsage;
  choices?: Array<{
    message?: {
      content?: string;
      /** Present when finish_reason is "tool_calls". */
      tool_calls?: OpenAIToolCall[];
      /** Reasoning content replayed with the assistant message for continuity. */
      reasoning_content?: string;
    };
    text?: string;
  }>;
};

export type GoogleUsageMetadata = {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount?: number;
  /** Real Gemini API field, present when the model does internal reasoning (2.5+-class
   *  models default to dynamic thinking). With the Gemini API, candidatesTokenCount already
   *  includes thoughtsTokenCount — a subset, not additional. */
  thoughtsTokenCount?: number;
};

export type GoogleResponse = {
  usageMetadata?: GoogleUsageMetadata;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        /** Present when Gemini selects a tool. `args` is already a PARSED object on
         *  the wire (unlike OpenAI's JSON-encoded string). No `id` field -
         *  extractGoogleToolCalls() generates one. */
        functionCall?: { name: string; args: Record<string, JSONValue>; thoughtSignature?: string };
      }>;
    };
  }>;
};

export type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  /** Real, documented Anthropic Messages API fields — populated only when prompt caching
   *  was used on this call (anthropic_provider.ts sends cache_control on prompt blocks). */
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  /** Real Anthropic Messages API field, present when extended thinking was used
   *  (options.thinking / config.ai_anthropic.thinking_default). thinking_tokens is a SUBSET
   *  of output_tokens (billed as output, not additional). */
  output_tokens_details?: { thinking_tokens?: number };
};

export type AnthropicResponse = {
  usage?: AnthropicUsage;
  /** Why generation ended: "end_turn", "max_tokens" (truncated), "stop_sequence", ... */
  stop_reason?: string;
  content?: Array<{
    /** Block type, e.g. "text", "thinking", "tool_use". Absent in older response shapes. */
    type?: string;
    text?: string;
    thinking?: string;
    /** Signature required to replay an Anthropic thinking block unchanged. */
    signature?: string;
    /** tool_use block fields — present only when type === "tool_use". */
    id?: string;
    name?: string;
    input?: Record<string, JSONValue>;
  }>;
};

/**
 * Calculate cost for token usage based on provider
 */
export function calculateCost(provider: string, totalTokens: number): number {
  const rates: Record<string, number> = {
    [PROVIDER_OPENAI]: COST_RATE_OPENAI,
    [PROVIDER_ANTHROPIC]: COST_RATE_ANTHROPIC,
    [PROVIDER_GOOGLE]: COST_RATE_GOOGLE,
    [PROVIDER_OLLAMA]: COST_RATE_OLLAMA,
    [PROVIDER_MOCK]: COST_RATE_MOCK,
  };

  // Extract provider name from id (e.g., "google-gemini-2.0-flash-exp" -> "google")
  const providerKey = provider.split("-")[0].toLowerCase(); // This assumes provider constants are lowercase strings
  const rate = rates[providerKey] ?? 0;
  return rate * (totalTokens / TOKENS_PER_COST_UNIT);
}

/** Maps a provider error response to the retry-semantics-bearing error class. The
 *  body's documented error type wins over the HTTP status, so a transient
 *  overloaded_error/rate_limit_error stays retryable under a surprising status. */
function classifyProviderError(
  status: number,
  errorType: Opt<string, Reason.OptionalContext>,
  message: string,
  id: string,
): Error {
  if (errorType === "authentication_error" || errorType === "permission_error") {
    return new AuthenticationError(id, message);
  }
  if (errorType === "rate_limit_error") {
    return new RateLimitError(id, message);
  }
  if (errorType === "overloaded_error" || errorType === "api_error") {
    return new ConnectionError(id, message);
  }
  if (
    errorType === "invalid_request_error" || errorType === "not_found_error" ||
    errorType === "request_too_large"
  ) {
    return new ModelProviderError(message, id);
  }
  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) {
    return new AuthenticationError(id, message);
  }
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return new RateLimitError(id, message);
  }
  if (status >= 500) {
    // Treat server (5xx) responses as connection-level failures
    return new ConnectionError(id, message);
  }
  return new ModelProviderError(message, id);
}

export async function handleProviderResponse<T>(
  response: Response,
  id: string,
  logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  tokenMapper?: Opt<ResponseTokenMapper<T>, Reason.OptionalDependency>,
): Promise<T> {
  if (!response.ok) {
    // Include HTTP status code in messages so tests can assert on it (e.g. "HTTP 503").
    let message = `HTTP ${response.status} ${response.statusText}`;
    let errorType: string | undefined;
    try {
      const error = await response.json();
      errorType = error.error?.type ?? undefined;
      const remoteMsg = error.error?.message ?? error.message ?? undefined;
      if (remoteMsg) {
        // Surface the machine-readable error type alongside the human message —
        // it is the contract the API documents (e.g. "invalid_request_error").
        message = errorType
          ? `HTTP ${response.status} ${errorType}: ${remoteMsg}`
          : `HTTP ${response.status} ${remoteMsg}`;
      }
    } catch {
      // ignore JSON parse errors and fallback to statusText
    }
    throw classifyProviderError(response.status, errorType, message, id);
  }

  const data = await response.json() as T;

  if (logger && tokenMapper) {
    try {
      const tokens = tokenMapper(data, id);
      if (tokens) {
        const inputTokens = tokens.prompt_tokens ?? 0;
        const outputTokens = tokens.completion_tokens ?? 0;
        const totalTokens = tokens.total_tokens ?? inputTokens + outputTokens;
        await logger.info(DomainEventType.LlmUsageRecorded, id, {
          ...tokens,
          provider: tokens.provider ?? id,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: totalTokens,
        });
      }
    } catch {
      // never fail the provider call because token logging failed
    }
  }

  return data;
}

/** Token mapper for OpenAI response shape */
export function tokenMapperOpenAI(model: string): ResponseTokenMapper<OpenAIResponse> {
  return (d: OpenAIResponse, providerId?: Opt<string, Reason.OptionalContext>): TokenMap | undefined => {
    if (!d.usage) return undefined;

    const totalTokens = d.usage.total_tokens ?? (d.usage.prompt_tokens + d.usage.completion_tokens);
    const cost = providerId ? calculateCost(providerId, totalTokens) : undefined;

    return {
      prompt_tokens: d.usage.prompt_tokens,
      completion_tokens: d.usage.completion_tokens,
      total_tokens: totalTokens,
      model,
      cost_usd: cost,
      reasoning_tokens: d.usage.completion_tokens_details?.reasoning_tokens,
    };
  };
}

/** Extract textual content from OpenAI response */
export function extractOpenAIContent(d: OpenAIResponse): string {
  return d.choices?.[0]?.message?.content ?? "";
}

/** OpenAI's wire-format tool object (`{type:"function", function:{name, description?,
 *  parameters}}`), mapped from IToolDefinition. Exported so OpenRouter's request body (Step 4)
 *  can name its `tools[]` field against this shape instead of `ReturnType<typeof ...>`. */
export type OpenAiWireToolDefinition = {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, JSONValue> };
};

/** Map IToolDefinition to OpenAI's wire-format tool object. */
export function mapToolDefinitionOpenAI(tool: IToolDefinition): OpenAiWireToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description !== undefined ? { description: tool.description } : {}),
      parameters: tool.inputSchema,
    },
  };
}

/** OpenAI's wire-format `tool_choice`, mapped from IToolChoice. */
export type OpenAiWireToolChoice = "auto" | "none" | "required" | { type: "function"; function: { name: string } };

/** Map IToolChoice to OpenAI's wire-format tool_choice. `disable_parallel_tool_use`
 *  has no equivalent within `tool_choice` itself and is intentionally NOT wired to
 *  the unrelated top-level `parallel_tool_calls` request field. */
export function mapToolChoiceOpenAI(choice: IToolChoice): OpenAiWireToolChoice {
  switch (choice.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case TOOL_CHOICE_TYPE_TOOL:
      return { type: "function", function: { name: choice.name } };
    case TOOL_CHOICE_TYPE_NONE:
      return TOOL_CHOICE_TYPE_NONE;
  }
}

/** OpenAI's tool-result message `content` field is a plain string. Anthropic's
 *  IProviderTurn.toolResultContent may be a string OR rich content blocks; stringify
 *  the rich-block case rather than dropping it. */
function stringifyOpenAiToolResultContent(
  content: string | Array<{ type: string; [key: string]: JSONValue }>,
): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

/** One outbound message in the OpenAI Chat Completions `messages[]` array, covering the
 *  three shapes this module constructs (priorTurn's assistant tool_calls + tool result,
 *  plus the plain user prompt). Exported for reuse by other OpenAI-compatible callers. */
export type OpenAiChatMessage =
  | {
    role: "assistant";
    content: null;
    /** Prior reasoning content replayed with tool-call outputs. */
    reasoning_content?: string;
    tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  }
  | { role: "tool"; tool_call_id: string; content: string }
  | { role: "user"; content: string };

/** OpenAI Chat Completions message role for a tool-result message. Distinct concept from
 *  TOOL_CHOICE_TYPE_TOOL (a wire-protocol role, not an IToolChoice discriminant) - named
 *  separately even though the literal value happens to match. */
const OPENAI_MESSAGE_ROLE_TOOL = "tool";

/** Build the OpenAI Chat Completions `messages[]` array for `prompt`, optionally
 *  prepending `priorTurn`'s 2-message exchange (assistant tool_calls + tool result)
 *  first. Exported for reuse by other byte-for-byte OpenAI-compatible callers. */
export function buildOpenAiMessages(
  prompt: string,
  priorTurn?: Opt<IProviderTurn, Reason.OptionalInput>,
): OpenAiChatMessage[] {
  const messages: OpenAiChatMessage[] = [];
  if (priorTurn) {
    messages.push({
      role: "assistant",
      content: null,
      // Preserve disclosed reasoning across native tool-calling turns.
      ...(priorTurn.reasoningContent !== undefined ? { reasoning_content: priorTurn.reasoningContent } : {}),
      tool_calls: [{
        id: priorTurn.toolUseId,
        type: "function",
        function: { name: priorTurn.toolName, arguments: JSON.stringify(priorTurn.toolInput) },
      }],
    });
    messages.push({
      role: OPENAI_MESSAGE_ROLE_TOOL,
      tool_call_id: priorTurn.toolUseId,
      content: stringifyOpenAiToolResultContent(priorTurn.toolResultContent),
    });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

/** OpenAI's o-series and gpt-5.x reasoning models reject a non-default
 *  `temperature`/`top_p` with a 400 invalid_request_error; only `gpt-4o` ("o" for
 *  omni, not o-series) and earlier models are unaffected. Matched by name prefix. */
function isOpenAiReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/.test(model);
}

/** OpenAI's `reasoning_effort` value that disables reasoning entirely — the only value
 *  Chat Completions accepts alongside function tools on gpt-5.6+. Not a member of
 *  EffortTier, so it is never a caller preference, only a forced override. */
const OPENAI_REASONING_EFFORT_NONE = "none";

export function createOpenAIChatCompletionsRequestInit(
  apiKey: string,
  model: string,
  prompt: string,
  options?: Opt<IModelOptions, Reason.OptionalInput>,
): RequestInit {
  const reasoningModel = isOpenAiReasoningModel(model);
  const hasTools = Boolean(options?.tools?.length);
  // gpt-5.6+ rejects function tools on Chat Completions unless reasoning_effort is
  // exactly "none"; force it whenever tools are present so native tool-calling
  // functions on this model family, overriding any caller-preferred effort tier.
  const reasoningEffort = reasoningModel ? (hasTools ? OPENAI_REASONING_EFFORT_NONE : options?.effort) : undefined;
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: buildOpenAiMessages(prompt, options?.priorTurn),
      // OpenAI deprecated max_tokens in favor of max_completion_tokens and rejects
      // max_tokens outright on o-series/gpt-5 reasoning models; IModelOptions.max_tokens
      // is Exaix's own field name — only the OpenAI wire serialization moves.
      max_completion_tokens: options?.max_tokens,
      temperature: reasoningModel ? undefined : options?.temperature,
      top_p: reasoningModel ? undefined : options?.top_p,
      reasoning_effort: reasoningEffort,
      stop: options?.stop,
      tools: options?.tools?.map(mapToolDefinitionOpenAI),
      tool_choice: options?.toolChoice ? mapToolChoiceOpenAI(options.toolChoice) : undefined,
    }),
  };
}

/** Extract ALL tool calls from an OpenAI response, or undefined when none exist.
 *  `function.arguments` is a JSON-ENCODED STRING on the wire (unlike Anthropic's
 *  already-parsed `input`); a malformed entry is logged and dropped, not thrown. */
export function extractOpenAIToolCalls(d: OpenAIResponse): IProviderToolCall[] | undefined {
  const rawCalls = d.choices?.[0]?.message?.tool_calls;
  if (!rawCalls || rawCalls.length === 0) return undefined;

  // Carry turn-level reasoning on each call so the next request can replay it.
  const reasoningContent = d.choices?.[0]?.message?.reasoning_content;

  const parsed: IProviderToolCall[] = [];
  for (const call of rawCalls) {
    try {
      const input = JSON.parse(call.function.arguments) as Record<string, JSONValue>;
      parsed.push({
        id: call.id,
        name: call.function.name,
        input,
        type: "function",
        ...(reasoningContent !== undefined ? { reasoningContent } : {}),
      });
    } catch {
      console.warn(
        `extractOpenAIToolCalls: dropping tool call "${call.function.name}" (id=${call.id}) - malformed arguments JSON`,
      );
    }
  }
  return parsed.length > 0 ? parsed : undefined;
}

/** Token mapper for Google response shape */
export function tokenMapperGoogle(model: string): ResponseTokenMapper<GoogleResponse> {
  return (d: GoogleResponse, providerId?: Opt<string, Reason.OptionalContext>): TokenMap | undefined => {
    if (!d.usageMetadata) return undefined;

    const totalTokens = d.usageMetadata.totalTokenCount ??
      (d.usageMetadata.promptTokenCount + d.usageMetadata.candidatesTokenCount);
    const cost = providerId ? calculateCost(providerId, totalTokens) : undefined;

    return {
      prompt_tokens: d.usageMetadata.promptTokenCount,
      completion_tokens: d.usageMetadata.candidatesTokenCount,
      total_tokens: totalTokens,
      model,
      cost_usd: cost,
      reasoning_tokens: d.usageMetadata.thoughtsTokenCount,
    };
  };
}

/** Extract textual content from Google response */
export function extractGoogleContent(d: GoogleResponse): string {
  return d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/** Extract ALL tool calls from a Google response, or undefined when none exist.
 *  `args` is already a PARSED object on the wire (unlike OpenAI's JSON-encoded
 *  string). Gemini's `functionCall` has no `id`, so one is synthesized per call. */
export function extractGoogleToolCalls(d: GoogleResponse): IProviderToolCall[] | undefined {
  const parts = d.candidates?.[0]?.content?.parts;
  if (!parts) return undefined;
  const calls = parts
    .filter((
      part,
    ): part is { functionCall: { name: string; args: Record<string, JSONValue>; thoughtSignature?: string } } =>
      part.functionCall !== undefined
    )
    .map((part) => ({
      id: crypto.randomUUID(),
      name: part.functionCall.name,
      input: part.functionCall.args,
      type: "function",
      // Gemini requires the thought signature on the next function-call turn.
      ...(part.functionCall.thoughtSignature !== undefined
        ? { thoughtSignature: part.functionCall.thoughtSignature }
        : {}),
    }));
  return calls.length > 0 ? calls : undefined;
}

/** Token mapper for Anthropic response shape */
export function tokenMapperAnthropic(model: string): ResponseTokenMapper<AnthropicResponse> {
  return (d: AnthropicResponse, providerId?: Opt<string, Reason.OptionalContext>): TokenMap | undefined => {
    if (!d.usage) return undefined;

    const totalTokens = (d.usage.input_tokens ?? 0) + (d.usage.output_tokens ?? 0);
    const cost = providerId ? calculateCost(providerId, totalTokens) : undefined;

    return {
      prompt_tokens: d.usage.input_tokens,
      completion_tokens: d.usage.output_tokens,
      total_tokens: totalTokens,
      model,
      cost_usd: cost,
      cache_read_tokens: d.usage.cache_read_input_tokens,
      cache_creation_tokens: d.usage.cache_creation_input_tokens,
      reasoning_tokens: d.usage.output_tokens_details?.thinking_tokens,
    };
  };
}

/** Extract textual content from an Anthropic response. Thinking-capable models prepend
 *  a `thinking` block before the `text` block, so content[0] alone can be empty —
 *  join every text-bearing block instead. */
export function extractAnthropicContent(d: AnthropicResponse): string {
  if (!d.content) return "";
  return d.content
    .filter((block) => block.type === undefined || block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

/** Extract ALL tool_use blocks from an Anthropic response, or undefined when none exist.
 *  The leading `thinking` blocks preceding each tool_use are captured onto it — Anthropic
 *  requires replaying them complete and unmodified. */
export function extractAnthropicToolCalls(d: AnthropicResponse): IProviderToolCall[] | undefined {
  if (!d.content) return undefined;
  const toolUseBlocks = d.content.filter((block) => block.type === "tool_use");
  if (toolUseBlocks.length === 0) return undefined;
  const content = d.content;
  return toolUseBlocks.map((block) => ({
    id: block.id ?? "",
    name: block.name ?? "",
    input: block.input ?? {},
    type: "tool_use",
    // Capture thinking blocks since the preceding tool-use boundary.
    ...(collectThinkingBlocksBefore(content, content.indexOf(block)) ?? {}),
  }));
}

/** Collect the `thinking` blocks immediately preceding the tool_use block at
 *  `toolUseIndex`, stopping at the previous tool_use boundary. Returns undefined
 *  when none found, so the spread omits the field entirely. */
function collectThinkingBlocksBefore(
  content: NonNullable<AnthropicResponse["content"]>,
  toolUseIndex: number,
): { thinkingBlocks: Array<{ thinking: string; signature: string }> } | undefined {
  const blocks: Array<{ thinking: string; signature: string }> = [];
  for (let i = toolUseIndex - 1; i >= 0; i--) {
    const block = content[i];
    if (block.type === "thinking") {
      blocks.unshift({ thinking: block.thinking ?? "", signature: block.signature ?? "" });
      continue;
    }
    if (block.type === "tool_use") break;
    break;
  }
  return blocks.length > 0 ? { thinkingBlocks: blocks } : undefined;
}

/** Perform fetch with retries/backoff and timeout, and handle provider responses. */
export async function fetchJsonWithRetries<T>(
  url: string,
  fetchOptions: RequestInit,
  {
    id,
    maxAttempts = DEFAULT_AI_RETRY_MAX_ATTEMPTS,
    backoffBaseMs = DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
    timeoutMs,
    logger,
    tokenMapper,
  }: {
    id: string;
    maxAttempts?: number;
    backoffBaseMs?: number;
    timeoutMs?: number;
    logger?: IEventLogger;
    tokenMapper?: (d: T, providerId?: string) => TokenMap | undefined;
  },
): Promise<T> {
  // Use the withRetry helper to centralize retry/backoff semantics
  const attemptFn = async () => {
    const controller = typeof timeoutMs === "number" ? new AbortController() : undefined;
    const signal = controller?.signal;
    const timeoutId = controller && typeof timeoutMs === "number"
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    try {
      const response = await fetch(url, { ...fetchOptions, signal });
      // Let handleProviderResponse inspect status, parse JSON and throw typed errors
      const data = await handleProviderResponse<T>(response, id, logger, tokenMapper);
      if (timeoutId) clearTimeout(timeoutId);
      return data;
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      // Rethrow to allow withRetry to decide whether to retry
      throw err;
    }
  };

  // Use withRetry defined in providers/common.ts
  return await withRetry(attemptFn, { maxRetries: maxAttempts, baseDelayMs: backoffBaseMs });
}

/** Perform a provider call: fetch JSON with retries, then extract textual content
 *  using the provided extractor. */
export async function performProviderCall<T>(
  url: string,
  fetchOptions: RequestInit,
  {
    id,
    maxAttempts = DEFAULT_AI_RETRY_MAX_ATTEMPTS,
    backoffBaseMs = DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
    timeoutMs,
    logger,
    tokenMapper,
    extractor,
    stopReasonExtractor,
    toolCallExtractor,
  }: {
    id: string;
    maxAttempts?: number;
    backoffBaseMs?: number;
    timeoutMs?: number;
    logger?: IEventLogger;
    tokenMapper?: (d: T, providerId?: string) => TokenMap | undefined;
    extractor?: (d: T) => string;
    stopReasonExtractor?: (d: T) => string | undefined;
    /** Optional extractor for native tool-call blocks in the provider response,
     *  surfaced as IGenerateResult.toolCalls when present. */
    toolCallExtractor?: (d: T) => IProviderToolCall[] | undefined;
  },
): Promise<IGenerateResult> {
  const data = await fetchJsonWithRetries<T>(url, fetchOptions, {
    id,
    maxAttempts,
    backoffBaseMs,
    timeoutMs,
    logger,
    tokenMapper,
  });
  // Debug-level dump of the raw response body: content extraction strips parts of
  // it (e.g. thinking blocks), so investigating a live-provider issue needs the
  // unfiltered body in the journal.
  if (logger) {
    void logger.debug(PROVIDER_EVENT_RESPONSE_DEBUG_DUMP, id, {
      provider: id,
      response_body: toSafeJson(data as SafeJsonInput) ?? {},
    });
  }
  const content = extractor
    ? extractor(data)
    : ((data as OpenAIResponse)?.choices?.[0]?.message?.content ?? (data as OpenAIResponse)?.choices?.[0]?.text ?? "");

  const tokens = tokenMapper ? tokenMapper(data, id) : undefined;
  return {
    content: content ?? "",
    usage: {
      promptTokens: tokens?.prompt_tokens ?? 0,
      completionTokens: tokens?.completion_tokens ?? 0,
      totalTokens: tokens?.total_tokens ?? 0,
      cacheReadTokens: tokens?.cache_read_tokens,
      cacheCreationTokens: tokens?.cache_creation_tokens,
      reasoningTokens: tokens?.reasoning_tokens,
    },
    cost_usd: tokens?.cost_usd,
    model: tokens?.model ?? "unknown",
    provider: tokens?.provider ?? id,
    stop_reason: stopReasonExtractor?.(data),
    toolCalls: toolCallExtractor?.(data),
  };
}
