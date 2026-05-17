/**
 * @module ToolResultBackwardCompatibilityTest
 * @path tests/integration/mcp/tool_result_backward_compatibility_test.ts
 * @description Verifies that existing MCPToolResponse formats continue to pass
 * MCP boundary validation after Phase 78 changes. Ensures the new validator layer
 * is strictly additive: existing callers receive compatible responses regardless
 * of whether a resultValidator is injected. (Phase 78 Step 78.6)
 */

import { assertEquals, assertExists } from "@std/assert";
import { validateMCPToolResponse } from "@exaix/schemas/tool_result_validator.ts";

const TEXT_RESPONSE = {
  content: [{ type: "text", text: "file contents here" }],
};

const ERROR_RESPONSE = {
  content: [{ type: "text", text: "Error: file not found" }],
  isError: true,
};

const MULTI_CONTENT_RESPONSE = {
  content: [
    { type: "text", text: "line 1" },
    { type: "text", text: "line 2" },
  ],
};

Deno.test("tool_result_backward_compatibility: plain text MCPToolResponse passes MCP boundary validation", () => {
  const failure = validateMCPToolResponse("read_file", TEXT_RESPONSE);
  assertEquals(failure, null, "A plain text response must not fail MCP validation");
});

Deno.test("tool_result_backward_compatibility: isError=true response passes MCP boundary validation", () => {
  const failure = validateMCPToolResponse("write_file", ERROR_RESPONSE);
  assertEquals(
    failure,
    null,
    "A response with isError=true is a valid typed tool error and must not fail MCP validation",
  );
});

Deno.test("tool_result_backward_compatibility: multi-content MCPToolResponse passes MCP boundary validation", () => {
  const failure = validateMCPToolResponse("search_files", MULTI_CONTENT_RESPONSE);
  assertEquals(failure, null, "A multi-content response must not fail MCP validation");
});

Deno.test("tool_result_backward_compatibility: unknown tool still validates MCP envelope shape", () => {
  const failure = validateMCPToolResponse("legacy_tool_not_in_manifest", TEXT_RESPONSE);
  assertEquals(failure, null, "A valid MCPToolResponse for an unknown tool must pass envelope validation");
});

Deno.test("tool_result_backward_compatibility: malformed content array fails with failure object", () => {
  const malformed = { content: "not-an-array" };
  const failure = validateMCPToolResponse("read_file", malformed);
  assertExists(failure, "Malformed MCPToolResponse must produce a validation failure");
  assertEquals(failure!.tool, "read_file");
  assertExists(failure!.issues.length > 0);
});
