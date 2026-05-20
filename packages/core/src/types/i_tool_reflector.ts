/**
 * @module ToolReflectorTypes
 * @path packages/core/src/types/i_tool_reflector.ts
 * @description Tool reflection types and interface for tool-runtime extraction.
 */

import type { IDatabaseService } from "./i_database_service.ts";
import type { JSONValue } from "./json.ts";

export interface IToolCall {
  id: string;
  name: string;
  parameters: Record<string, JSONValue>;
  purpose: string;
  dependencies?: string[];
}

export interface IToolResult {
  callId: string;
  success: boolean;
  output: JSONValue;
  error?: string;
  durationMs: number;
}

export interface IToolReflection {
  success: boolean;
  confidence: number;
  issues: string[];
  retry_suggested: boolean;
  retry_reason?: string;
  alternative_parameters?: Record<string, JSONValue>;
  insights?: string[];
}

export interface IReflectedToolResult {
  callId: string;
  success: boolean;
  output: JSONValue;
  error?: string;
  durationMs: number;
  reflection: IToolReflection;
  retryCount: number;
  finalOutput: JSONValue;
}

export interface IToolReflectorConfig {
  maxRetries?: number;
  reflectionThreshold?: number;
  parallelExecution?: boolean;
  reflectionPromptTemplate?: string;
  verbose?: boolean;
  db?: IDatabaseService;
}

export interface IToolReflectorMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalRetries: number;
  retryRate: number;
  averageRetriesPerCall: number;
  toolDistribution: Record<string, number>;
  issueTypeDistribution: Record<string, number>;
}

export interface IToolReflector {
  executeWithReflection(
    toolCall: IToolCall,
    executor: (params: Record<string, JSONValue>) => Promise<IToolResult>,
    traceId?: string,
  ): Promise<IReflectedToolResult>;

  executeMultiple(
    toolCalls: IToolCall[],
    executor: (call: IToolCall) => Promise<IToolResult>,
    traceId?: string,
  ): Promise<IReflectedToolResult[]>;

  getMetrics(): IToolReflectorMetrics;
  resetMetrics(): void;
}
