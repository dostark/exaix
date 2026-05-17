/**
 * @module ToolResultSchemas
 * @path packages/schemas/src/tool_result.ts
 * @description Package-owned Zod schemas for tool execution result envelopes,
 * validation failures, remediation policies, and API discovery descriptors.
 * Validates IToolResult from packages/core/src/types/i_tool_registry.ts at
 * executor and adapter boundaries (Phase 78 Enforcement Points 1 and 2).
 * @architectural-layer Schemas
 * @dependencies ["packages/core/src/types/i_tool_registry.ts", "packages/core/src/types/constants.ts", "packages/schemas/src/mcp.ts"]
 * @related-files ["src/mcp/server.ts", "src/services/tool/tool_registry.ts", "packages/mcp/src/manifest.ts"]
 */

import { z } from "zod";
import { JSONValueSchema, TOOL_RESULT_VALIDATION_MAX_RETRIES } from "@exaix/core";
import { ToolErrorCode } from "@exaix/core";

// ============================================================================
// Tool Result Envelope Schema
// ============================================================================

/**
 * Runtime schema for IToolResult from packages/core/src/types/i_tool_registry.ts.
 * Validates the envelope produced by ToolRegistry-backed tool executors at
 * Enforcement Points 1 (executor boundary) and 2 (adapter boundary).
 *
 * Note: tool_reflector.ts:IToolResult is a separate reflective evaluation
 * interface and is out of scope for Phase 78 payload validation.
 */
export const ToolResultEnvelopeSchema = z.object({
  success: z.boolean(),
  data: JSONValueSchema.optional(),
  error: z.string().optional(),
});

export type IToolResultEnvelope = z.infer<typeof ToolResultEnvelopeSchema>;

// ============================================================================
// Tool Result Validation Failure Schema
// ============================================================================

/**
 * Structured representation of a tool result payload validation failure.
 * The rawResult field MUST NOT be forwarded to MCP clients — it is for
 * internal audit logging only.
 */
export const ToolResultValidationFailureSchema = z.object({
  tool: z.string().min(1),
  toolErrorCode: z.nativeEnum(ToolErrorCode).optional(),
  issues: z.array(
    z.object({
      path: z.array(z.string()),
      message: z.string(),
      code: z.string(),
    }),
  ),
  rawResult: JSONValueSchema.optional(),
});

export type IToolResultValidationFailure = z.infer<typeof ToolResultValidationFailureSchema>;

// ============================================================================
// Remediation Policy Schema
// ============================================================================

/** Remediation mode: stop execution immediately on schema mismatch. Default for mutating tools. */
export const REMEDIATION_MODE_FAIL_CLOSED = "fail_closed" as const;
/** Remediation mode: normalize/coerce the payload, then revalidate. Default for read-only tools. */
export const REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE = "normalize_then_validate" as const;
/** Remediation mode: retry the tool call exactly once on schema mismatch. Requires idempotency. */
export const REMEDIATION_MODE_RETRY_ONCE = "retry_once" as const;
/** Remediation mode: retry with exponential backoff, up to TOOL_RESULT_VALIDATION_MAX_RETRIES times. */
export const REMEDIATION_MODE_RETRY_WITH_BACKOFF = "retry_with_backoff" as const;
/** Remediation mode: surface the mismatch as an audit event without stopping execution. */
export const REMEDIATION_MODE_ESCALATE_ONLY = "escalate_only" as const;

/** Valid remediation modes for tool result validation failures. */
export const TOOL_RESULT_REMEDIATION_MODE_VALUES = [
  REMEDIATION_MODE_FAIL_CLOSED,
  REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
  REMEDIATION_MODE_RETRY_ONCE,
  REMEDIATION_MODE_RETRY_WITH_BACKOFF,
  REMEDIATION_MODE_ESCALATE_ONLY,
] as const;

/** Set of valid remediation mode strings for fast lookup (used in parity checks). */
export const TOOL_RESULT_REMEDIATION_MODES: ReadonlySet<string> = new Set(
  TOOL_RESULT_REMEDIATION_MODE_VALUES,
);

export type ToolResultRemediationMode = typeof TOOL_RESULT_REMEDIATION_MODE_VALUES[number];

/**
 * Policy governing how validation failures are handled for a specific tool.
 * maxRetries is bounded by TOOL_RESULT_VALIDATION_MAX_RETRIES.
 */
export const ToolResultRemediationPolicySchema = z.object({
  tool: z.string().min(1),
  mode: z.enum(TOOL_RESULT_REMEDIATION_MODE_VALUES),
  maxRetries: z.number().int().min(0).max(TOOL_RESULT_VALIDATION_MAX_RETRIES).default(0),
  requiresIdempotency: z.boolean().default(true),
  allowRetryAfterSideEffect: z.boolean().default(false),
  logValidationFailures: z.boolean().default(true),
  triggerPlanAmendmentOnFailure: z.boolean().default(false),
});

export type IToolResultRemediationPolicy = z.infer<typeof ToolResultRemediationPolicySchema>;

// ============================================================================
// Schema Descriptor (API Discovery)
// ============================================================================

/**
 * Descriptor returned by the exaix/tools/result_schema JSON-RPC method.
 * Derived from the same canonical metadata as runtime validation so discovery
 * and enforcement cannot drift independently.
 */
export const ToolResultSchemaDescriptorSchema = z.object({
  tool: z.string().min(1),
  schemaVersion: z.string().min(1),
  envelopeSchema: z.unknown(),
  /** Phase 77's output_schema promoted to a Zod schema for runtime validation. */
  resultDataSchema: z.unknown().optional(),
  remediationPolicy: ToolResultRemediationPolicySchema,
  experimental: z.boolean().default(true),
});

export type IToolResultSchemaDescriptor = z.infer<typeof ToolResultSchemaDescriptorSchema>;

// ============================================================================
// Tool Result Schema Registry
// ============================================================================

/**
 * Registry mapping tool name → Zod schema for the tool's IToolResult.data field.
 * Only populated for ToolRegistry-backed tools (delegates_to_registry: true)
 * that expose structured nested data payloads.
 *
 * MCP-handler-only tools (ReadFileTool, WriteFileTool, etc.) return MCPToolResponse
 * directly and are validated at the MCP boundary, not here.
 */
export const TOOL_RESULT_SCHEMA_REGISTRY: Record<string, z.ZodType> = {
  run_command: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int(),
  }),
  search_files: z.array(z.string()),
};
