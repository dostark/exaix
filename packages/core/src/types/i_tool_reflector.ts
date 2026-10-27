/**
 * @module ToolReflectorTypes
 * @path packages/core/src/types/i_tool_reflector.ts
 * @related-files []
 * @architectural-layer Core
 * @description Tool reflection types and interface for tool-runtime extraction.
 */

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

interface IToolReflection {
  success: boolean;
  confidence: number;
  issues: string[];
  retry_suggested: boolean;
  retry_reason?: string;
  alternative_parameters?: Record<string, JSONValue>;
  insights?: string[];
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
