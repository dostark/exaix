/**
 * @module MCPToolResponseValidationTest
 * @path tests/mcp/mcp_tool_response_validation_test.ts
 * @description Tests for validateMCPToolResponse at the MCP server boundary
 * (Phase 78 Enforcement Point 3). Verifies that isError:true responses are treated
 * as valid, and that structured content blocks are validated correctly.
 */

import { assertEquals, assertExists } from "@std/assert";
import { validateMCPToolResponse } from "@exaix/schemas/tool_result_validator.ts";

// ============================================================================
// isError:true — must pass as valid, not flagged as validation failure
// ============================================================================

Deno.test("MCP boundary validator: isError:true response passes schema check without error", () => {
  const response = {
    content: [{ type: "text", text: "Error: file not found" }],
    isError: true,
  };
  const result = validateMCPToolResponse("read_file", response);
  assertEquals(
    result,
    null,
    "isError:true MCPToolResponse must not be flagged as a validation failure",
  );
});

Deno.test("MCP boundary validator: valid text content block passes", () => {
  const response = {
    content: [{ type: "text", text: "hello" }],
  };
  const result = validateMCPToolResponse("read_file", response);
  assertEquals(result, null);
});

Deno.test("MCP boundary validator: structured data content block passes", () => {
  const response = {
    content: [
      { type: "exaix_structured_data", data: { files: ["a.ts", "b.ts"] } },
    ],
  };
  const result = validateMCPToolResponse("search_files", response);
  assertEquals(result, null);
});

Deno.test("MCP boundary validator: empty content array passes", () => {
  const response = { content: [] };
  const result = validateMCPToolResponse("list_directory", response);
  assertEquals(result, null);
});

Deno.test("MCP boundary validator: missing content field produces failure", () => {
  const result = validateMCPToolResponse("read_file", { isError: true });
  assertExists(result, "Response without content array must fail validation");
  assertEquals(result.tool, "read_file");
  assertEquals(result.issues.length > 0, true);
});

Deno.test("MCP boundary validator: null response produces failure", () => {
  const result = validateMCPToolResponse("run_command", null);
  assertExists(result);
  assertEquals(result.tool, "run_command");
});

Deno.test("MCP boundary validator: unknown content type produces failure", () => {
  const response = {
    content: [{ type: "image", url: "http://example.com/img.png" }],
  };
  const result = validateMCPToolResponse("read_file", response);
  assertExists(result, "Unknown content type must fail validation");
  assertEquals(result.tool, "read_file");
});
