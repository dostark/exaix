/**
 * @module OpencodePlanSchemaAdapterTest
 * @path packages/ai-clidelegate/tests/opencode_plan_schema_adapter_test.ts
 * @related-files [packages/ai-clidelegate/src/opencode_plan_schema_adapter.ts]
 * @architectural-layer AI
 * @description RED-first tests for the opencode plan-JSON normalizer. Root cause traced
 *   live (swe-fix-bug-null-guard-cli-all, --cell opencode, sandbox mrudl4zj-f6d1059f,
 *   trace 340a896b-74fe-4d85-bccf-2d045a564455): opencode/deepseek-v4-flash-free's
 *   read-only planning call (edit/bash/task denied via OPENCODE_CONFIG) has no real
 *   tool-calling to anchor it, so it freehand-writes plan JSON using tool names from
 *   neither Exaix's McpToolName enum nor opencode's own native tool set (read, write,
 *   edit, bash, grep) — e.g. "edit_file" with {path, oldString, newString} params,
 *   which plan_schema.ts's `tool: z.nativeEnum(McpToolName)` rejects outright, three
 *   retries in a row, identically. This adapter normalizes both the tool name AND the
 *   params shape (McpToolName's params contracts differ structurally — patch_file wants
 *   `patches: [{search, replace}]`, not flat oldString/newString) before the text reaches
 *   real plan validation.
 */

import { assertEquals } from "@std/assert";
import { adaptOpencodePlanJson } from "../src/opencode_plan_schema_adapter.ts";

Deno.test("[opencode_plan_schema_adapter] remaps edit_file + oldString/newString to patch_file + patches[] (the live-observed case)", () => {
  const raw = JSON.stringify({
    title: "Add null guards to formatAssignee and formatDueDate",
    description: "Prevent crashes when task.assignee or task.dueDate are null.",
    steps: [
      {
        step: 1,
        title: "Guard formatAssignee against null assignee",
        description: "Add null check.",
        tools: ["edit_file"],
        actions: [
          {
            tool: "edit_file",
            params: {
              path: "/ws/todo-app/src/utils.ts",
              oldString: "  return task.assignee.name.toUpperCase();",
              newString: '  return task.assignee ? task.assignee.name.toUpperCase() : "";',
            },
          },
        ],
        successCriteria: ['formatAssignee returns "" for task with null assignee'],
        dependencies: [],
      },
    ],
  });

  const result = adaptOpencodePlanJson(raw);

  assertEquals(result.changed, true);
  const parsed = JSON.parse(result.json);
  const action = parsed.steps[0].actions[0];
  assertEquals(action.tool, "patch_file");
  assertEquals(action.params, {
    path: "/ws/todo-app/src/utils.ts",
    patches: [{
      search: "  return task.assignee.name.toUpperCase();",
      replace: '  return task.assignee ? task.assignee.name.toUpperCase() : "";',
    }],
  });
  assertEquals(parsed.steps[0].tools, ["patch_file"]);
});

Deno.test("[opencode_plan_schema_adapter] remaps opencode's native 'edit' tool the same way as 'edit_file'", () => {
  const raw = JSON.stringify({
    title: "t",
    description: "d",
    steps: [{
      step: 1,
      title: "t1",
      description: "d1",
      actions: [{
        tool: "edit",
        params: { filePath: "src/a.ts", oldString: "a", newString: "b" },
      }],
    }],
  });

  const result = adaptOpencodePlanJson(raw);
  const parsed = JSON.parse(result.json);
  assertEquals(parsed.steps[0].actions[0].tool, "patch_file");
  assertEquals(parsed.steps[0].actions[0].params, {
    path: "src/a.ts",
    patches: [{ search: "a", replace: "b" }],
  });
});

Deno.test("[opencode_plan_schema_adapter] remaps read/write/bash/grep/list to their McpToolName equivalents", () => {
  const raw = JSON.stringify({
    title: "t",
    description: "d",
    steps: [{
      step: 1,
      title: "t1",
      description: "d1",
      actions: [
        { tool: "read", params: { filePath: "a.ts" } },
        { tool: "write", params: { filePath: "b.ts", content: "x" } },
        { tool: "bash", params: { command: "deno test" } },
        { tool: "grep", params: { pattern: "foo", path: "." } },
        { tool: "list", params: { path: "." } },
      ],
    }],
  });

  const result = adaptOpencodePlanJson(raw);
  const parsed = JSON.parse(result.json);
  const tools = parsed.steps[0].actions.map((a: { tool: string }) => a.tool);
  assertEquals(tools, ["read_file", "write_file", "run_command", "search_files", "list_directory"]);
  assertEquals(parsed.steps[0].actions[0].params, { path: "a.ts" });
  assertEquals(parsed.steps[0].actions[1].params, { path: "b.ts", content: "x" });
});

Deno.test("[opencode_plan_schema_adapter] a plan already using valid McpToolName values passes through unchanged", () => {
  const raw = JSON.stringify({
    title: "t",
    description: "d",
    steps: [{
      step: 1,
      title: "t1",
      description: "d1",
      actions: [{ tool: "patch_file", params: { path: "a.ts", patches: [{ search: "a", replace: "b" }] } }],
    }],
  });

  const result = adaptOpencodePlanJson(raw);
  assertEquals(result.changed, false);
  assertEquals(JSON.parse(result.json), JSON.parse(raw));
});

Deno.test("[opencode_plan_schema_adapter] an unmappable tool name is left untouched (validation still rejects it, honestly)", () => {
  const raw = JSON.stringify({
    title: "t",
    description: "d",
    steps: [{
      step: 1,
      title: "t1",
      description: "d1",
      actions: [{ tool: "totally_unknown_tool", params: { foo: "bar" } }],
    }],
  });

  const result = adaptOpencodePlanJson(raw);
  assertEquals(result.changed, false);
  const parsed = JSON.parse(result.json);
  assertEquals(parsed.steps[0].actions[0].tool, "totally_unknown_tool");
});

Deno.test("[opencode_plan_schema_adapter] non-JSON or malformed input is returned unchanged rather than throwing", () => {
  const raw = "not json at all";
  const result = adaptOpencodePlanJson(raw);
  assertEquals(result.changed, false);
  assertEquals(result.json, raw);
});

Deno.test("[opencode_plan_schema_adapter] top-level tools list on a step is remapped alongside its actions", () => {
  const raw = JSON.stringify({
    title: "t",
    description: "d",
    steps: [{
      step: 1,
      title: "t1",
      description: "d1",
      tools: ["edit_file", "run_command"],
      actions: [
        { tool: "edit_file", params: { path: "a.ts", oldString: "x", newString: "y" } },
        { tool: "run_command", params: { command: "deno test" } },
      ],
    }],
  });

  const result = adaptOpencodePlanJson(raw);
  const parsed = JSON.parse(result.json);
  assertEquals(parsed.steps[0].tools, ["patch_file", "run_command"]);
});
