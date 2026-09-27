/**
 * @module OpenAIPackageProvider
 * @path packages/ai-openai/src/openai_provider.ts
 * @description OpenAI GPT provider implementation owned by the @exaix/ai-openai package.
 * @architectural-layer AI
 * @related-files [packages/ai-openai/src/openai_factory.ts, packages/ai-openai/src/openai_provider.ts]
 */

import {
  DEFAULT_OPENAI_ENDPOINT,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_RETRY_BACKOFF_MS,
  DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS,
  DEFAULT_OPENAI_TIMEOUT_MS,
} from "./constants.ts";
import {
  COMPATIBLE_REDIRECT_POLICY,
  createOpenAIChatCompletionsRequestInit,
  extractOpenAICompatibleToolCalls,
  extractOpenAIContent,
  extractOpenAIToolCalls,
  type OpenAIResponse,
  performProviderCall,
  tokenMapperOpenAI,
} from "@exaix/ai/provider_common_utils.ts";
import { BaseProvider, type IBaseProviderOptions, type IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions } from "@exaix/ai/types.ts";
import { assertSupportedCallOptions, type IProviderCallCapabilities } from "@exaix/ai";
import type { CompatibleChatConfig } from "@exaix/schemas";
import { PromptBudgetSection } from "@exaix/schemas/prompt_budget.ts";
import type { IModelPricing, IModelPricingLookup, Opt, Reason } from "@exaix/core/types";
import { createCompatibleChatRequestInit, mapCompatibleUsage, validateCompatibleResponse } from "./compatible_chat.ts";
import { type INativeInputMeasurement, measureNativeConversation, priceCompatibleUsage } from "@exaix/ai";
import { AiTokenEstimatorTokenizer, type ITokenizer } from "@exaix/core/func";
import { type JSONValue, OPENAI_COMPATIBLE_LOCAL_PROFILE, ProviderType } from "@exaix/core";

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

/**
 * OpenAIProvider implements IModelProvider for OpenAI-compatible GPT models.
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
      // OpenAI's pinned nonreasoning model rejects explicit thinking/effort; DeepSeek's
      // documented thinking mode and the scripted local fixture both support it. DeepSeek's
      // effort mapping applies only when thinking is enabled (Wire Profiles contract).
      this.callCapabilities = Object.freeze({
        profile,
        supportsThinking: isLocal || isDeepSeek,
        supportedEffortTiers: Object.freeze(isLocal || isDeepSeek ? ["low", "medium", "high"] as const : []),
        ...(isDeepSeek ? { effortRequiresThinking: true } : {}),
      });
    }
  }

  async measureInputTokens(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<INativeInputMeasurement> {
    const request = this.compatible
      ? createCompatibleChatRequestInit("", this.model, prompt, options, this.compatibleConfig?.profile)
      : createOpenAIChatCompletionsRequestInit("", this.model, prompt, options);
    const projection = JSON.parse(request.body as string) as Record<string, JSONValue>;
    const snapshot = options?.nativeConversation;
    const messages = projection.messages as JSONValue[];
    const historyMessages = snapshot ? messages.slice(1, 1 + snapshot.turns.length * 2) : [];
    return await measureNativeConversation(this.tokenizer, this.model, { messages, tools: projection.tools ?? [] }, [
      ...(snapshot?.initialPromptSections ?? [{ section: PromptBudgetSection.SYSTEM, text: prompt }]),
      ...(historyMessages.length
        ? [{ section: PromptBudgetSection.LOOP_HISTORY, text: JSON.stringify(historyMessages) }]
        : []),
    ]);
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
    if (!profile || profile === OPENAI_COMPATIBLE_LOCAL_PROFILE) return undefined;
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

  protected override async attemptGenerate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    if (this.callCapabilities) assertSupportedCallOptions(options, this.callCapabilities);
    const callOptions = options;
    const result = await performProviderCall<OpenAIResponse>(
      this.baseUrl,
      this.compatible
        ? createCompatibleChatRequestInit(this.apiKey, this.model, prompt, callOptions, this.compatibleConfig?.profile)
        : createOpenAIChatCompletionsRequestInit(this.apiKey, this.model, prompt, callOptions),
      {
        id: this.id,
        maxAttempts: this.compatible ? 1 : this.maxRetries,
        backoffBaseMs: this.retryDelayMs,
        timeoutMs: this.compatible ? undefined : this.timeoutMs,
        logger: this.logger,
        tokenMapper: this.compatible ? mapCompatibleUsage : tokenMapperOpenAI(this.model),
        ...(this.compatible
          ? {
            responseValidator: (response: OpenAIResponse) =>
              validateCompatibleResponse(
                response,
                this.id,
                this.compatibleConfig!.max_tool_argument_bytes,
                callOptions,
              ),
          }
          : {}),
        extractor: extractOpenAIContent,
        toolCallExtractor: this.compatible
          ? (response) =>
            extractOpenAICompatibleToolCalls(
              response,
              this.compatibleConfig!.max_tool_argument_bytes,
              this.id,
            )
          : extractOpenAIToolCalls,
        ...(this.compatible
          ? {
            maxResponseBytes: this.compatibleConfig?.max_response_bytes,
            maxRequestBytes: this.compatibleConfig?.max_history_bytes,
            exposeRemoteErrorText: false,
            logResponseBody: false,
            redirectBehavior: COMPATIBLE_REDIRECT_POLICY,
          }
          : {}),
      },
    );
    if (!this.compatibleConfig) return result;
    const profile = this.compatibleConfig.profile;
    const pricing = await this.getCompatiblePricing(result.model);
    return { ...result, ...priceCompatibleUsage(profile, result.model, result.usage, pricing) };
  }
}
