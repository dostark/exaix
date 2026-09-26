/**
 * @module ToolAliasesTest
 * @path packages/core/tests/types/tool_aliases_test.ts
 * @description Tests for the static tool/parameter alias map: canonicalizeToolName and
 *   canonicalizeToolCall resolve alias and case-variant names to canonical ToolName /
 *   McpToolName values, rename parameters only where the canonical tool accepts the target
 *   key, never shadow a canonical name, and never throw.
 * @architectural-layer Shared
 * @related-files [packages/core/src/types/tool_aliases.ts, packages/core/src/types/enums.ts]
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  canonicalizeToolCall,
  canonicalizeToolName,
  COMMON_PARAM_ALIASES,
  isRejectedNativeToolName,
  McpToolName,
  NATIVE_TOOL_NAMES,
  TOOL_ALIASES,
  TOOL_PARAM_ALIASES,
  ToolName,
} from "@exaix/core";
import type { JSONValue } from "@exaix/core";

const CANONICAL_NAMES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ToolName),
  ...Object.values(McpToolName),
]);
const PATH_TOOL_PARAMS: ReadonlySet<string> = new Set(["path", "content"]);
const PATCH_FILE_PARAMS: ReadonlySet<string> = new Set(["path", "search", "replace"]);

Deno.test("[tool_aliases] a canonical name passes through unchanged and rewritten is false", () => {
  const result = canonicalizeToolCall(ToolName.READ_FILE, { path: "a.ts" }, PATH_TOOL_PARAMS);
  assertEquals(result.name, ToolName.READ_FILE);
  assertEquals(result.params, { path: "a.ts" });
  assertEquals(result.rewritten, false);
  assertEquals(result.requestedName, ToolName.READ_FILE);
});

Deno.test("[tool_aliases] glob, Glob and GLOB all resolve to search_files", () => {
  for (const name of ["glob", "Glob", "GLOB", "  glob  "]) {
    assertEquals(canonicalizeToolName(name), ToolName.SEARCH_FILES, name);
    const result = canonicalizeToolCall(name, {});
    assertEquals(result.name, ToolName.SEARCH_FILES);
    assertEquals(result.rewritten, true);
    assertEquals(result.requestedName, name);
  }
});

Deno.test("[tool_aliases] file_path, filePath and target_file rename to path only when the tool accepts path", () => {
  for (const alias of ["file_path", "filePath", "target_file"]) {
    const accepted = canonicalizeToolCall(ToolName.READ_FILE, { [alias]: "a.ts" }, PATH_TOOL_PARAMS);
    assertEquals(accepted.params, { path: "a.ts" }, alias);
    assertEquals(accepted.renamedParams, [{ from: alias, to: "path" }]);
    assertEquals(accepted.rewritten, true);

    const notAccepted = canonicalizeToolCall(ToolName.GIT_INFO, { [alias]: "a.ts" }, new Set(["repo_path", "scope"]));
    assertEquals(notAccepted.params, { [alias]: "a.ts" }, alias);
    assertEquals(notAccepted.rewritten, false);
  }
});

Deno.test("[tool_aliases] common path aliases are not applied when acceptedParams is omitted", () => {
  const result = canonicalizeToolCall(ToolName.READ_FILE, { file_path: "a.ts" });
  assertEquals(result.params, { file_path: "a.ts" });
});

Deno.test("[tool_aliases] both path and file_path present keeps path and lists file_path in droppedParams", () => {
  const result = canonicalizeToolCall(ToolName.READ_FILE, { path: "keep.ts", file_path: "drop.ts" }, PATH_TOOL_PARAMS);
  assertEquals(result.params, { path: "keep.ts" });
  assertEquals(result.droppedParams, ["file_path"]);
  assertEquals(result.renamedParams, []);
  assertEquals(result.rewritten, true);
});

Deno.test("[tool_aliases] old_string/new_string rename to search/replace for patch_file and are left alone for read_file", () => {
  const patch = canonicalizeToolCall(
    "edit",
    { file_path: "a.ts", old_string: "x", new_string: "y" },
    PATCH_FILE_PARAMS,
  );
  assertEquals(patch.name, ToolName.PATCH_FILE);
  assertEquals(patch.params, { path: "a.ts", search: "x", replace: "y" });

  const read = canonicalizeToolCall(ToolName.READ_FILE, { path: "a.ts", old_string: "x" }, PATH_TOOL_PARAMS);
  assertEquals(read.params, { path: "a.ts", old_string: "x" });
});

Deno.test("[tool_aliases] a common alias key that the canonical tool itself declares is not renamed", () => {
  const accepted = new Set(["path", "directory"]);
  const result = canonicalizeToolCall(ToolName.LIST_DIRECTORY, { path: "a", directory: "b" }, accepted);
  assertEquals(result.params, { path: "a", directory: "b" });
  assertEquals(result.droppedParams, []);
  assertEquals(result.rewritten, false);
});

Deno.test("[tool_aliases] an unknown tool name passes through unchanged", () => {
  const result = canonicalizeToolCall("Frobnicate", { file_path: "a" }, PATH_TOOL_PARAMS);
  assertEquals(result.name, "Frobnicate");
  assertEquals(canonicalizeToolName("Frobnicate"), "Frobnicate");
});

Deno.test("[tool_aliases] canonicalizeToolName resolves READ_FILE and Read_File to read_file and leaves an unknown name unchanged", () => {
  assertEquals(canonicalizeToolName("READ_FILE"), ToolName.READ_FILE);
  assertEquals(canonicalizeToolName("Read_File"), ToolName.READ_FILE);
  assertEquals(canonicalizeToolName("not_a_tool"), "not_a_tool");
  assertEquals(canonicalizeToolCall("READ_FILE", {}).rewritten, true);
});

Deno.test("[tool_aliases] canonicalizeToolCall never throws for empty names, non-string values and prototype-polluting keys", () => {
  assertEquals(canonicalizeToolCall("", {}).name, "");
  const values = { path: 1, content: null, other: [true, { a: 1 }] } as Record<string, JSONValue>;
  assertEquals(canonicalizeToolCall(ToolName.WRITE_FILE, values, PATH_TOOL_PARAMS).params, values);

  const polluted = JSON.parse('{"__proto__": {"polluted": true}, "constructor": "x", "file_path": "a"}') as Record<
    string,
    JSONValue
  >;
  const result = canonicalizeToolCall(ToolName.READ_FILE, polluted, PATH_TOOL_PARAMS);
  assertEquals(Object.getPrototypeOf(result.params), Object.prototype);
  assertEquals(({} as Record<string, JSONValue>).polluted, undefined);
  assertEquals(result.params.path, "a");
  assert(Object.hasOwn(result.params, "__proto__"));
  assertEquals(canonicalizeToolName("__proto__"), "__proto__");
  assertEquals(canonicalizeToolName("constructor"), "constructor");
});

Deno.test("[tool_aliases][parity] every alias target is a real ToolName or McpToolName value", () => {
  for (const [alias, entry] of Object.entries(TOOL_ALIASES)) {
    assert(CANONICAL_NAMES.has(entry.canonical), `${alias} -> ${entry.canonical}`);
  }
  for (const tool of Object.keys(TOOL_PARAM_ALIASES)) {
    assert(CANONICAL_NAMES.has(tool), `param aliases keyed on unknown tool ${tool}`);
  }
});

Deno.test("[tool_aliases][parity] no alias name equals a canonical ToolName or McpToolName value (no shadowing)", () => {
  for (const alias of Object.keys(TOOL_ALIASES)) {
    assertEquals(alias, alias.toLowerCase(), `alias keys are lowercase: ${alias}`);
    assert(!CANONICAL_NAMES.has(alias), `alias ${alias} shadows a canonical tool name`);
  }
});

Deno.test("[tool_aliases][parity] no alias in the table targets run_command", () => {
  for (const [alias, entry] of Object.entries(TOOL_ALIASES)) {
    assert(entry.canonical !== ToolName.RUN_COMMAND, `alias ${alias} targets run_command`);
  }
  for (const alias of ["bash", "shell", "run_shell_command", "run_terminal_cmd"]) {
    assertEquals(canonicalizeToolName(alias), alias);
  }
});

Deno.test("[tool_aliases] every seed alias resolves to its documented canonical name", () => {
  const expected: Record<string, string> = {
    glob: ToolName.SEARCH_FILES,
    glob_file_search: ToolName.SEARCH_FILES,
    file_search: ToolName.SEARCH_FILES,
    find_files: ToolName.SEARCH_FILES,
    grep: ToolName.GREP_SEARCH,
    rg: ToolName.GREP_SEARCH,
    ripgrep: ToolName.GREP_SEARCH,
    text_search: ToolName.GREP_SEARCH,
    search_file_content: ToolName.GREP_SEARCH,
    grep_files: ToolName.GREP_SEARCH,
    grep_search: ToolName.GREP_SEARCH,
    read: ToolName.READ_FILE,
    read_text_file: ToolName.READ_FILE,
    write: ToolName.WRITE_FILE,
    create_file: ToolName.WRITE_FILE,
    edit: ToolName.PATCH_FILE,
    str_replace: ToolName.PATCH_FILE,
    replace: ToolName.PATCH_FILE,
    list_dir: ToolName.LIST_DIRECTORY,
    ls: ToolName.LIST_DIRECTORY,
    list: ToolName.LIST_DIRECTORY,
    mkdir: ToolName.CREATE_DIRECTORY,
    move: ToolName.MOVE_FILE,
    mv: ToolName.MOVE_FILE,
    rename_file: ToolName.MOVE_FILE,
    copy: ToolName.COPY_FILE,
    cp: ToolName.COPY_FILE,
    delete: ToolName.DELETE_FILE,
    rm: ToolName.DELETE_FILE,
    remove_file: ToolName.DELETE_FILE,
    webfetch: ToolName.FETCH_URL,
    web_fetch: ToolName.FETCH_URL,
    save_memory: ToolName.REMEMBER_FACT,
    list_tools: ToolName.LIST_AVAILABLE_TOOLS,
  };
  assertEquals(Object.keys(TOOL_ALIASES).sort(), Object.keys(expected).sort());
  for (const [alias, canonical] of Object.entries(expected)) {
    assertEquals(canonicalizeToolName(alias), canonical, alias);
  }
});

Deno.test("[tool_aliases] every seed parameter alias renames to its documented canonical key", () => {
  const cases: Array<{ tool: string; accepted: string[]; from: string; to: string }> = [
    ...Object.keys(COMMON_PARAM_ALIASES).map((from) => ({
      tool: ToolName.READ_FILE,
      accepted: ["path"],
      from,
      to: "path",
    })),
    { tool: ToolName.SEARCH_FILES, accepted: ["pattern", "path"], from: "query", to: "pattern" },
    { tool: ToolName.GREP_SEARCH, accepted: ["pattern", "path"], from: "query", to: "pattern" },
    { tool: ToolName.GREP_SEARCH, accepted: ["pattern", "path"], from: "regex", to: "pattern" },
    { tool: ToolName.PATCH_FILE, accepted: ["path", "search", "replace"], from: "oldString", to: "search" },
    { tool: ToolName.PATCH_FILE, accepted: ["path", "search", "replace"], from: "old_text", to: "search" },
    { tool: ToolName.PATCH_FILE, accepted: ["path", "search", "replace"], from: "newString", to: "replace" },
    { tool: ToolName.PATCH_FILE, accepted: ["path", "search", "replace"], from: "new_text", to: "replace" },
    { tool: ToolName.MOVE_FILE, accepted: ["from", "to"], from: "source", to: "from" },
    { tool: ToolName.MOVE_FILE, accepted: ["from", "to"], from: "destination", to: "to" },
    { tool: ToolName.COPY_FILE, accepted: ["source", "destination"], from: "from", to: "source" },
    { tool: ToolName.COPY_FILE, accepted: ["source", "destination"], from: "to", to: "destination" },
    { tool: ToolName.QUERY_SYMBOLS, accepted: ["name", "kind"], from: "query", to: "name" },
    { tool: ToolName.REMEMBER_FACT, accepted: ["content", "tags"], from: "fact", to: "content" },
  ];
  for (const { tool, accepted, from, to } of cases) {
    const result = canonicalizeToolCall(tool, { [from]: "v" }, new Set(accepted));
    assertEquals(result.params, { [to]: "v" }, `${tool}: ${from} -> ${to}`);
  }
});

Deno.test("[tool_aliases] native query_symbols/query_relationships/get_module_dependencies names pass unchanged", () => {
  for (const native of [ToolName.QUERY_SYMBOLS, ToolName.QUERY_RELATIONSHIPS, ToolName.GET_MODULE_DEPENDENCIES]) {
    assertEquals(canonicalizeToolName(native), native);
    assertFalse(isRejectedNativeToolName(native), native);
  }
});

Deno.test("[tool_aliases] dependents and list_symbols are retired native aliases, not seeded", () => {
  assertFalse(Object.hasOwn(TOOL_ALIASES, "dependents"));
  assertFalse(Object.hasOwn(TOOL_ALIASES, "list_symbols"));
  assert(isRejectedNativeToolName("dependents"));
  assert(isRejectedNativeToolName("list_symbols"));
  assertEquals(canonicalizeToolName("dependents"), "dependents");
  assertEquals(canonicalizeToolName("list_symbols"), "list_symbols");
});

Deno.test("[naming] who_depends_on and deno_task are rejected after the Step 4 rename; find_dependents/run_deno_task resolve", () => {
  assertFalse(Object.hasOwn(TOOL_ALIASES, "who_depends_on"));
  assertFalse(Object.hasOwn(TOOL_ALIASES, "deno_task"));
  assert(isRejectedNativeToolName("who_depends_on"));
  assert(isRejectedNativeToolName("deno_task"));
  assertEquals(canonicalizeToolName("who_depends_on"), "who_depends_on");
  assertEquals(canonicalizeToolName("deno_task"), "deno_task");
  assertEquals(canonicalizeToolName(ToolName.WHO_DEPENDS_ON), ToolName.WHO_DEPENDS_ON);
  assertEquals(canonicalizeToolName(ToolName.DENO_TASK), ToolName.DENO_TASK);
  assertFalse(isRejectedNativeToolName(ToolName.WHO_DEPENDS_ON));
  assertFalse(isRejectedNativeToolName(ToolName.DENO_TASK));
});

Deno.test("[tool_aliases] native case or whitespace variants remain unresolved and are rejected", () => {
  assertEquals(canonicalizeToolName("Query_Symbols"), "Query_Symbols");
  assertEquals(canonicalizeToolName(" query_symbols "), " query_symbols ");
  assert(isRejectedNativeToolName("Query_Symbols"));
  assert(isRejectedNativeToolName(" query_symbols "));
});

Deno.test("[tool_aliases] general-purpose Read/glob/grep/webfetch still resolve and are never rejected as native", () => {
  for (const generalPurpose of ["Read", "glob", "grep", "webfetch", "Write"]) {
    assertFalse(isRejectedNativeToolName(generalPurpose), generalPurpose);
  }
  assertEquals(canonicalizeToolName("glob"), ToolName.SEARCH_FILES);
  assertEquals(canonicalizeToolName("grep"), ToolName.GREP_SEARCH);
});

Deno.test("[tool_aliases] isRejectedNativeToolName leaves unrelated custom names alone", () => {
  for (const name of ["", "my_custom_tool", "search_files", ToolName.RUN_COMMAND]) {
    assertFalse(isRejectedNativeToolName(name), name);
  }
});

Deno.test("[tool_aliases] NATIVE_TOOL_NAMES contains the current exaix-specific and exaix_* control-plane values", () => {
  for (
    const expected of [
      ToolName.DENO_TASK,
      ToolName.WHO_DEPENDS_ON,
      ToolName.QUERY_SYMBOLS,
      ToolName.QUERY_RELATIONSHIPS,
      ToolName.GET_MODULE_DEPENDENCIES,
      McpToolName.PORTAL_SYMBOLS,
      McpToolName.CREATE_REQUEST,
      McpToolName.CONFIG_APPLY,
    ]
  ) {
    assert(NATIVE_TOOL_NAMES.has(expected), expected);
  }
  assertFalse(NATIVE_TOOL_NAMES.has(ToolName.SEARCH_FILES));
});
