/**
 * @module ToolResultConversionTest
 * @path packages-team/mcp-server/tests/tool_result_conversion_test.ts
 * @description Verifies toolResultToMcpResponse maps all IToolResult variants to MCPToolResponse correctly.
 * @architectural-layer MCP
 * @related-files [packages/mcp/src/tool_result_converter.ts]
 */
import { assertEquals } from "@std/assert";
import { toolResultToMcpResponse } from "@exaix/mcp";

Deno.test("toolResultToMcpResponse: success result with string data produces text content block", () => {
  const result = toolResultToMcpResponse({ success: true, data: "command output" });

  assertEquals(result.content.length, 1);
  assertEquals(result.content[0].type, "text");
  assertEquals((result.content[0] as { type: "text"; text: string }).text, "command output");
  assertEquals(result.isError, undefined);
});

Deno.test("toolResultToMcpResponse: success result with object data produces structured data content block", () => {
  const data = { output: "ls output", exitCode: 0 };
  const result = toolResultToMcpResponse({ success: true, data });

  assertEquals(result.content.length, 1);
  assertEquals(result.content[0].type, "exaix_structured_data");
  type IStructuredBlock = { type: "exaix_structured_data"; data: { output: string; exitCode: number } };
  assertEquals((result.content[0] as IStructuredBlock).data, data);
  assertEquals(result.isError, undefined);
});

Deno.test("toolResultToMcpResponse: error result produces isError:true text content block", () => {
  const result = toolResultToMcpResponse({ success: false, error: "Command blocked" });

  assertEquals(result.isError, true);
  assertEquals(result.content.length, 1);
  assertEquals(result.content[0].type, "text");
  assertEquals((result.content[0] as { type: "text"; text: string }).text, "Command blocked");
});

Deno.test("toolResultToMcpResponse: success result without data produces empty text block", () => {
  const result = toolResultToMcpResponse({ success: true });

  assertEquals(result.isError, undefined);
  assertEquals(result.content.length, 1);
  assertEquals(result.content[0].type, "text");
});
