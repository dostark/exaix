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
  disablesParallelToolUse,
  extractOpenAIAssistantReplay,
  extractOpenAIToolCalls,
  mapToolChoiceOpenAI,
  mapToolDefinitionOpenAI,
  type OpenAiChatMessage,
  type OpenAiWireToolChoice,
  type OpenAiWireToolDefinition,
  performProviderCall,
} from "@exaix/ai/provider_common_utils.ts";
import { type IOpenRouterResponse, tokenMapperOpenRouter } from "./openrouter_reported_cost.ts";
import { mapOpenRouterError, OpenRouterRoutingError } from "./openrouter_errors.ts";
import {
  applyRequireParameters,
  applySessionKey,
  dropUnlistedHints,
  needsCapabilityEntry,
} from "./openrouter_routing.ts";
import {
  estimatorModelFor,
  type IOpenRouterCapabilitySource,
  type IOpenRouterModelEntry,
} from "./openrouter_model_capabilities.ts";
import { ProviderCallPolicyError } from "@exaix/ai/errors.ts";
import { reasoningFor } from "./openrouter_reasoning.ts";
import { extractOpenRouterContent, extractOpenRouterFinishReason } from "./openrouter_response.ts";
import { applyCacheControl, type IOpenRouterChatMessage } from "./openrouter_cache_control.ts";
import {
  applyJsonModeInstruction,
  completeStructuredOutput,
  planOpenRouterOutput,
  planRouteFallback,
} from "./openrouter_structured_output.ts";
import type { OPENROUTER_QUANTIZATIONS } from "@exaix/schemas";
import { BaseProvider, type IBaseProviderOptions, type IGenerateResult } from "@exaix/ai/providers";
import type { IStructuredOutputPlan } from "@exaix/ai";
import type { IModelOptions } from "@exaix/ai/types.ts";
import { type INativeInputMeasurement, measureOpenAiChatProjection } from "@exaix/ai";
import { AiTokenEstimatorTokenizer, type ITokenizer } from "@exaix/core/func";
import type { JSONValue } from "@exaix/core";
import {
  DEFAULT_OPENROUTER_ENDPOINT,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_RETRY_BACKOFF_MS,
  DEFAULT_OPENROUTER_RETRY_MAX_ATTEMPTS,
  DEFAULT_OPENROUTER_TIMEOUT_MS,
  HTTP_REFERER_HEADER,
  OPENROUTER_DEFAULT_SITE_NAME,
  OPENROUTER_DEFAULT_SITE_URL,
  OPENROUTER_TOOLS_PARAMETER,
  PROVIDER_OPENROUTER,
  X_TITLE_HEADER,
} from "./constants.ts";
import type { Opt, Reason } from "@exaix/core/types";

export type OpenRouterSortStrategy = "throughput" | "latency" | "cost";
export type OpenRouterDataCollection = "allow" | "deny";
export type OpenRouterQuantization = (typeof OPENROUTER_QUANTIZATIONS)[number];

/** OpenRouter passthrough for provider routing, fallback models, and privacy. */
export interface IOpenRouterRouting {
  models?: string[];
  provider?: {
    order?: string[];
    only?: string[];
    ignore?: string[];
    sort?: OpenRouterSortStrategy;
    require_parameters?: boolean;
    allow_fallbacks?: boolean;
    quantizations?: OpenRouterQuantization[];
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

/** OpenRouter messages add cache breakpoints to the OpenAI Chat Completions contract. Tools keep the shared wire shape. */
interface OpenRouterRequestBody {
  model: string;
  messages: IOpenRouterChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  models?: string[];
  provider?: OpenRouterProviderBody;
  tools?: OpenAiWireToolDefinition[];
  tool_choice?: OpenAiWireToolChoice;
  /** Off asks for one call per response. Auto omits the field, so the API default applies. */
  parallel_tool_calls?: boolean;
  response_format?: Record<string, JSONValue>;
  reasoning?: Record<string, JSONValue>;
  /** Sticky routing key. OpenRouter ignores it when a manual provider order is set. */
  session_id?: string;
}

type OpenRouterProviderBody = NonNullable<IOpenRouterRouting["provider"]> & {
  zdr?: boolean;
  data_collection?: OpenRouterDataCollection;
};

/** Copies the sampling, stop and tool options that map one to one onto the OpenAI-shaped body. */
function applyRequestOptions(
  body: OpenRouterRequestBody,
  options: Opt<IModelOptions, Reason.AbstractBoundary>,
): void {
  if (options?.max_tokens !== undefined) body.max_tokens = options.max_tokens;
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.top_p !== undefined) body.top_p = options.top_p;
  if (options?.stop !== undefined) body.stop = options.stop;
  if (options?.tools !== undefined) body.tools = options.tools.map(mapToolDefinitionOpenAI);
  if (options?.toolChoice !== undefined) body.tool_choice = mapToolChoiceOpenAI(options.toolChoice);
  if (options?.tools?.length && disablesParallelToolUse(options.toolChoice)) body.parallel_tool_calls = false;
}

/** Copies the operator's routing block, fallback models and privacy flags onto the body. */
function applyRouting(body: OpenRouterRequestBody, routing: Opt<IOpenRouterRouting, Reason.OptionalContext>): void {
  if (!routing) return;
  if (routing.models !== undefined) body.models = routing.models;
  const rp: OpenRouterProviderBody = routing.provider ? { ...routing.provider } : {};
  if (routing.zdr !== undefined) rp.zdr = routing.zdr;
  if (routing.data_collection !== undefined) rp.data_collection = routing.data_collection;
  if (Object.keys(rp).length > 0) body.provider = rp;
}

/** Options for OpenRouterProvider. `siteName`/`siteUrl` populate OpenRouter ranking headers. */
export type OpenRouterProviderOptions = IBaseProviderOptions & {
  siteName?: string;
  siteUrl?: string;
  /** Control-surface passthrough: serialized into the request body alongside model/messages. */
  routing?: IOpenRouterRouting;
  tokenizer?: ITokenizer;
  /** Per-model capability lookup. Absent means no capability check, so a direct construction never fetches. */
  capabilities?: IOpenRouterCapabilitySource;
  /** Enables an explicit cache breakpoint on a supported model's initial prompt. */
  cacheControl?: boolean;
};

/**
 * OpenRouterProvider implements IModelProvider over the OpenAI-compatible OpenRouter gateway.
 */
export class OpenRouterProvider extends BaseProvider {
  private readonly siteName: string;
  private readonly siteUrl: string;
  private readonly routing?: IOpenRouterRouting;
  private readonly tokenizer: ITokenizer;
  private readonly capabilities?: IOpenRouterCapabilitySource;
  private readonly cacheControl: boolean;

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
    this.tokenizer = options.tokenizer ?? new AiTokenEstimatorTokenizer();
    this.capabilities = options.capabilities;
    this.cacheControl = options.cacheControl ?? true;
  }

  /** Measures the request exactly as dispatched: the serialized body, with its prompt, replayed history and tools. */
  async measureInputTokens(
    prompt: string,
    options?: Opt<IModelOptions, Reason.AbstractBoundary>,
  ): Promise<INativeInputMeasurement> {
    const projection = JSON.parse(JSON.stringify(this.buildRequestBody(prompt, options))) as Record<string, JSONValue>;
    const entry = await this.capabilities?.getEntry(this.model, options?.traceId);
    return await measureOpenAiChatProjection(
      this.tokenizer,
      estimatorModelFor(entry, this.model),
      projection.messages as JSONValue[],
      projection.tools ?? [],
      prompt,
      options,
    );
  }

  /** Build the request body with optional OpenRouter routing fields injected. */
  private buildRequestBody(
    prompt: string,
    options?: Opt<IModelOptions, Reason.AbstractBoundary>,
    plan: Opt<IStructuredOutputPlan, Reason.OptionalContext> = this.planOutput(options),
    entry?: Opt<IOpenRouterModelEntry, Reason.OptionalContext>,
  ): OpenRouterRequestBody {
    const messages: OpenAiChatMessage[] = buildOpenAiMessages(
      prompt,
      options?.priorTurn,
      options?.nativeConversation,
      options?.priorRound,
    );
    const body: OpenRouterRequestBody = {
      model: this.model,
      messages,
    };
    applyRequestOptions(body, options);
    dropUnlistedHints(body, entry);
    const reasoning = reasoningFor(options, entry);
    if (reasoning) body.reasoning = reasoning;
    if (plan) {
      body.response_format = plan.responseFormat;
      if (plan.promptInstruction) applyJsonModeInstruction(messages, prompt, plan.promptInstruction, this.id);
    }
    body.messages = applyCacheControl(messages, this.model, this.cacheControl);
    applyRouting(body, this.routing);
    applyRequireParameters(body);
    applySessionKey(body, options?.traceId);

    return body;
  }

  private planOutput(
    options?: Opt<IModelOptions, Reason.AbstractBoundary>,
  ): Opt<IStructuredOutputPlan, Reason.OptionalContext> {
    return options?.jsonSchema ? planOpenRouterOutput(options.jsonSchema, this.id) : undefined;
  }

  /** The model's capability entry, fetched only when the call carries a feature or a hint that depends on it. */
  private async lookupEntry(
    options: Opt<IModelOptions, Reason.AbstractBoundary>,
  ): Promise<Opt<IOpenRouterModelEntry, Reason.OptionalContext>> {
    if (!this.capabilities || !needsCapabilityEntry(options)) return undefined;
    return await this.capabilities.getEntry(this.model, options?.traceId);
  }

  /** Refuses a tool-using request when the model's entry exists and lists no `tools` support. */
  private assertToolsSupported(
    options: Opt<IModelOptions, Reason.AbstractBoundary>,
    entry: Opt<IOpenRouterModelEntry, Reason.OptionalContext>,
  ): void {
    if (options?.tools?.length && entry && !entry.supportedParameters.includes(OPENROUTER_TOOLS_PARAMETER)) {
      throw new ProviderCallPolicyError("unsupported_call_option", PROVIDER_OPENROUTER);
    }
  }

  /** Sends the strongest plan first. A route that refuses json_schema gets one json_object retry, and no weaker mode. */
  protected override async attemptGenerate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.AbstractBoundary>,
  ): Promise<IGenerateResult> {
    const entry = await this.lookupEntry(options);
    this.assertToolsSupported(options, entry);
    const plan = this.planOutput(options);
    try {
      return await this.sendRequest(prompt, options, plan, entry);
    } catch (error) {
      if (!options?.jsonSchema || plan?.mode !== "json_schema" || !(error instanceof OpenRouterRoutingError)) {
        throw error;
      }
    }
    return await this.sendRequest(prompt, options, planRouteFallback(options.jsonSchema), entry);
  }

  private async sendRequest(
    prompt: string,
    options: Opt<IModelOptions, Reason.AbstractBoundary>,
    plan: Opt<IStructuredOutputPlan, Reason.OptionalContext>,
    entry: Opt<IOpenRouterModelEntry, Reason.OptionalContext>,
  ): Promise<IGenerateResult> {
    const body = this.buildRequestBody(prompt, options, plan, entry);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      [HTTP_REFERER_HEADER]: this.siteUrl,
      [X_TITLE_HEADER]: this.siteName,
    };

    const result = await performProviderCall<IOpenRouterResponse>(this.baseUrl, {
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
      errorMapper: mapOpenRouterError,
      extractor: (response) => extractOpenRouterContent(response, this.id),
      stopReasonExtractor: extractOpenRouterFinishReason,
      toolCallExtractor: extractOpenAIToolCalls,
      assistantReplayExtractor: (response) => extractOpenAIAssistantReplay(response, PROVIDER_OPENROUTER),
    });
    const priced: IGenerateResult = { ...result, costStatus: result.cost_usd === undefined ? "unknown" : "tracked" };
    return plan && options?.jsonSchema ? completeStructuredOutput(priced, options.jsonSchema, plan, this.id) : priced;
  }
}
