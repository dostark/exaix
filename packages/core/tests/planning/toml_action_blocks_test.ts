/**
 * @module TomlActionBlocksTest
 * @path packages/core/tests/planning/toml_action_blocks_test.ts
 * @description Verifies extractTomlActionBlocks() finds TOML_BLOCK:N sentinel-marked
 *   fenced ```toml blocks in a raw LLM <content> response and extracts them into
 *   IPlanAction[] grouped by marker number, leaving the surrounding JSON envelope
 *   untouched — the no-JSON-escaping alternative to inline write_file.content /
 *   patch_file.search / patch_file.replace values (Phase 151).
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/toml_action_blocks.ts, packages/core/src/planning/plan_adapter.ts]
 */

import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import { extractTomlActionBlocks } from "../../src/planning/toml_action_blocks.ts";

Deno.test("extractTomlActionBlocks: no TOML fence returns the envelope unchanged", () => {
  const rawContent = `{"title": "A plan", "steps": []}`;

  const result = extractTomlActionBlocks(rawContent);

  assertEquals(result.envelope, rawContent);
  assertEquals(result.actionsByBlock.size, 0);
});

Deno.test("extractTomlActionBlocks: single block extracts a matching IPlanAction with embedded quotes/newlines intact", () => {
  const envelopeJson = `{"title": "A plan", "steps": [{"step": 1, "actions": "TOML_BLOCK:1"}]}`;
  const rawContent = `${envelopeJson}

\`\`\`toml
# TOML_BLOCK:1
tool = "write_file"
description = "Add the handler"
[params]
path = "src/api.ts"
content = '''
export function checkDuplicateLimit(title: string, existingTasks: ITask[]): boolean {
  return existingTasks.some((t) => t.title === "duplicate-check" && t.title === title);
}
'''
\`\`\`
`;

  const result = extractTomlActionBlocks(rawContent);

  assertEquals(result.actionsByBlock.size, 1);
  const actions = result.actionsByBlock.get(1);
  assertEquals(actions?.length, 1);
  assertEquals(actions?.[0].tool, "write_file");
  assertEquals(actions?.[0].description, "Add the handler");
  assertEquals(actions?.[0].params.path, "src/api.ts");
  assertEquals(
    actions?.[0].params.content,
    `export function checkDuplicateLimit(title: string, existingTasks: ITask[]): boolean {
  return existingTasks.some((t) => t.title === "duplicate-check" && t.title === title);
}
`,
  );
  assertMatch(result.envelope, /"actions": "TOML_BLOCK:1"/);
});

Deno.test("extractTomlActionBlocks: patch_file block extracts search/replace byte-for-byte with no content field", () => {
  const rawContent = `{"steps":[{"step":1,"actions":"TOML_BLOCK:2"}]}

\`\`\`toml
# TOML_BLOCK:2
tool = "patch_file"
description = "Add null guard to formatDueDate"
[params]
path = "src/utils.ts"
search = '''
export function formatDueDate(task: ITask): string {
  return task.dueDate.slice(0, 10);
}
'''
replace = '''
export function formatDueDate(task: ITask): string {
  return task.dueDate ? task.dueDate.slice(0, 10) : "";
}
'''
\`\`\`
`;

  const result = extractTomlActionBlocks(rawContent);

  const actions = result.actionsByBlock.get(2);
  assertEquals(actions?.length, 1);
  assertEquals(actions?.[0].tool, "patch_file");
  assertEquals(actions?.[0].params.content, undefined);
  assertEquals(
    actions?.[0].params.search,
    `export function formatDueDate(task: ITask): string {
  return task.dueDate.slice(0, 10);
}
`,
  );
  assertEquals(
    actions?.[0].params.replace,
    `export function formatDueDate(task: ITask): string {
  return task.dueDate ? task.dueDate.slice(0, 10) : "";
}
`,
  );
});

Deno.test("extractTomlActionBlocks: different marker numbers resolve to distinct, correctly-keyed action lists", () => {
  const rawContent = `{"steps":[]}

\`\`\`toml
# TOML_BLOCK:1
tool = "write_file"
[params]
path = "a.ts"
content = "a"
\`\`\`

\`\`\`toml
# TOML_BLOCK:2
tool = "write_file"
[params]
path = "b.ts"
content = "b"
\`\`\`
`;

  const result = extractTomlActionBlocks(rawContent);

  assertEquals(result.actionsByBlock.size, 2);
  assertEquals(result.actionsByBlock.get(1)?.[0].params.path, "a.ts");
  assertEquals(result.actionsByBlock.get(2)?.[0].params.path, "b.ts");
});

Deno.test("extractTomlActionBlocks: two blocks sharing one marker resolve to one ordered two-element action list", () => {
  const rawContent = `{"steps":[]}

\`\`\`toml
# TOML_BLOCK:1
tool = "read_file"
[params]
path = "src/api.ts"
\`\`\`

\`\`\`toml
# TOML_BLOCK:1
tool = "write_file"
[params]
path = "src/api.ts"
content = "updated"
\`\`\`
`;

  const result = extractTomlActionBlocks(rawContent);

  const actions = result.actionsByBlock.get(1);
  assertEquals(actions?.length, 2);
  assertEquals(actions?.[0].tool, "read_file");
  assertEquals(actions?.[1].tool, "write_file");
});

Deno.test("extractTomlActionBlocks: malformed TOML throws a descriptive Error", () => {
  const rawContent = `{"steps":[]}

\`\`\`toml
# TOML_BLOCK:1
tool = "write_file
[params
path = "a.ts"
\`\`\`
`;

  assertThrows(
    () => extractTomlActionBlocks(rawContent),
    Error,
    "TOML_BLOCK:1",
  );
});

Deno.test("extractTomlActionBlocks: a block whose TOML root is an array-of-tables (not a flat action) throws", () => {
  const rawContent = `{"steps":[]}

\`\`\`toml
# TOML_BLOCK:1
[[action]]
tool = "write_file"
[action.params]
path = "a.ts"
content = "a"
\`\`\`
`;

  assertThrows(
    () => extractTomlActionBlocks(rawContent),
    Error,
    "TOML_BLOCK:1",
  );
});

Deno.test("extractTomlActionBlocks: a block with valid TOML but no tool field throws", () => {
  const rawContent = `{"steps":[]}

\`\`\`toml
# TOML_BLOCK:1
[params]
path = "a.ts"
\`\`\`
`;

  assertThrows(
    () => extractTomlActionBlocks(rawContent),
    Error,
    "TOML_BLOCK:1",
  );
});

Deno.test("extractTomlActionBlocks: reusing the same marker across multiple blocks is not an error", () => {
  const rawContent = `{"steps":[]}

\`\`\`toml
# TOML_BLOCK:1
tool = "read_file"
[params]
path = "a.ts"
\`\`\`

\`\`\`toml
# TOML_BLOCK:1
tool = "write_file"
[params]
path = "a.ts"
content = "a"
\`\`\`
`;

  const result = extractTomlActionBlocks(rawContent);

  assertEquals(result.actionsByBlock.get(1)?.length, 2);
});

Deno.test("extractTomlActionBlocks: regression — the live-observed embedded-quote transcription failure round-trips correctly", () => {
  const rawContent = `{"steps":[{"step":1,"actions":"TOML_BLOCK:1"}]}

\`\`\`toml
# TOML_BLOCK:1
tool = "write_file"
[params]
path = "src/business_logic.ts"
content = '''
function checkDuplicateLimit(title: string, existingTasks: ITask[]): boolean {
  const key = "existingTasks";
  return existingTasks.filter((t) => t.title === title).length > 0;
}
'''
\`\`\`
`;

  const result = extractTomlActionBlocks(rawContent);

  const actions = result.actionsByBlock.get(1);
  assertEquals(actions?.length, 1);
  assertMatch(String(actions?.[0].params.content), /const key = "existingTasks";/);
});
