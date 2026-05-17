/**
 * @module ToolOutputSchemaPresentTest
 * @path packages/mcp/tests/tool_output_schema_present_test.ts
 * @description Verifies that every live MCP tool in the canonical manifest has a populated
 * output_schema and error_types field. These fields allow agents and callers to understand
 * what to expect from each tool without reading source code.
 * Run `deno task docs-sync-schemas` after updating manifest fields.
 */

import { assertEquals, assertExists } from "@std/assert";
import { TOOL_MANIFEST } from "@exaix/mcp";
import { ToolKind } from "@exaix/core";

/** Live MCP tools that agents interact with. */
function liveTools() {
  return TOOL_MANIFEST.filter(
    (e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN,
  );
}

// ── Output schema presence tests ──────────────────────────────────────────────

Deno.test("output_schema: every live tool has a populated output_schema", () => {
  const missing = liveTools().filter((e) => !e.output_schema || !e.output_schema.type);

  assertEquals(
    missing.map((e) => e.name),
    [],
    `The following live tools are missing output_schema: [${missing.map((e) => e.name).join(", ")}]. ` +
      `Add output_schema to each manifest entry describing the tool's return shape.`,
  );
});

Deno.test("output_schema: every live tool has a non-empty error_types array", () => {
  const missing = liveTools().filter((e) => !e.error_types || e.error_types.length === 0);

  assertEquals(
    missing.map((e) => e.name),
    [],
    `The following live tools are missing error_types: [${missing.map((e) => e.name).join(", ")}]. ` +
      `Add error_types listing the ToolErrorCode values this tool may return.`,
  );
});

Deno.test("output_schema: output_schema type is a valid JSON Schema type", () => {
  const validTypes = new Set(["string", "number", "boolean", "object", "array", "null"]);
  const invalid = liveTools().filter((e) => {
    if (!e.output_schema) return false;
    const t = e.output_schema.type;
    return t !== undefined && !validTypes.has(t);
  });

  assertEquals(
    invalid.map((e) => `${e.name}:${e.output_schema?.type}`),
    [],
    `The following tools have invalid output_schema.type: [${invalid.map((e) => e.name).join(", ")}]`,
  );
});

Deno.test("output_schema: output_schema has a description field", () => {
  const missingDesc = liveTools().filter(
    (e) => e.output_schema && !e.output_schema.description,
  );

  assertEquals(
    missingDesc.map((e) => e.name),
    [],
    `The following tools have output_schema without description: [${missingDesc.map((e) => e.name).join(", ")}]`,
  );
});

Deno.test("output_schema: live tool count is stable and non-zero", () => {
  const tools = liveTools();
  assertExists(tools.length, "live tool count must be non-zero");
  assertEquals(tools.length > 0, true, "manifest must contain at least one live MCP tool");
});
