/**
 * @module ToolResultManifestParityTest
 * @path packages/mcp/tests/tool_result_manifest_parity_test.ts
 * @description Verifies that every TOOL_MANIFEST entry declares a valid
 * remediationPolicyRef, and that tools with non-null output_schema have a
 * corresponding entry in the TOOL_RESULT_SCHEMA_REGISTRY.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { TOOL_MANIFEST } from "@exaix/mcp";
import { TOOL_RESULT_REMEDIATION_MODES, TOOL_RESULT_SCHEMA_REGISTRY } from "@exaix/schemas";

// ============================================================================
// remediationPolicyRef parity checks
// ============================================================================

Deno.test("tool_result_manifest_parity: every TOOL_MANIFEST entry has remediationPolicyRef", () => {
  for (const entry of TOOL_MANIFEST) {
    assertExists(
      entry.remediationPolicyRef,
      `TOOL_MANIFEST entry "${entry.name}" is missing remediationPolicyRef`,
    );
  }
});

Deno.test("tool_result_manifest_parity: all remediationPolicyRef values are known modes", () => {
  for (const entry of TOOL_MANIFEST) {
    assert(
      TOOL_RESULT_REMEDIATION_MODES.has(entry.remediationPolicyRef!),
      `TOOL_MANIFEST entry "${entry.name}" has unknown remediationPolicyRef: "${entry.remediationPolicyRef}"`,
    );
  }
});

// ============================================================================
// Schema registry parity checks
// ============================================================================

Deno.test("tool_result_manifest_parity: delegates_to_registry tools have entry in TOOL_RESULT_SCHEMA_REGISTRY", () => {
  const registryTools = TOOL_MANIFEST.filter((e) => e.delegates_to_registry === true && e.output_schema != null);
  assertEquals(
    registryTools.length > 0,
    true,
    "Expected at least one tool with delegates_to_registry and output_schema",
  );
  for (const entry of registryTools) {
    assertExists(
      TOOL_RESULT_SCHEMA_REGISTRY[entry.name],
      `Tool "${entry.name}" has output_schema + delegates_to_registry but no schema in TOOL_RESULT_SCHEMA_REGISTRY`,
    );
  }
});

Deno.test("tool_result_manifest_parity: TOOL_RESULT_SCHEMA_REGISTRY entries are valid Zod schemas", () => {
  for (const [toolName, schema] of Object.entries(TOOL_RESULT_SCHEMA_REGISTRY)) {
    assertExists(schema, `Schema entry for "${toolName}" is null/undefined`);
    assertExists(
      typeof schema.parse,
      `Schema entry for "${toolName}" does not have a parse() method — must be a Zod schema`,
    );
  }
});
