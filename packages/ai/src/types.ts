/**
 * @module AiTypes
 * @path packages/ai/src/types.ts
 * @description Core type definitions for the AI layer, including model options, provider interfaces, and result structures.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers.ts, packages/ai/src/provider_registry.ts]
 */
import type { ChatFormat, ConfigSource, JSONValue, McpToolName, MockStrategy, ProviderType } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { Config, EffortTier, IBlueprintFrontmatter, IModelCallOptions } from "@exaix/schemas";
import type { IGenerateResult, IThinkingReplayBlock } from "./providers/common.ts";

/**
 * Cache TTL values for Anthropic prompt caching.
 */
export type ToolCacheControlTtl = "5m" | "1h";

/** Cache control annotation for tool definitions (Anthropic prompt caching).
 *  Defaults to "5m" when omitted. */
export interface IToolCacheControl {
  type: "ephemeral";
  ttl?: ToolCacheControlTtl;
}

/** Mirrors Anthropic's Tool object — one tool definition in the tools[] array.
 *  Provider-agnostic; other providers' tool support reuses this type. */
export interface IToolDefinition {
  /** Must match Anthropic's ^[a-zA-Z0-9_-]{1,64}$ — validated at the
   *  AnthropicProvider boundary, not here. */
  name: string;
  /** Strongly recommended. Detailed description of what the tool does and
   *  when to use it. */
  description?: string;
  /** JSON Schema object — the exact shape ToolRegistry.getTools()'s
   *  ITool.parameters already provides. */
  inputSchema: Record<string, JSONValue>;
  /** For user-defined custom tools, should be "custom". Anthropic server
   *  tools use their own type strings (e.g. "bash_20250124"). */
  type?: string;
  /** When true, guarantees schema validation on tool names and inputs
   *  (Anthropic's strict tool use feature). */
  strict?: boolean;
  /** Cache the tool definition for prompt caching efficiency. */
  cache_control?: IToolCacheControl;
  /** Optional array of example inputs to help the model understand
   *  the tool's expected input shape. */
  input_examples?: Record<string, JSONValue>[];
}

/** Mirrors Anthropic's four tool_choice values plus the documented
 *  disable_parallel_tool_use option on auto/any/tool types. */
export type IToolChoice =
  | { type: "auto"; disable_parallel_tool_use?: boolean }
  | { type: "any"; disable_parallel_tool_use?: boolean }
  | { type: "tool"; name: string; disable_parallel_tool_use?: boolean }
  | { type: "none" };

/** One already-completed provider exchange, passed to a FOLLOW-UP generate()
 *  call so the provider sees the real multi-turn shape natively. */
export interface IProviderTurn {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, JSONValue>;
  /** Tool result content. Can be a plain string OR an array of rich content blocks
   *  (text, image, document, etc.) matching Anthropic's tool_result.content shape. */
  toolResultContent: string | Array<{ type: string; [key: string]: JSONValue }>;
  toolResultIsError: boolean;
  /** Gemini thought signature required when replaying the prior function call. */
  thoughtSignature?: string;
  /** Signed Anthropic thinking blocks replayed before the tool-use block. */
  thinkingBlocks?: IThinkingReplayBlock[];
  /** OpenAI reasoning content replayed with tool-call outputs. */
  reasoningContent?: string;
}

/**
 * Options for model generation requests.
 */
export interface IModelOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  /** Indices of content blocks eligible for Anthropic cache_control, set by
   *  AgentComposer based on ContextCache stability analysis. Non-Anthropic
   *  providers ignore this field. */
  cachedSections?: number[];
  /** Enable extended/chain-of-thought reasoning. Provider-specific mapping. */
  thinking?: boolean;
  /** Reasoning effort tier — low, medium, or high (EffortTier). Normalized across providers. */
  effort?: EffortTier;
  /** Provider-specific thinking budget cap (e.g. Anthropic max_tokens for thinking). */
  thinking_budget?: number;
  /** Conversation/session continuity key. Calls sharing the same id resume the same underlying session where the provider supports it (e.g. CliDelegateModelProvider's headless subprocess), since a single IModelProvider instance is reused across every request. Stateless HTTP providers ignore it. */
  conversationId?: string;
  /** JSON Schema to enforce via the provider's --json-schema mechanism (e.g. claude-code). Only CliDelegateModelProvider uses this; stateless HTTP providers ignore it. */
  jsonSchema?: Record<string, JSONValue>;
  /** Native tool definitions serialized into provider API requests. */
  tools?: IToolDefinition[];
  /** Provider-level tool choice constraint. Mirrors Anthropic's four-valued
   *  tool_choice plus disable_parallel_tool_use on auto/any/tool types.
   *  Ignored when tools is absent. */
  toolChoice?: IToolChoice;
  /** The prior tool-use turn to prepend as a 2-message exchange (assistant
   *  tool_use + user tool_result) when continuing a native tool-use loop.
   *  Absent for every call today. */
  priorTurn?: IProviderTurn;
  /** Chat protocol format: "anthropic" (Messages API), "openai" (Chat Completions API), or "native" (TOML action blocks). */
  chatFormat?: ChatFormat;
  /** Location of call for fixture replay addressing. Assigned by AgentRunner from IParsedRequest. */
  callSite?: ICallSite;
}

export interface ICallSite {
  scenarioId: string;
  stepId: string;
  /** Flow-internal step id (e.g. "define-endpoints"), present only for calls driven by FlowRunner. */
  flowStepId?: string;
  /** Ordinal of this logical call within the step, incremented once per consumed response.
   *  A retried logical call (internal to executeWithRetry) keeps the same index. */
  callIndex: number;
}
/**
 * Standard interface that all model providers must implement.
 */
export interface IModelProvider {
  /** Unique identifier for this provider instance. */
  id: string;

  /** Generate a response from the model. @param prompt The input prompt to send to the model @param options Optional generation parameters @returns The generated response payload */
  generate(prompt: string, options?: IModelOptions): Promise<IGenerateResult>;

  /** Optional streaming variant. If implemented, yields content chunks as they are produced by the provider. Consumers collect chunks into the final IGenerateResult with streamed: true. @param prompt The input prompt to send to the model @param options Optional generation parameters (stream option hints streaming) */
  generateStream?(prompt: string, options?: IModelOptions): AsyncGenerator<string>;
}

/**
 * Resolved provider options after merging env vars and config
 */
export interface IResolvedProviderOptions {
  /** Provider type */
  provider: ProviderType;
  /** Model name */
  model: string;
  /** API base URL */
  baseUrl?: string;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** API key (for cloud providers) */
  apiKey?: string;
  /** Mock strategy */
  mockStrategy?: MockStrategy;
  /** Mock fixtures directory */
  mockFixturesDir?: string;
  /** Refuse to answer an unrecorded prompt/call site instead of falling back to patterns. */
  mockStrict?: boolean;
  /** Directory to record fixtures into from EXA_CAPTURE_FIXTURES_DIR; rejected when provider is mock. */
  captureFixturesDir?: string;
  /** Custom provider ID */
  id?: string;
  /** Responses for scripted mock */
  responses?: string[];
  logger?: IEventLogger;
  /** Resolved Exaix config — lets provider-specific factories read their option blocks. */
  config?: Config;
}

/**
 * Provider information for logging/debugging
 */
export interface IProviderInfo {
  /** Provider type */
  type: ProviderType;
  /** Provider ID */
  id: string;
  /** Model name */
  model: string;
  /** Source of configuration */
  source: ConfigSource;
}

export type ToolArgs = Record<string, JSONValue>;

export interface ILlmClient {
  reasonNextAction(params: {
    agent_role: IBlueprintFrontmatter;
    stepObjective: string;
    accumulatedContext: string;
    availableTools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, JSONValue>;
    }>;
    iteration: number;
    maxIterations: number;
    options?: IModelCallOptions;
  }): Promise<{
    done: boolean;
    tool?: McpToolName;
    args?: ToolArgs;
    output?: string;
  }>;
}

/** `IToolChoice.type` discriminant tags, shared across every provider-specific
 *  mapToolChoice*() function (OpenAI, Google, OpenRouter, ...) so each one switches on a
 *  named constant instead of a raw string literal. */
export const TOOL_CHOICE_TYPE_AUTO = "auto";
export const TOOL_CHOICE_TYPE_ANY = "any";
export const TOOL_CHOICE_TYPE_TOOL = "tool";
export const TOOL_CHOICE_TYPE_NONE = "none";
