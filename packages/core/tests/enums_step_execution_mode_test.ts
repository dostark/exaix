/**
 * @module FlowStepExecutionModeTest
 * @path packages/core/tests/enums_step_execution_mode_test.ts
 * @description Verifies stable FlowStepExecutionMode enum behavior and backward-compatible MCP tool classification invariants.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { FlowStepExecutionMode } from "@exaix/core";
import { McpToolName, READ_ONLY_TOOLS, WRITE_TOOLS } from "@exaix/mcp";

Deno.test("FlowStepExecutionMode enum has correct values", () => {
  assertEquals(FlowStepExecutionMode.DECLARED, "declared");
  assertEquals(FlowStepExecutionMode.DYNAMIC, "dynamic");
});

Deno.test("Tool classification is mutually exclusive", () => {
  // No tool should be in both sets
  for (const tool of READ_ONLY_TOOLS) {
    assertFalse(
      WRITE_TOOLS.has(tool),
      `Tool ${tool} should not be in both READ_ONLY and WRITE sets`,
    );
  }

  for (const tool of WRITE_TOOLS) {
    assertFalse(
      READ_ONLY_TOOLS.has(tool),
      `Tool ${tool} should not be in both WRITE and READ_ONLY sets`,
    );
  }
});

Deno.test("All MCP tools are classified", () => {
  const allTools = [...READ_ONLY_TOOLS, ...WRITE_TOOLS];
  const uniqueTools = new Set(allTools);

  // Verify no duplicates
  assertEquals(allTools.length, uniqueTools.size);

  // Verify we have all McpToolName values
  const allMcpToolNames = Object.values(McpToolName);
  for (const tool of allMcpToolNames) {
    assert(
      READ_ONLY_TOOLS.has(tool) || WRITE_TOOLS.has(tool),
      `Tool ${tool} should be classified as either READ_ONLY or WRITE`,
    );
  }
});

Deno.test("Dead enum entries removed: FETCH_URL is not a McpToolName value", () => {
  assertFalse(
    (Object.values(McpToolName) as string[]).includes("FETCH_URL"),
    'McpToolName must not contain dead entry "FETCH_URL" — internal-only tools belong in ToolName',
  );
});

Deno.test("Dead enum entries removed: raw GIT is not a McpToolName value", () => {
  assertFalse(
    (Object.values(McpToolName) as string[]).includes("git"),
    'McpToolName must not contain dead entry "git" — git_* tools use specific suffixed names',
  );
});
