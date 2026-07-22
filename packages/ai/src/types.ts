/**
 * @module AiTypes
 * @path packages/ai/src/types.ts
 * @description Core type definitions for the AI layer, including model options, provider interfaces, and result structures.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers.ts, packages/ai/src/provider_registry.ts]
 */
import type { ConfigSource, JSONValue, McpToolName, MockStrategy, ProviderType } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { Config, EffortTier, IBlueprintFrontmatter, IModelCallOptions } from "@exaix/schemas";
import type { IGenerateResult } from "./providers/common.ts";

/**
 * Options for model generation requests.
 */
export interface IModelOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  /**
   * Indices of content blocks eligible for Anthropic cache_control.
   * Set by AgentOrchestrator based on ContextCache stability analysis.
   * Non-Anthropic providers ignore this field.
   */
  cachedSections?: number[];
  /** Enable extended/chain-of-thought reasoning. Provider-specific mapping. */
  thinking?: boolean;
  /** Reasoning effort tier — low, medium, or high (EffortTier). Normalized across providers. */
  effort?: EffortTier;
  /** Provider-specific thinking budget cap (e.g. Anthropic max_tokens for thinking). */
  thinking_budget?: number;
  /**
   * Conversation/session continuity key. Calls sharing the same id resume the same
   * underlying session where the provider supports it (e.g. CliDelegateModelProvider's
   * headless claude/opencode subprocess, via --resume/--session) — mirrors
   * CliDelegateStrategy's trace_id-keyed multi-turn mechanism, needed because a single
   * IModelProvider instance is constructed once at daemon startup and reused across
   * every request, so retries/multi-call flows for the SAME request must not silently
   * start a brand-new, context-less session each call. Stateless HTTP providers ignore it.
   */
  conversationId?: string;
  /**
   * JSON Schema to enforce via the provider's --json-schema mechanism (e.g. claude-code).
   * Only CliDelegateModelProvider uses this; stateless HTTP providers ignore it.
   */
  jsonSchema?: Record<string, JSONValue>;
}

/**
 * Standard interface that all model providers must implement.
 */
export interface IModelProvider {
  /** Unique identifier for this provider instance. */
  id: string;

  /**
   * Generate a response from the model.
   * @param prompt The input prompt to send to the model
   * @param options Optional generation parameters
   * @returns The generated response payload
   */
  generate(prompt: string, options?: IModelOptions): Promise<IGenerateResult>;

  /**
   * Optional streaming variant. If implemented, yields content chunks as they
   * are produced by the provider. Consumers collect chunks into the final
   * IGenerateResult with streamed: true.
   * @param prompt The input prompt to send to the model
   * @param options Optional generation parameters (stream option hints streaming)
   */
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
  /** Custom provider ID */
  id?: string;
  /** Responses for scripted mock */
  responses?: string[];
  /** Optional event logger for usage tracking */
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
    identity: IBlueprintFrontmatter;
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
