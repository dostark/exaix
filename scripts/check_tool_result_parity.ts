#!/usr/bin/env -S deno run -A
/**
 * @module CheckToolResultParity
 * @path scripts/check_tool_result_parity.ts
 * @description Verifies that TOOL_MANIFEST metadata is consistent with
 * TOOL_RESULT_SCHEMA_REGISTRY and known remediation policy modes.
 *
 * Checks:
 *   1. Every remediationPolicyRef in TOOL_MANIFEST references a known mode.
 *
 * Exits with code 1 when any parity violation is found.
 *
 * Usage:
 *   deno run -A scripts/check_tool_result_parity.ts
 */

import { TOOL_MANIFEST } from "@exaix/mcp/manifest.ts";
import { TOOL_RESULT_REMEDIATION_MODE_VALUES } from "@exaix/schemas/tool_result.ts";

// ============================================================================
// Exported types and functions (importable by tests)
// ============================================================================

/** Result of a parity check run. */
export interface IParityCheckResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  checkedTools: number;
}

/** Runs parity checks and returns a structured result (does NOT exit). */
export function checkToolResultParity(): IParityCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownModes = new Set<string>(TOOL_RESULT_REMEDIATION_MODE_VALUES);

  for (const entry of TOOL_MANIFEST) {
    if (entry.remediationPolicyRef !== undefined && !knownModes.has(entry.remediationPolicyRef)) {
      errors.push(
        `Tool '${entry.name}': remediationPolicyRef '${entry.remediationPolicyRef}' is not a known remediation mode.`,
      );
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    checkedTools: TOOL_MANIFEST.length,
  };
}

// ============================================================================
// CLI entry point
// ============================================================================

if (import.meta.main) {
  const result = checkToolResultParity();

  console.log(`🔍 Checking tool result parity across ${result.checkedTools} manifest entries...`);

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.warn(`  ⚠️  ${warning}`);
    }
  }

  if (result.success) {
    console.log("✅ Tool result parity check passed.");
    Deno.exit(0);
  }

  console.error("❌ Tool result parity violations found:");
  for (const error of result.errors) {
    console.error(`  • ${error}`);
  }
  Deno.exit(1);
}
