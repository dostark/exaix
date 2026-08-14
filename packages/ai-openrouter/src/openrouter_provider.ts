/**
 * @module OpenRouterProvider
 * @path packages/ai-openrouter/src/openrouter_provider.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_factory.ts", "packages/ai-openrouter/src/constants.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/ai/providers", "@exaix/ai/provider_common_utils.ts"]
 * @description OpenRouter provider over the OpenAI-compatible gateway. Reuses the shared
 * OpenAI request/response helpers and adds OpenRouter's HTTP-Referer / X-Title ranking headers.
 */

import {
  buildOpenAiMessages,
  extractOpenAIContent,
  extractOpenAIToolCalls,
  mapToolChoiceOpenAI,
  mapToolDefinitionOpenAI,
  type OpenAiChatMessage,
  type OpenAiWireToolChoice,
  type OpenAiWireToolDefinition,
  performProviderCall,
} from "@exaix/ai/provider_common_utils.ts";
import { type IOpenRouterResponse, tokenMapperOpenRouter } from "./openrouter_reported_cost.ts";
import { BaseProvider, type IBaseProviderOptions, type IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions } from "@exaix/ai/types.ts";
import {
  DEFAULT_OPENROUTER_ENDPOINT,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_RETRY_BACKOFF_MS,
  DEFAULT_OPENROUTER_RETRY_MAX_ATTEMPTS,
  DEFAULT_OPENROUTER_TIMEOUT_MS,
  HTTP_REFERER_HEADER,
  OPENROUTER_DEFAULT_SITE_NAME,
  OPENROUTER_DEFAULT_SITE_URL,
  PROVIDER_OPENROUTER,
  X_TITLE_HEADER,
} from "./constants.ts";
import type { Opt, Reason } from "@exaix/core/types";

export type OpenRouterSortStrategy = "throughput" | "latency" | "cost";
export type OpenRouterDataCollection = "allow" | "deny";

/** OpenRouter control-surface passthrough: provider routing, fallback models, privacy (Phase 123 R10). */
export interface IOpenRouterRouting {
  models?: string[];
  provider?: {
    order?: string[];
    only?: string[];
    ignore?: string[];
    sort?: OpenRouterSortStrategy;
    max_price?: {
      prompt?: number;
      completion?: number;
      request?: number;
      image?: number;
    };
  };
  zdr?: boolean;
  data_collection?: OpenRouterDataCollection;
}

/** Internal request-body shape for serialization. `messages`/`tools`/`tool_choice` reuse the
 *  same OpenAI Chat Completions shape Step 2 built (packages/ai/src/provider_common_utils.ts) -
 *  OpenRouter is a confirmed byte-for-byte pass-through of that contract. */
interface OpenRouterRequestBody {
  model: string;
  messages: OpenAiChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  models?: string[];
  provider?: OpenRouterProviderBody;
  /** Phase 135: request OpenRouter's reported usage.cost in the response. */
  usage?: { include: boolean };
  tools?: OpenAiWireToolDefinition[];
  tool_choice?: OpenAiWireToolChoice;
}

interface OpenRouterProviderBody {
  order?: string[];
  only?: string[];
  ignore?: string[];
  sort?: OpenRouterSortStrategy;
  max_price?: { prompt?: number; completion?: number; request?: number; image?: number };
  zdr?: boolean;
  data_collection?: OpenRouterDataCollection;
}

/** Options for OpenRouterProvider. `siteName`/`siteUrl` populate OpenRouter ranking headers. */
export type OpenRouterProviderOptions = IBaseProviderOptions & {
  siteName?: string;
  siteUrl?: string;
  /** Control-surface passthrough: serialized into the request body alongside model/messages. */
  routing?: IOpenRouterRouting;
};

/**
 * OpenRouterProvider implements IModelProvider over the OpenAI-compatible OpenRouter gateway.
 */
export class OpenRouterProvider extends BaseProvider {
  private readonly siteName: string;
  private readonly siteUrl: string;
  private readonly routing?: IOpenRouterRouting;

  constructor(options: OpenRouterProviderOptions) {
    super({
      ...options,
      defaultModel: DEFAULT_OPENROUTER_MODEL,
      defaultEndpoint: options.baseUrl || DEFAULT_OPENROUTER_ENDPOINT,
      defaultTimeout: options.timeoutMs || DEFAULT_OPENROUTER_TIMEOUT_MS,
      defaultRetryDelay: options.retryDelayMs || DEFAULT_OPENROUTER_RETRY_BACKOFF_MS,
      defaultMaxRetries: options.maxRetries || DEFAULT_OPENROUTER_RETRY_MAX_ATTEMPTS,
    }, PROVIDER_OPENROUTER);
    this.siteName = options.siteName ?? OPENROUTER_DEFAULT_SITE_NAME;
    this.siteUrl = options.siteUrl ?? OPENROUTER_DEFAULT_SITE_URL;
    this.routing = options.routing;
  }

  /** Build the request body with optional OpenRouter routing fields injected. */
  private buildRequestBody(
    prompt: string,
    options?: Opt<IModelOptions, Reason.AbstractBoundary>,
  ): OpenRouterRequestBody {
    const body: OpenRouterRequestBody = {
      model: this.model,
      messages: buildOpenAiMessages(prompt, options?.priorTurn),
      // Phase 135 (F6/G9): ask OpenRouter to report the authoritative cost.
      usage: { include: true },
    };
    if (options?.max_tokens !== undefined) body.max_tokens = options.max_tokens;
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.top_p !== undefined) body.top_p = options.top_p;
    if (options?.stop !== undefined) body.stop = options.stop;
    if (options?.tools !== undefined) body.tools = options.tools.map(mapToolDefinitionOpenAI);
    if (options?.toolChoice !== undefined) body.tool_choice = mapToolChoiceOpenAI(options.toolChoice);

    if (this.routing) {
      if (this.routing.models !== undefined) {
        body.models = this.routing.models;
      }
      const rp: OpenRouterProviderBody = this.routing.provider ? { ...this.routing.provider } : {};
      if (this.routing.zdr !== undefined) rp.zdr = this.routing.zdr;
      if (this.routing.data_collection !== undefined) rp.data_collection = this.routing.data_collection;
      if (Object.keys(rp).length > 0) {
        body.provider = rp;
      }
    }

    return body;
  }

  protected override async attemptGenerate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.AbstractBoundary>,
  ): Promise<IGenerateResult> {
    const body = this.buildRequestBody(prompt, options);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      [HTTP_REFERER_HEADER]: this.siteUrl,
      [X_TITLE_HEADER]: this.siteName,
    };

    return await performProviderCall<IOpenRouterResponse>(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, {
      id: this.id,
      maxAttempts: this.maxRetries,
      backoffBaseMs: this.retryDelayMs,
      timeoutMs: this.timeoutMs,
      logger: this.logger,
      tokenMapper: tokenMapperOpenRouter(this.model),
      extractor: extractOpenAIContent,
      toolCallExtractor: extractOpenAIToolCalls,
    });
  }
}
