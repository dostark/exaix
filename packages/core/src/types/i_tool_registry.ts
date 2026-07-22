/**
 * @module IToolRegistry
 * @path packages/core/src/types/i_tool_registry.ts
 * @description Defines the interface for the ToolRegistry service.
 * @architectural-layer Interfaces
 * @related-files ["packages/tool-runtime/src/tool_registry.ts"]
 */
import type { JSONValue } from "@exaix/core";

export interface IToolParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: IToolParameterSchema;
  properties?: Record<string, IToolParameterSchema>;
  required?: string[];
}

export interface IToolSchema {
  type: "object";
  properties: Record<string, IToolParameterSchema>;
  required?: string[];
}

export interface ITool {
  name: string;
  description: string;
  parameters: IToolSchema;
  /**
   * Provider-native tool selection description. When set, used by
   * buildNativeToolDefinitions() instead of `description` for the
   * IToolDefinition passed to the LLM provider's native tool UI.
   * Should include behavioral-preference signals (e.g. "PREFERRED for
   * targeted edits") that are invisible in the TOML-block prose path
   * but critical when the model chooses from a tool list (PGAP-1).
   */
  nativeDescription?: string;
}

export interface IToolResult {
  success: boolean;
  /** Structured payload validated at runtime against ToolResultEnvelopeSchema in @exaix/schemas. */
  data?: JSONValue;
  /** Required when success=false by the package-owned runtime envelope contract. */
  error?: string;
}

export interface IToolRegistry {
  getTools(): ITool[];
  execute(toolName: string, params: Record<string, JSONValue>): Promise<IToolResult>;
  /** The resolved, absolute directory every tool call is rooted at (e.g. a plan's git worktree). */
  getBaseDir(): string;
}
