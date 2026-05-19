/**
 * @module AiTypes
 * @path src/ai/types.ts
 * @description Core type definitions for the AI layer, including model options, provider interfaces, and result structures.
 * @architectural-layer AI
 * @related-files [src/ai/providers.ts, src/ai/provider_registry.ts]
 */
import type { ConfigSource, JSONValue, McpToolName, MockStrategy, ProviderType } from "@exaix/core";
import type { EventLogger } from "@exaix/core/logger";
import type { IBlueprintFrontmatter } from "@exaix/schemas";

/**
 * Options for model generation requests.
 */
export interface IModelOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
}

import type { IGenerateResult } from "./providers/common.ts";

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
  logger?: EventLogger;
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
  }): Promise<{
    done: boolean;
    tool?: McpToolName;
    args?: ToolArgs;
    output?: string;
  }>;
}
