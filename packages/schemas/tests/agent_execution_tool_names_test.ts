/**
 * @module AgentExecutionToolNamesTest
 * @path packages/schemas/tests/agent_execution_tool_names_test.ts
 * @description Verifies InputValidator.validateAgentExecutionOptions accepts exact native
 *   tool names and supported general-purpose aliases in permitted_tools, rejects
 *   list_symbols and native case/whitespace variants, preserves unrelated custom names, and
 *   distinguishes undefined from an explicit empty allowlist (Phase 201 Step 3,
 *   fourth-review GAP-2).
 * @architectural-layer Schemas
 * @related-files [packages/schemas/src/agent_composer.ts, packages/core/src/types/tool_aliases.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import type { AgentExecutionOptionsSchema } from "@exaix/schemas";
import { InputValidator } from "@exaix/schemas/input_validation.ts";
import { ToolName } from "@exaix/core";

function baseOptions(permitted_tools?: string[]): z.input<typeof AgentExecutionOptionsSchema> {
  return {
    agent_role: "agent-a",
    portal: "test-portal",
    ...(permitted_tools !== undefined ? { permitted_tools } : {}),
  };
}

Deno.test("[agent_execution_options] accepts exact native names and general-purpose Read/grep", () => {
  const result = InputValidator.validateAgentExecutionOptions(
    baseOptions([ToolName.QUERY_SYMBOLS, "Read", "grep"]),
  );
  assertEquals(result.permitted_tools, [ToolName.QUERY_SYMBOLS, "Read", "grep"]);
});

Deno.test("[agent_execution_options] rejects list_symbols", () => {
  assertThrows(() => InputValidator.validateAgentExecutionOptions(baseOptions(["list_symbols"])), z.ZodError);
});

Deno.test("[agent_execution_options] rejects a native case/whitespace variant", () => {
  assertThrows(() => InputValidator.validateAgentExecutionOptions(baseOptions(["Query_Symbols"])), z.ZodError);
});

Deno.test("[agent_execution_options] preserves an unrelated custom tool name", () => {
  const result = InputValidator.validateAgentExecutionOptions(baseOptions(["my_custom_tool"]));
  assertEquals(result.permitted_tools, ["my_custom_tool"]);
});

Deno.test("[agent_execution_options] distinguishes undefined permitted_tools from an explicit empty array", () => {
  const undef = InputValidator.validateAgentExecutionOptions(baseOptions());
  const empty = InputValidator.validateAgentExecutionOptions(baseOptions([]));
  assertEquals(undef.permitted_tools, undefined);
  assertEquals(empty.permitted_tools, []);
});
