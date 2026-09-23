/**
 * @module ReadOnlyEditorToolsTest
 * @path packages/tool-runtime/tests/read_only_editor_tools_test.ts
 * @description Verifies `readOnlyEditorTools()`: the exact read-only tool catalog the
 *   Phase 199 planning tool loop may offer the planning LLM call. Structurally derived
 *   from `createCoreToolSchemas()`'s `sideEffectScope === NONE` subset, minus
 *   `PLANNING_TOOLS_EXCLUDED` (`list_available_tools`, which would advertise write tools
 *   the planner can never call).
 * @architectural-layer Test
 * @related-files [packages/tool-runtime/src/tool_schemas.ts, packages/core/src/types/constants.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { readOnlyEditorTools } from "@exaix/tool-runtime";
import { ToolName, ToolSideEffectScope } from "@exaix/core";

const EXPECTED_PLANNING_TOOL_NAMES = [
  ToolName.READ_FILE,
  ToolName.LIST_DIRECTORY,
  ToolName.SEARCH_FILES,
  ToolName.GREP_SEARCH,
  ToolName.GIT_INFO,
  ToolName.QUERY_RELATIONSHIPS,
  ToolName.WHO_DEPENDS_ON,
  ToolName.QUERY_SYMBOLS,
  ToolName.GET_MODULE_DEPENDENCIES,
  ToolName.SEARCH_MEMORY,
].sort();

const MUTATING_TOOL_NAMES = [
  ToolName.WRITE_FILE,
  ToolName.PATCH_FILE,
  ToolName.RUN_COMMAND,
  ToolName.FETCH_URL,
  ToolName.REMEMBER_FACT,
  ToolName.CREATE_DIRECTORY,
  ToolName.MOVE_FILE,
  ToolName.COPY_FILE,
  ToolName.DELETE_FILE,
];

Deno.test("[readOnlyEditorTools] returns exactly the 10-name NONE-scope catalog minus PLANNING_TOOLS_EXCLUDED", () => {
  const names = readOnlyEditorTools().map((t) => t.name).sort();
  assertEquals(names, EXPECTED_PLANNING_TOOL_NAMES);
});

Deno.test("[readOnlyEditorTools] every entry has sideEffectScope NONE (structural guard)", () => {
  const tools = readOnlyEditorTools();
  assert(tools.length > 0, "expected a non-empty catalog");
  for (const tool of tools) {
    assertEquals(
      tool.sideEffectScope,
      ToolSideEffectScope.NONE,
      `${tool.name} must be NONE-scope to appear in the planning catalog`,
    );
  }
});

Deno.test("[readOnlyEditorTools] excludes mutating tools and list_available_tools", () => {
  const names = new Set(readOnlyEditorTools().map((t) => t.name));
  for (const mutating of MUTATING_TOOL_NAMES) {
    assert(!names.has(mutating), `${mutating} must not appear in the planning catalog`);
  }
  assert(
    !names.has(ToolName.LIST_AVAILABLE_TOOLS),
    "list_available_tools must be excluded (would advertise write tools the planner can never call)",
  );
});
