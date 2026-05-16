/**
 * @module ToolRegistryResultContractTest
 * @path tests/services/tool/tool_registry_result_contract_test.ts
 * @description Verifies registry-backed tools produce structured IToolResult shapes consumable by toolResultToMcpResponse.
 */
import { assertEquals } from "@std/assert";
import { toolResultToMcpResponse } from "../../../src/mcp/tool_result_converter.ts";
import { ToolRegistry } from "../../../src/services/tool/tool_registry.ts";
import { createMockConfig } from "../../helpers/config.ts";

Deno.test("ToolRegistry run_command: result data shape is { output: string, exitCode: number }", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "registry-contract-" });

  try {
    const config = createMockConfig(tempDir);
    const registry = new ToolRegistry({ config });

    const result = await registry.runCommand("echo", ["hello"]);

    assertEquals(result.success, true);
    const data = result.data as { output: string; exitCode: number };
    assertEquals(typeof data.output, "string");
    assertEquals(typeof data.exitCode, "number");
    assertEquals(data.exitCode, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("toolResultToMcpResponse: converts run_command registry result to structured content", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "registry-convert-" });

  try {
    const config = createMockConfig(tempDir);
    const registry = new ToolRegistry({ config });

    const result = await registry.runCommand("echo", ["hello"]);
    const response = toolResultToMcpResponse(result);

    assertEquals(response.content.length, 1);
    assertEquals(response.content[0].type, "exaix_structured_data");
    assertEquals(response.isError, undefined);

    const block = response.content[0] as { type: "exaix_structured_data"; data: { output: string; exitCode: number } };
    assertEquals(typeof block.data.output, "string");
    assertEquals(block.data.exitCode, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
