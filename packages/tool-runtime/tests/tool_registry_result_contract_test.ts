/**
 * @module ToolRegistryResultContractTest
 * @path packages/tool-runtime/tests/tool_registry_result_contract_test.ts
 * @description Verifies registry-backed tools produce structured IToolResult shapes consumable by toolResultToMcpResponse,
 * and that resultValidator is applied at the registry execution boundary (Enforcement Point 2).
 */
import { assertEquals, assertExists } from "@std/assert";
import { toolResultToMcpResponse } from "@exaix/mcp";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import type { IToolResultValidator } from "@exaix/schemas/tool_result_validator.ts";
import type { IToolResultValidationFailure } from "@exaix/schemas/tool_result.ts";
import { type JSONValue, Severity, ToolSideEffectScope } from "@exaix/core";

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

// ── resultValidator wiring (Enforcement Point 2) ────────────────────────────

Deno.test("ToolRegistry execute: resultValidator failure converts execution result to IToolResult failure", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "registry-validator-" });
  try {
    const config = createMockConfig(tempDir);
    const alwaysFail: IToolResultValidator = {
      validateEnvelope: (toolName: string, rawResult: JSONValue): IToolResultValidationFailure => ({
        tool: toolName,
        stage: "registry_boundary",
        severity: Severity.ERROR,
        retryAllowed: false,
        sideEffectRisk: ToolSideEffectScope.NONE,
        issues: [{ path: [], message: "synthetic validation failure", code: "custom" }],
        rawResult,
      }),
      validateMCPResponse: () => null,
    };
    const registry = new ToolRegistry({ config, resultValidator: alwaysFail });
    const result = await registry.execute("run_command", { command: "echo", args: ["hello"] });
    assertEquals(result.success, false);
    assertExists(result.error);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("ToolRegistry execute: valid result passes through when resultValidator returns null", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "registry-validator-pass-" });
  try {
    const config = createMockConfig(tempDir);
    const alwaysPass: IToolResultValidator = {
      validateEnvelope: () => null,
      validateMCPResponse: () => null,
    };
    const registry = new ToolRegistry({ config, resultValidator: alwaysPass });
    const result = await registry.execute("run_command", { command: "echo", args: ["hello"] });
    assertEquals(result.success, true);
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
