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
import { TOOL_RESULT_SCHEMA_VERSION } from "@exaix/core";
import { MCPToolResponseSchema } from "./mcp.ts";
import {
  type IToolResultSchemaDescriptor,
  type IToolResultValidationFailure,
  REMEDIATION_MODE_FAIL_CLOSED,
  TOOL_RESULT_SCHEMA_REGISTRY,
  ToolResultEnvelopeSchema,
  ToolResultRemediationPolicySchema,
  ToolResultSchemaDescriptorSchema,
} from "./tool_result.ts";
import { TOOL_MANIFEST } from "@exaix/mcp/manifest.ts";

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

// ============================================================================
// Schema descriptor builder for API discovery
// ============================================================================

/**
 * Builds a ToolResultSchemaDescriptor for the given tool name, derived from
 * the canonical TOOL_MANIFEST entry and TOOL_RESULT_SCHEMA_REGISTRY.
 * Returns null when the tool is unknown or has no manifest entry.
 */
export function buildToolResultSchemaDescriptor(
  toolName: string,
): IToolResultSchemaDescriptor | null {
  const manifestEntry = TOOL_MANIFEST.find((e) => e.name === toolName);
  if (!manifestEntry) {
    return null;
  }

  const remediationMode = manifestEntry.remediationPolicyRef ?? REMEDIATION_MODE_FAIL_CLOSED;
  const remediationPolicy = ToolResultRemediationPolicySchema.parse({
    tool: toolName,
    mode: remediationMode,
    maxRetries: 0,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  });

  const resultDataSchema = TOOL_RESULT_SCHEMA_REGISTRY[toolName] ?? undefined;

  const descriptor = ToolResultSchemaDescriptorSchema.parse({
    tool: toolName,
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    envelopeSchema: ToolResultEnvelopeSchema,
    resultDataSchema,
    remediationPolicy,
    experimental: true,
  });

  return descriptor;
}
