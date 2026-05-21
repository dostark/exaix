/**
 * @module McpToolResultMetadata
 * @path packages/mcp/src/tool_result_metadata.ts
 * @description Manifest-aware helpers for tool result schema discovery and remediation policy lookup.
 * @architectural-layer MCP
 * @related-files [packages/mcp/src/manifest.ts, packages/schemas/src/tool_result.ts, packages/mcp/server/server.ts]
 */

import { TOOL_RESULT_SCHEMA_VERSION } from "@exaix/core";
import {
  type IToolResultRemediationPolicy,
  type IToolResultSchemaDescriptor,
  REMEDIATION_MODE_FAIL_CLOSED,
  TOOL_RESULT_ENVELOPE_JSON_SCHEMA,
  TOOL_RESULT_SCHEMA_DESCRIPTOR_REGISTRY,
  ToolResultRemediationPolicySchema,
  ToolResultSchemaDescriptorSchema,
} from "@exaix/schemas";

import { TOOL_MANIFEST } from "./manifest.ts";
import type { IRemediationToolMetadata } from "@exaix/schemas";

function findManifestEntry(toolName: string) {
  return TOOL_MANIFEST.find((entry) => entry.name === toolName);
}

/**
 * Looks up the remediation policy for a named tool from TOOL_MANIFEST.
 * Returns null when no manifest entry exists for the given tool name.
 */
export function lookupRemediationPolicy(toolName: string): IToolResultRemediationPolicy | null {
  const manifestEntry = findManifestEntry(toolName);
  if (!manifestEntry) {
    return null;
  }

  return ToolResultRemediationPolicySchema.parse({
    tool: toolName,
    mode: manifestEntry.remediationPolicyRef ?? REMEDIATION_MODE_FAIL_CLOSED,
    maxRetries: 0,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  });
}

export function lookupRemediationToolMetadata(toolName: string): IRemediationToolMetadata | null {
  const manifestEntry = findManifestEntry(toolName);
  if (!manifestEntry) {
    return null;
  }

  return {
    idempotent: manifestEntry.idempotent,
    sideEffectScope: manifestEntry.side_effect_scope,
  };
}

/**
 * Builds a ToolResultSchemaDescriptor for the given tool name, derived from
 * the canonical TOOL_MANIFEST entry and TOOL_RESULT_SCHEMA_REGISTRY.
 * Returns null when the tool is unknown or has no manifest entry.
 */
export function buildToolResultSchemaDescriptor(
  toolName: string,
): IToolResultSchemaDescriptor | null {
  const manifestEntry = findManifestEntry(toolName);
  if (!manifestEntry) {
    return null;
  }

  const remediationPolicy = lookupRemediationPolicy(toolName);
  if (!remediationPolicy) {
    return null;
  }

  const resultDataSchema = TOOL_RESULT_SCHEMA_DESCRIPTOR_REGISTRY[toolName] ?? undefined;

  return ToolResultSchemaDescriptorSchema.parse({
    tool: toolName,
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    envelopeSchema: TOOL_RESULT_ENVELOPE_JSON_SCHEMA,
    resultDataSchema,
    remediationPolicy,
    experimental: true,
  });
}
