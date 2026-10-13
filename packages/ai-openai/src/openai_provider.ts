/**
 * @module OpenAIPackageProvider
 * @path packages/ai-openai/src/openai_provider.ts
 * @description OpenAI provider. Calls to OpenAI itself use the Responses API. OpenAI-compatible servers (the openai-chat
 *   adapter) keep the Chat Completions wire, because most of them implement only that.
 * @architectural-layer AI
 * @related-files [packages/ai-openai/src/openai_factory.ts, packages/ai-openai/src/compatible_chat.ts, packages/ai/src/openai_responses_wire.ts]
 */

import {
  DEFAULT_OPENAI_ENDPOINT,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_RETRY_BACKOFF_MS,
  DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS,
  DEFAULT_OPENAI_TIMEOUT_MS,
  OPENAI_CHAT_COMPLETIONS_PATH,
  OPENAI_RESPONSES_PATH,
} from "./constants.ts";
import {
  COMPATIBLE_REDIRECT_POLICY,
  extractOpenAIAssistantReplay,
  extractOpenAICompatibleToolCalls,
  extractOpenAIContent,
  type OpenAIResponse,
  performProviderCall,
} from "@exaix/ai/provider_common_utils.ts";
import { BaseProvider, type IBaseProviderOptions, type IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions } from "@exaix/ai/types.ts";
import { assertSupportedCallOptions, type IProviderCallCapabilities } from "@exaix/ai";
import type { CompatibleChatConfig } from "@exaix/schemas";
import type { IModelPricing, IModelPricingLookup, Opt, Reason } from "@exaix/core/types";
import { createCompatibleChatRequestInit, mapCompatibleUsage, validateCompatibleResponse } from "./compatible_chat.ts";
import {
  type INativeInputMeasurement,
  measureOpenAiChatProjection,
  measureOpenAiResponsesProjection,
  priceCompatibleUsage,
} from "@exaix/ai";
import {
  assertResponsesNotFailed,
  createOpenAIResponsesRequestInit,
  extractResponsesAssistantReplay,
  extractResponsesContent,
  extractResponsesToolCalls,
  type IResponsesResponse,
  tokenMapperResponses,
} from "@exaix/ai/openai_responses_wire.ts";
import { AiTokenEstimatorTokenizer, type ITokenizer } from "@exaix/core/func";
import {
  type JSONValue,
  OPENAI_COMPATIBLE_LOCAL_PROFILE,
  OPENAI_COMPATIBLE_SELF_HOSTED_PROFILE,
  OPENAI_COMPATIBLE_UNPRICED_PROFILES,
  ProviderType,
} from "@exaix/core";

/**
 * Options for OpenAIProvider.
 */
export interface IOpenAIProviderOptions extends IBaseProviderOptions {
  compatible?: CompatibleChatConfig;
  tokenizer?: ITokenizer;
  pricingLookup?: IModelPricingLookup;
}

class CompatibleRequestTimeoutError extends Error {
  constructor(providerId: string, timeoutMs: number) {
    super(`Provider ${providerId} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/** The /v1/responses URL on the host of the configured Chat Completions endpoint. */
function responsesEndpointFor(chatEndpoint: string): string {
  if (!chatEndpoint.endsWith(OPENAI_CHAT_COMPLETIONS_PATH)) {
    throw new Error(
      `OpenAI Responses calls need a chat completions endpoint ending in ${OPENAI_CHAT_COMPLETIONS_PATH}`,
    );
  }
  return `${chatEndpoint.slice(0, -OPENAI_CHAT_COMPLETIONS_PATH.length)}${OPENAI_RESPONSES_PATH}`;
}

/**
 * OpenAIProvider implements IModelProvider for OpenAI GPT models. Native calls use the Responses API. Compatible
 * servers, configured with a profile, use Chat Completions.
 */
export class OpenAIProvider extends BaseProvider {
  readonly callCapabilities?: IProviderCallCapabilities;
  private readonly compatible: boolean;
  private readonly compatibleConfig?: CompatibleChatConfig;
  private readonly tokenizer: ITokenizer;
  private readonly pricingLookup?: IModelPricingLookup;

  constructor(options: IOpenAIProviderOptions) {
    super({
      ...options,
      defaultModel: DEFAULT_OPENAI_MODEL,
      defaultEndpoint: options.compatible?.endpoint ??
        (options.config?.ai_endpoints?.[options.compatible ? ProviderType.OPENAI_CHAT : ProviderType.OPENAI] ||
          DEFAULT_OPENAI_ENDPOINT),
      defaultTimeout:
        options.config?.ai_timeout?.providers?.[options.compatible ? ProviderType.OPENAI_CHAT : ProviderType.OPENAI] ??
          DEFAULT_OPENAI_TIMEOUT_MS,
      defaultRetryDelay:
        options.config?.ai_retry?.providers?.[options.compatible ? ProviderType.OPENAI_CHAT : ProviderType.OPENAI]
          ?.backoff_base_ms ??
          DEFAULT_OPENAI_RETRY_BACKOFF_MS,
      defaultMaxRetries:
        options.config?.ai_retry?.providers?.[options.compatible ? ProviderType.OPENAI_CHAT : ProviderType.OPENAI]
          ?.max_attempts ??
          DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS,
    }, options.compatible ? ProviderType.OPENAI_CHAT : ProviderType.OPENAI);
    this.compatible = options.compatible !== undefined;
    this.compatibleConfig = options.compatible ? Object.freeze({ ...options.compatible }) : undefined;
    this.tokenizer = options.tokenizer ?? new AiTokenEstimatorTokenizer();
    this.pricingLookup = options.pricingLookup;
    if (this.compatibleConfig) {
      const profile = this.compatibleConfig.profile;
      const isDeepSeek = profile === "deepseek";
      const isLocal = profile === OPENAI_COMPATIBLE_LOCAL_PROFILE;
      // Only DeepSeek and the local fixture support explicit thinking and effort.
      // DeepSeek maps effort only while thinking is enabled.
      this.callCapabilities = Object.freeze({
        profile,
        supportsThinking: isLocal || isDeepSeek,
        supportedEffortTiers: Object.freeze(isLocal || isDeepSeek ? ["low", "medium", "high"] as const : []),
        // DeepSeek thinking mode accepts tool_choice "auto" only.
        ...(isDeepSeek ? { effortRequiresThinking: true, supportsForcedToolChoiceWithThinking: false } : {}),
        // A self-hosted service declares whether it honors an explicit tool_choice.
        ...(profile === OPENAI_COMPATIBLE_SELF_HOSTED_PROFILE &&
            this.compatibleConfig.supports_tool_choice !== true
          ? { supportsToolChoice: false }
          : {}),
      });
    }
  }

  async measureInputTokens(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<INativeInputMeasurement> {
    if (!this.compatible) {
      const projection = JSON.parse(
        createOpenAIResponsesRequestInit("", this.model, prompt, options).body as string,
      ) as Record<string, JSONValue>;
      return await measureOpenAiResponsesProjection(
        this.tokenizer,
        this.model,
        projection.input as JSONValue[],
        projection.tools ?? [],
        prompt,
        options,
      );
    }
    const request =
      createCompatibleChatRequestInit("", this.model, prompt, options, this.compatibleConfig?.profile).init;
    const projection = JSON.parse(request.body as string) as Record<string, JSONValue>;
    return await measureOpenAiChatProjection(
      this.tokenizer,
      this.model,
      projection.messages as JSONValue[],
      projection.tools ?? [],
      prompt,
      options,
    );
  }

  async estimateCallCost(inputTokens: number, outputTokens: number): Promise<number | undefined> {
    if (!this.compatibleConfig) return undefined;
    const pricing = await this.getCompatiblePricing(this.model);
    return priceCompatibleUsage(this.compatibleConfig.profile, this.model, {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    }, pricing).cost_usd;
  }

  private async getCompatiblePricing(model: string): Promise<IModelPricing | undefined> {
    const profile = this.compatibleConfig?.profile;
    if (!profile || OPENAI_COMPATIBLE_UNPRICED_PROFILES.includes(profile)) return undefined;
    try {
      return await this.pricingLookup?.getModelPricing(profile, model);
    } catch {
      return undefined;
    }
  }

  override async generate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    if (!this.compatible) return await super.generate(prompt, options);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.timeoutMs);
    try {
      const requestSignal = options?.requestSignal
        ? AbortSignal.any([deadline.signal, options.requestSignal])
        : deadline.signal;
      return await super.generate(prompt, { ...options, requestSignal });
    } catch (error) {
      if (deadline.signal.aborted) throw new CompatibleRequestTimeoutError(this.id, this.timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** One call to /v1/responses on OpenAI. The reply's output items are kept so the next round can replay them. */
  private async attemptResponsesGenerate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    return await performProviderCall<IResponsesResponse>(
      responsesEndpointFor(this.baseUrl),
      createOpenAIResponsesRequestInit(this.apiKey, this.model, prompt, options),
      {
        id: this.id,
        traceId: options?.traceId,
        maxAttempts: this.maxRetries,
        backoffBaseMs: this.retryDelayMs,
        timeoutMs: this.timeoutMs,
        logger: this.logger,
        tokenMapper: tokenMapperResponses(this.model),
        extractor: extractResponsesContent,
        toolCallExtractor: extractResponsesToolCalls,
        assistantReplayExtractor: extractResponsesAssistantReplay,
        responseValidator: (response) => {
          assertResponsesNotFailed(response, this.id);
          return response;
        },
      },
    );
  }

  /** One call to an OpenAI-compatible server over Chat Completions, under the profile's request and reply rules. */
  private async attemptCompatibleGenerate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    const config = this.compatibleConfig!;
    const compatibleRequest = createCompatibleChatRequestInit(this.apiKey, this.model, prompt, options, config.profile);
    const result = await performProviderCall<OpenAIResponse>(
      this.baseUrl,
      compatibleRequest.init,
      {
        id: this.id,
        traceId: options?.traceId,
        maxAttempts: this.maxRetries,
        logRetries: false,
        backoffBaseMs: this.retryDelayMs,
        logger: this.logger,
        tokenMapper: mapCompatibleUsage,
        responseValidator: (response: OpenAIResponse) =>
          validateCompatibleResponse(response, this.id, config.max_tool_argument_bytes, options, config.profile),
        extractor: extractOpenAIContent,
        assistantReplayExtractor: (response: OpenAIResponse) =>
          extractOpenAIAssistantReplay(response, ProviderType.OPENAI_CHAT),
        toolCallExtractor: (response: OpenAIResponse) =>
          extractOpenAICompatibleToolCalls(response, config.max_tool_argument_bytes, this.id),
        maxResponseBytes: config.max_response_bytes,
        maxRequestBytes: config.max_history_bytes,
        exposeRemoteErrorText: false,
        logResponseBody: false,
        redirectBehavior: COMPATIBLE_REDIRECT_POLICY,
      },
    );
    const pricing = await this.getCompatiblePricing(result.model);
    return {
      ...result,
      ...priceCompatibleUsage(config.profile, result.model, result.usage, pricing),
      ...(compatibleRequest.structuredOutputMode
        ? {
          structuredOutputMode: compatibleRequest.structuredOutputMode,
          ...(compatibleRequest.structuredOutputModeReason
            ? { structuredOutputModeReason: compatibleRequest.structuredOutputModeReason }
            : {}),
        }
        : {}),
    };
  }

  protected override async attemptGenerate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    if (this.callCapabilities) assertSupportedCallOptions(options, this.callCapabilities);
    return this.compatible
      ? await this.attemptCompatibleGenerate(prompt, options)
      : await this.attemptResponsesGenerate(prompt, options);
  }
}
