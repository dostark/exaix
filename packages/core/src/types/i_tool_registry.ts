/**
 * @module IToolRegistry
 * @path packages/core/src/types/i_tool_registry.ts
 * @description Defines the interface for the ToolRegistry service.
 * @architectural-layer Interfaces
 * @related-files ["src/services/tool/tool_registry.ts"]
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
}
