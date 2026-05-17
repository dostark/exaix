/**
 * @module ToolResultValidator
 * @path packages/schemas/src/tool_result_validator.ts
 * @description Stateless validation functions for tool execution result envelopes and
 * MCP tool responses. Used at registry and MCP adapter boundaries (Phase 78 Enforcement
 * Points 1, 2, and 3). Exports IToolResultValidator for optional DI into MCPServer and
 * ToolRegistry.
 * @architectural-layer Schemas
 * @dependencies ["packages/schemas/src/tool_result.ts", "packages/schemas/src/mcp.ts"]
 * @related-files ["src/mcp/server.ts", "src/services/tool/tool_registry.ts", "packages/schemas/src/tool_result.ts"]
 */

import type { JSONValue } from "@exaix/core";
import { MCPToolResponseSchema } from "./mcp.ts";
import { type IToolResultValidationFailure, ToolResultEnvelopeSchema } from "./tool_result.ts";

export type { IToolResultValidationFailure };

/** Pre-validation payload of indeterminate structure, accepted by all boundary validators. */
type IUnvalidatedPayload = JSONValue;

// ============================================================================
// IToolResultValidator — interface for optional DI
// ============================================================================

export interface IToolResultValidator {
  validateEnvelope(toolName: string, result: IUnvalidatedPayload): IToolResultValidationFailure | null;
  validateMCPResponse(toolName: string, response: IUnvalidatedPayload): IToolResultValidationFailure | null;
}

// ============================================================================
// Stateless validation helpers
// ============================================================================

/**
 * Validates an IToolResult envelope at the executor or adapter boundary.
 * Returns null on success, IToolResultValidationFailure on schema mismatch.
 *
 * rawResult is captured for audit logging but must not be forwarded to clients.
 */
export function validateToolResultEnvelope(
  toolName: string,
  result: IUnvalidatedPayload,
): IToolResultValidationFailure | null {
  const parsed = ToolResultEnvelopeSchema.safeParse(result);
  if (parsed.success) {
    return null;
  }
  return {
    tool: toolName,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message,
      code: issue.code,
    })),
    rawResult: result as IToolResultValidationFailure["rawResult"],
  };
}

/**
 * Validates an MCPToolResponse at the MCP server boundary.
 * isError:true responses are treated as structurally valid — the tool surfaced
 * a typed error, which is not a schema violation.
 * Returns null on success, IToolResultValidationFailure on schema mismatch.
 */
export function validateMCPToolResponse(
  toolName: string,
  response: IUnvalidatedPayload,
): IToolResultValidationFailure | null {
  const parsed = MCPToolResponseSchema.safeParse(response);
  if (parsed.success) {
    return null;
  }
  return {
    tool: toolName,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message,
      code: issue.code,
    })),
    rawResult: response as IToolResultValidationFailure["rawResult"],
  };
}
