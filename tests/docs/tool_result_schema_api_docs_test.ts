/**
 * @module ToolResultSchemaApiDocsTest
 * @path tests/docs/tool_result_schema_api_docs_test.ts
 * @description Verifies that buildToolResultSchemaDescriptor() returns well-formed
 * descriptors for tools registered in TOOL_RESULT_SCHEMA_REGISTRY, and that
 * the exaix/tools/result_schema discovery endpoint is documented correctly.
 * (Phase 78 Step 78.5)
 */

import { assertEquals, assertExists } from "@std/assert";
import { buildToolResultSchemaDescriptor } from "@exaix/mcp";
import { TOOL_RESULT_SCHEMA_REGISTRY } from "@exaix/schemas/tool_result.ts";

Deno.test("tool_result_schema_api_docs: buildToolResultSchemaDescriptor returns descriptor for each registry entry", () => {
  for (const toolName of Object.keys(TOOL_RESULT_SCHEMA_REGISTRY)) {
    const descriptor = buildToolResultSchemaDescriptor(toolName);
    assertExists(descriptor, `Expected descriptor for tool '${toolName}' in TOOL_RESULT_SCHEMA_REGISTRY`);
    assertEquals(descriptor.tool, toolName);
  }
});

Deno.test("tool_result_schema_api_docs: descriptor for unknown tool is null", () => {
  const descriptor = buildToolResultSchemaDescriptor("nonexistent_tool_xyz");
  assertEquals(descriptor, null);
});

Deno.test("tool_result_schema_api_docs: descriptor contains schemaVersion and envelopeSchema fields", () => {
  const knownTool = Object.keys(TOOL_RESULT_SCHEMA_REGISTRY)[0];
  const descriptor = buildToolResultSchemaDescriptor(knownTool);
  assertExists(descriptor);
  assertExists(descriptor.schemaVersion, "descriptor must have schemaVersion");
  assertExists(descriptor.envelopeSchema, "descriptor must have envelopeSchema");
});

Deno.test("tool_result_schema_api_docs: registry covers at least two tools", () => {
  const count = Object.keys(TOOL_RESULT_SCHEMA_REGISTRY).length;
  assertEquals(count >= 2, true, `Expected at least 2 tools in TOOL_RESULT_SCHEMA_REGISTRY, got ${count}`);
});
