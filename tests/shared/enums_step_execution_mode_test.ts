/**
 * @module FlowStepExecutionModeTest
 * @path tests/shared/enums_step_execution_mode_test.ts
 * @description Verifies the FlowStepExecutionMode enum and tool classification constants for dynamic flow steps.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { FlowStepExecutionMode } from "@exaix/core";
import { McpToolName, READ_ONLY_TOOLS, WRITE_TOOLS } from "@exaix/mcp";

/**
 * Tests for Phase 56 Step 1.1-1.4: Schema and Enum Updates
 *
 * Success Criteria:
 * - FlowStepExecutionMode enum has DECLARED and DYNAMIC values
 * - READ_ONLY_TOOLS contains read_file, list_directory, search_files
 * - WRITE_TOOLS contains write_file, run_command, create_directory
 * - Tool classification is mutually exclusive
 */

Deno.test("FlowStepExecutionMode enum has correct values", () => {
  assertEquals(FlowStepExecutionMode.DECLARED, "declared");
  assertEquals(FlowStepExecutionMode.DYNAMIC, "dynamic");
});

Deno.test("READ_ONLY_TOOLS contains correct tools", () => {
  assert(READ_ONLY_TOOLS.has(McpToolName.READ_FILE));
  assert(READ_ONLY_TOOLS.has(McpToolName.LIST_DIRECTORY));
  assert(READ_ONLY_TOOLS.has(McpToolName.SEARCH_FILES));
});

Deno.test("WRITE_TOOLS contains correct tools", () => {
  assert(WRITE_TOOLS.has(McpToolName.WRITE_FILE));
  assert(WRITE_TOOLS.has(McpToolName.RUN_COMMAND));
  assert(WRITE_TOOLS.has(McpToolName.CREATE_DIRECTORY));
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
