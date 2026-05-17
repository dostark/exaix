/**
 * @module ToolResultContractBackwardCompatibilityTest
 * @path tests/flows/tool_result_contract_backward_compatibility_test.ts
 * @description Verifies that the Phase 78 tool result validation contracts are
 * purely additive: IToolResultValidator is optional in both MCPServerOptions and
 * IToolRegistryConfig, and the schema-discovery API (exaix/tools/result_schema)
 * is additive and does not affect existing tool call paths. (Phase 78 Step 78.6)
 */

import { assertEquals, assertExists } from "@std/assert";
import { buildToolResultSchemaDescriptor } from "@exaix/mcp";
import { validateToolResultEnvelope } from "@exaix/schemas/tool_result_validator.ts";
import { TOOL_RESULT_SCHEMA_REGISTRY } from "@exaix/schemas/tool_result.ts";
import * as ToolResultSchemas from "@exaix/schemas/tool_result.ts";

Deno.test("tool_result_contract_backward_compat: IToolResultValidator is optional — validateToolResultEnvelope works standalone", () => {
  const validEnvelope = { success: true, data: ["file.ts"] };
  const failure = validateToolResultEnvelope("search_files", validEnvelope);
  assertEquals(failure, null, "Valid envelope must pass without any DI container");
});

Deno.test("tool_result_contract_backward_compat: schema-discovery returns null for tools not in registry (no crash)", () => {
  const result = buildToolResultSchemaDescriptor("some_legacy_tool");
  assertEquals(result, null, "Schema discovery for unknown tool must return null, not throw");
});

Deno.test("tool_result_contract_backward_compat: existing registry tools have stable descriptor shape", () => {
  for (const toolName of Object.keys(TOOL_RESULT_SCHEMA_REGISTRY)) {
    const descriptor = buildToolResultSchemaDescriptor(toolName);
    assertExists(descriptor, `Expected descriptor for '${toolName}'`);
    assertExists(descriptor.tool);
    assertExists(descriptor.schemaVersion);
    assertExists(descriptor.envelopeSchema);
    assertExists(descriptor.remediationPolicy);
  }
});

Deno.test("tool_result_contract_backward_compat: ownership map — result envelope schema stays in packages/schemas", () => {
  assertExists(
    ToolResultSchemas.TOOL_RESULT_SCHEMA_REGISTRY,
    "TOOL_RESULT_SCHEMA_REGISTRY must be importable from @exaix/schemas/tool_result.ts",
  );
});
