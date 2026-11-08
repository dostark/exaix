/**
 * @module FlowStepSchemaExecutionModeTest
 * @path packages/schemas/tests/flow_step_execution_mode_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Verifies FlowStepSchema supports execution_mode and permitted_tools fields for Phase 56 dynamic tool selection.
 */

import { assertEquals, assertNotMatch, assertThrows } from "@std/assert";
import { FlowStepSchema } from "@exaix/schemas/flow.ts";
import { FlowStepExecutionMode, FlowStepOnErrorAction, RETIRED_TOOL_RENAMES } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";

Deno.test("FlowStepSchema: accepts execution_mode: declared", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    execution_mode: FlowStepExecutionMode.DECLARED,
  };

  const result = FlowStepSchema.parse(step);

  assertEquals(result.execution_mode, FlowStepExecutionMode.DECLARED);
});

Deno.test("FlowStepSchema: accepts execution_mode: dynamic", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
  };

  const result = FlowStepSchema.parse(step);

  assertEquals(result.execution_mode, FlowStepExecutionMode.DYNAMIC);
});

Deno.test("FlowStepSchema: defaults execution_mode to DECLARED", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    // No execution_mode specified
  };

  const result = FlowStepSchema.parse(step);

  assertEquals(result.execution_mode, FlowStepExecutionMode.DECLARED);
});

Deno.test("FlowStepSchema: accepts permitted_tools array", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
    permitted_tools: [
      McpToolName.READ_FILE,
      McpToolName.LIST_DIRECTORY,
      McpToolName.SEARCH_FILES,
    ],
  };

  const result = FlowStepSchema.parse(step);

  assertEquals(result.permitted_tools, [
    McpToolName.READ_FILE,
    McpToolName.LIST_DIRECTORY,
    McpToolName.SEARCH_FILES,
  ]);
});

Deno.test("FlowStepSchema: accepts empty permitted_tools", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
    permitted_tools: [],
  };

  const result = FlowStepSchema.parse(step);

  assertEquals(result.permitted_tools, []);
});

Deno.test("FlowStepSchema: rejects invalid execution_mode", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    execution_mode: "invalid_mode",
  };

  assertThrows(() => FlowStepSchema.parse(step));
});

Deno.test("FlowStepSchema: rejects invalid tool in permitted_tools", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    permitted_tools: ["invalid_tool"],
  };

  assertThrows(() => FlowStepSchema.parse(step));
});

Deno.test("FlowStepSchema: strips unknown fields", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    unknown_field: "should be stripped",
  };

  const result = FlowStepSchema.parse(step);

  assertEquals("unknown_field" in result, false);
});

Deno.test("FlowStepSchema: a step that names a retired control-plane tool fails with a message naming the replacement", () => {
  for (const [retired, replacement] of Object.entries(RETIRED_TOOL_RENAMES)) {
    const base = { id: "test-step", name: "Test Step", agent_role: "senior-coder" };
    const hint = `Use '${replacement}' instead of '${retired}'`;
    assertThrows(() => FlowStepSchema.parse({ ...base, permitted_tools: [retired] }), Error, hint);
    assertThrows(
      () =>
        FlowStepSchema.parse({
          ...base,
          onError: { action: FlowStepOnErrorAction.COMPENSATE, compensate: [{ tool: retired, args: {} }] },
        }),
      Error,
      hint,
    );
    assertEquals(FlowStepSchema.parse({ ...base, permitted_tools: [replacement] }).permitted_tools, [replacement]);
  }
});

Deno.test("FlowStepSchema: a tool name that is not retired still fails and gets no rename hint", () => {
  const step = { id: "test-step", name: "Test Step", agent_role: "senior-coder", permitted_tools: ["not_a_tool"] };
  const error = assertThrows(() => FlowStepSchema.parse(step), Error);
  assertNotMatch(error.message, /instead of/);
});
