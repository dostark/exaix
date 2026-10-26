/**
 * @module AnthropicPackageProvider
 * @path packages/ai-anthropic/src/anthropic_provider.ts
 * @description Anthropic Claude provider implementation owned by the @exaix/ai-anthropic package.
 * @architectural-layer AI
 * @related-files [packages/ai-anthropic/src/anthropic_factory.ts, packages/ai-anthropic/src/anthropic_provider.ts]
 */

import {
  ANTHROPIC_CACHE_CONTROL_EPHEMERAL,
  ANTHROPIC_CONTENT_TYPE_TEXT,
  ANTHROPIC_CONTENT_TYPE_TOOL_RESULT,
  ANTHROPIC_CONTENT_TYPE_TOOL_USE,
  ANTHROPIC_MESSAGE_ROLE_ASSISTANT,
  ANTHROPIC_MESSAGE_ROLE_USER,
  ANTHROPIC_THINKING_ADAPTIVE,
  ANTHROPIC_TOOL_CHOICE_ANY,
  ANTHROPIC_TOOL_CHOICE_NONE,
  ANTHROPIC_TOOL_CHOICE_TOOL,
  DEFAULT_ANTHROPIC_API_VERSION,
  DEFAULT_ANTHROPIC_ENDPOINT,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_RETRY_BACKOFF_MS,
  DEFAULT_ANTHROPIC_RETRY_MAX_ATTEMPTS,
  DEFAULT_ANTHROPIC_TIMEOUT_MS,
  PROVIDER_ANTHROPIC,
} from "./constants.ts";
import { AnthropicMessagesRequestSchema } from "./anthropic_request_schema.ts";
import {
  anthropicCallCapabilities,
  anthropicModelRules,
  type IAnthropicModelRules,
  requestTuning,
} from "./model_rules.ts";
import {
  type AnthropicResponse,
  extractAnthropicAssistantReplay,
  extractAnthropicContent,
  extractAnthropicToolCalls,
  NATIVE_NO_TOOLS_TEXT_INSTRUCTION,
  performProviderCall,
  tokenMapperAnthropic,
} from "@exaix/ai/provider_common_utils.ts";
import { BaseProvider, type IBaseProviderOptions, type IGenerateResult, ModelProviderError } from "@exaix/ai/providers";
import type { IModelOptions, IProviderToolRound, IToolChoice, IToolDefinition } from "@exaix/ai/types.ts";
import type { IProviderCallCapabilities } from "@exaix/ai";
import { PROVIDER_EVENT_REQUEST_DEBUG_DUMP, PROVIDER_EVENT_THINKING_NOT_DISABLED } from "@exaix/core";
import { type Opt, type Reason, toSafeJson } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";

/**
 * Options for AnthropicProvider.
 */
type AnthropicProviderOptions = IBaseProviderOptions;

/** Error thrown when tool_choice conflicts with extended thinking. */
class AnthropicToolChoiceThinkingConflictError extends ModelProviderError {
  constructor(toolChoiceType: string) {
    super(
      `tool_choice type "${toolChoiceType}" is not supported alongside extended thinking`,
      PROVIDER_ANTHROPIC,
    );
    this.name = "AnthropicToolChoiceThinkingConflictError";
    Object.setPrototypeOf(this, AnthropicToolChoiceThinkingConflictError.prototype);
  }
}

/**
 * Manual extended thinking rejects a forced tool_choice. Adaptive thinking accepts one on the models that allow it.
 */
function assertForcedChoiceAllowed(
  toolChoiceType: Opt<string, Reason.OptionalInput>,
  thinking: Opt<boolean, Reason.OptionalInput>,
  rules: Opt<IAnthropicModelRules, Reason.OptionalContext>,
): void {
  const forced = toolChoiceType === ANTHROPIC_TOOL_CHOICE_ANY || toolChoiceType === ANTHROPIC_TOOL_CHOICE_TOOL;
  if (forced && thinking && rules?.thinkingOn !== ANTHROPIC_THINKING_ADAPTIVE) {
    throw new AnthropicToolChoiceThinkingConflictError(toolChoiceType);
  }
}

/**
 * AnthropicProvider implements IModelProvider for Anthropic's Claude models.
 */
export class AnthropicProvider extends BaseProvider {
  readonly callCapabilities: IProviderCallCapabilities;
  private readonly apiVersion: string;
  private readonly maxTokensDefault: number;
  private readonly thinkingDefault?: boolean;

  constructor(options: AnthropicProviderOptions & { apiVersion?: string }) {
    super({
      ...options,
      defaultModel: options.config?.ai_anthropic?.default_model || DEFAULT_ANTHROPIC_MODEL,
      defaultEndpoint: options.config?.ai_endpoints?.anthropic || DEFAULT_ANTHROPIC_ENDPOINT,
      defaultTimeout: options.config?.ai_timeout?.providers?.anthropic || DEFAULT_ANTHROPIC_TIMEOUT_MS,
      defaultRetryDelay: options.config?.ai_retry?.providers?.anthropic?.backoff_base_ms ||
        DEFAULT_ANTHROPIC_RETRY_BACKOFF_MS,
      defaultMaxRetries: options.config?.ai_retry?.providers?.anthropic?.max_attempts ||
        DEFAULT_ANTHROPIC_RETRY_MAX_ATTEMPTS,
    }, PROVIDER_ANTHROPIC);

    this.apiVersion = options.apiVersion ||
      options.config?.ai_anthropic?.api_version ||
      DEFAULT_ANTHROPIC_API_VERSION;
    this.maxTokensDefault = options.config?.ai_anthropic?.max_tokens_default ||
      DEFAULT_ANTHROPIC_MAX_TOKENS;
    this.thinkingDefault = options.config?.ai_anthropic?.thinking_default;
    this.callCapabilities = anthropicCallCapabilities(this.model);
  }

  protected override async attemptGenerate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    const rules = anthropicModelRules(this.model);
    const thinkingRequested = options?.thinking ?? this.thinkingDefault;
    assertForcedChoiceAllowed(options?.toolChoice?.type, thinkingRequested, rules);

    const messages: AnthropicRequestMessage[] = [];

    // Current user prompt
    const cachedSections = options?.cachedSections;
    const currentMessage: AnthropicRequestMessage = (cachedSections && cachedSections.length > 0)
      ? {
        role: ANTHROPIC_MESSAGE_ROLE_USER,
        content: [
          { type: ANTHROPIC_CONTENT_TYPE_TEXT, text: prompt },
        ].map((block, i) =>
          cachedSections.includes(i) ? { ...block, cache_control: { type: ANTHROPIC_CACHE_CONTROL_EPHEMERAL } } : block
        ),
      }
      : {
        role: ANTHROPIC_MESSAGE_ROLE_USER,
        content: [{
          type: ANTHROPIC_CONTENT_TYPE_TEXT,
          text: prompt,
          cache_control: { type: ANTHROPIC_CACHE_CONTROL_EPHEMERAL },
        }],
      };

    if (options?.priorRound) {
      // A completed round leads with the prompt, then replays every original block and every result.
      messages.push(currentMessage, ...priorRoundMessages(options.priorRound, options.toolChoice));
    } else {
      // Legacy single-call replay: the assistant tool_use, its tool_result, then the prompt.
      if (options?.priorTurn) {
        const priorTurn = options.priorTurn;
        // Anthropic requires passing prior thinking blocks back verbatim alongside tool_use.
        const content: AnthropicRequestContentBlock[] = [
          ...(priorTurn.thinkingBlocks?.map((block): AnthropicRequestContentBlock => ({
            type: "thinking",
            thinking: block.thinking,
            signature: block.signature,
          })) ?? []),
          {
            type: ANTHROPIC_CONTENT_TYPE_TOOL_USE,
            id: priorTurn.toolUseId,
            name: priorTurn.toolName,
            input: priorTurn.toolInput,
          },
        ];
        messages.push({
          role: ANTHROPIC_MESSAGE_ROLE_ASSISTANT,
          content,
        });
        messages.push({
          role: ANTHROPIC_MESSAGE_ROLE_USER,
          content: [{
            type: ANTHROPIC_CONTENT_TYPE_TOOL_RESULT,
            tool_use_id: priorTurn.toolUseId,
            content: priorTurn.toolResultContent,
            is_error: priorTurn.toolResultIsError,
          }],
        });
      }
      messages.push(currentMessage);
    }

    const tuning = requestTuning({
      thinking: thinkingRequested,
      maxTokens: options?.max_tokens ?? this.maxTokensDefault,
      thinkingBudget: options?.thinking_budget,
      effort: options?.effort,
    }, rules);
    if (tuning.thinkingOffRefused && this.logger) {
      // The model cannot turn thinking off at this effort, so adaptive thinking was sent. The caller sees it in the journal.
      void this.logger.warn(PROVIDER_EVENT_THINKING_NOT_DISABLED, this.id, {
        model: this.model,
        effort: options?.effort ?? "unset",
      });
    }
    const requestBody: AnthropicRequestBody = {
      model: this.model,
      max_tokens: tuning.maxTokens,
      messages,
      temperature: options?.temperature,
      top_p: options?.top_p,
      stop_sequences: options?.stop,
      thinking: tuning.thinking,
      ...(tuning.outputConfig ? { output_config: tuning.outputConfig } : {}),
      tools: options?.tools?.map(mapToolDefinition),
      tool_choice: options?.toolChoice ? mapToolChoice(options.toolChoice) : undefined,
    };

    try {
      return await this.postMessages(requestBody, options);
    } catch (error) {
      // If a model rejects a deprecated tuning parameter with HTTP 400, strip and retry once.
      if (!(error instanceof Error)) throw error;
      const strippedBody = stripRejectedParameter(requestBody, error);
      if (!strippedBody) throw error;
      return await this.postMessages(strippedBody, options);
    }
  }

  private async postMessages(
    requestBody: AnthropicRequestBody,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    // Debug-level dump of the exact outbound JSON body, validated against the Messages API
    // request contract, so a live-provider failure (malformed request, unexpected 4xx) can be
    // diagnosed from the log without a separate network capture tool.
    if (this.logger) {
      const validation = AnthropicMessagesRequestSchema.safeParse(requestBody);
      void this.logger.debug(PROVIDER_EVENT_REQUEST_DEBUG_DUMP, this.id, {
        provider: "anthropic",
        request_body: toSafeJson(requestBody as never) ?? {},
        valid: validation.success,
        validation_errors: validation.success ? undefined : validation.error.flatten(),
      });
    }

    return await performProviderCall<AnthropicResponse>(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion,
      },
      body: JSON.stringify(requestBody),
      ...(options?.requestSignal ? { signal: options.requestSignal } : {}),
    }, {
      id: this.id,
      traceId: options?.traceId,
      maxAttempts: this.maxRetries,
      retryAfterMaxMs: this.retryAfterMaxMs,
      backoffBaseMs: this.retryDelayMs,
      timeoutMs: this.timeoutMs,
      logger: this.logger,
      tokenMapper: tokenMapperAnthropic(this.model),
      extractor: extractAnthropicContent,
      stopReasonExtractor: (d) => d.stop_reason,
      toolCallExtractor: extractAnthropicToolCalls,
      assistantReplayExtractor: extractAnthropicAssistantReplay,
    });
  }
}

/** Messages that replay one completed round: every original assistant block, then one user message
 *  holding every result. Control text, when the round forbids tools, follows the results. */
function priorRoundMessages(
  round: IProviderToolRound,
  toolChoice: Opt<IToolChoice, Reason.OptionalInput>,
): AnthropicRequestMessage[] {
  if (round.assistant.provider !== PROVIDER_ANTHROPIC) {
    throw new Error("An Anthropic request can only replay an Anthropic round");
  }
  const results = round.calls.map((call) => ({
    type: ANTHROPIC_CONTENT_TYPE_TOOL_RESULT,
    tool_use_id: call.toolUseId,
    content: call.toolResultContent,
    is_error: call.toolResultIsError,
  }));
  const control = toolChoice?.type === ANTHROPIC_TOOL_CHOICE_NONE
    ? [{ type: ANTHROPIC_CONTENT_TYPE_TEXT, text: NATIVE_NO_TOOLS_TEXT_INSTRUCTION }]
    : [];
  return [
    { role: ANTHROPIC_MESSAGE_ROLE_ASSISTANT, content: [...round.assistant.blocks] },
    { role: ANTHROPIC_MESSAGE_ROLE_USER, content: [...results, ...control] },
  ];
}

/** Anthropic message role literal — "user" or "assistant". */
type AnthropicMessageRole = "user" | "assistant";

type AnthropicRequestMessage = {
  role: AnthropicMessageRole;
  content: string | unknown[];
};

/** One outbound assistant content block: a replayed thinking block or a tool_use block. */
type AnthropicRequestContentBlock =
  | {
    type: "thinking";
    thinking: string;
    signature: string;
  }
  | {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, JSONValue>;
  };

type AnthropicRequestBody = {
  model: string;
  max_tokens: number;
  messages: AnthropicRequestMessage[];
  temperature?: Opt<number, Reason.OptionalInput>;
  top_p?: Opt<number, Reason.OptionalInput>;
  stop_sequences?: Opt<string[], Reason.OptionalInput>;
  thinking?: Opt<{ type: string; budget_tokens?: number }, Reason.OptionalInput>;
  output_config?: Opt<{ effort: string }, Reason.OptionalInput>;
  tools?: AnthropicWireTool[];
  tool_choice?: AnthropicWireToolChoice;
};

/** Anthropic wire-format tool definition (snake_case fields). */
type AnthropicWireTool = {
  name: string;
  input_schema: Record<string, JSONValue>;
  description?: string;
  type?: string;
  strict?: boolean;
  cache_control?: { type: "ephemeral"; ttl?: string };
  input_examples?: Record<string, JSONValue>[];
};

/** Anthropic wire-format tool_choice. */
type AnthropicWireToolChoice =
  | { type: "auto"; disable_parallel_tool_use?: boolean }
  | { type: "any"; disable_parallel_tool_use?: boolean }
  | { type: "tool"; name: string; disable_parallel_tool_use?: boolean }
  | { type: "none" };

/** Map IToolDefinition to Anthropic's wire-format tool object. */
function mapToolDefinition(tool: IToolDefinition): AnthropicWireTool {
  const mapped: AnthropicWireTool = {
    name: tool.name,
    input_schema: tool.inputSchema,
  };
  if (tool.description !== undefined) mapped.description = tool.description;
  if (tool.type !== undefined) mapped.type = tool.type;
  if (tool.strict !== undefined) mapped.strict = tool.strict;
  if (tool.cache_control !== undefined) mapped.cache_control = tool.cache_control;
  if (tool.input_examples !== undefined) mapped.input_examples = tool.input_examples;
  return mapped;
}

/** Map IToolChoice to Anthropic's wire-format tool_choice. */
function mapToolChoice(choice: IToolChoice): AnthropicWireToolChoice {
  if (choice.type === ANTHROPIC_TOOL_CHOICE_NONE) return { type: ANTHROPIC_TOOL_CHOICE_NONE };
  return {
    type: choice.type,
    ...(choice.type === ANTHROPIC_TOOL_CHOICE_TOOL ? { name: choice.name } : {}),
    ...(choice.disable_parallel_tool_use !== undefined
      ? { disable_parallel_tool_use: choice.disable_parallel_tool_use }
      : {}),
  } as AnthropicWireToolChoice;
}

/** Matches Anthropic's 400 wording when a request parameter is rejected for the model. */
const REJECTED_PARAM_PATTERN = /`(\w+)` is (?:deprecated|not supported)/;

/** Returns a copy of requestBody with the parameter named in a 400 error removed, or null. */
function stripRejectedParameter(
  requestBody: AnthropicRequestBody,
  error: Error,
): AnthropicRequestBody | null {
  if (!error.message.includes("HTTP 400")) return null;
  const match = error.message.match(REJECTED_PARAM_PATTERN);
  if (!match) return null;
  const param = match[1] as keyof AnthropicRequestBody;
  if (requestBody[param] === undefined) return null;
  const stripped = { ...requestBody };
  delete stripped[param];
  return stripped;
}
