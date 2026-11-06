/**
 * @module ExaCtlRenamesTest
 * @path apps/exactl/tests/exactl_renames_test.ts
 * @description Verifies the rename table lookup, the rename hint text and the shell quoting of echoed text.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/exactl_renames.ts]
 * @related-files [apps/exactl/src/exactl_renames.ts]
 */

import { assert, assertEquals, assertNotEquals, assertStrictEquals, assertStringIncludes } from "@std/assert";
import { EXACTL_RENAMES, findRename, MAX_HINT_ECHO_CHARS, quoteForShell, renameHint } from "../src/exactl_renames.ts";

function rowFor(legacy: readonly string[]) {
  const row = findRename(legacy);
  assert(row !== null, `no rename row for ${legacy.join(" ")}`);
  return row;
}

Deno.test("findRename returns the row for every table entry", () => {
  assertNotEquals(EXACTL_RENAMES.length, 0);
  for (const row of EXACTL_RENAMES) {
    assertStrictEquals(findRename(row.legacy), row, row.legacy.join(" "));
  }
});

Deno.test("findRename returns null for a never-renamed path", () => {
  assertEquals(findRename(["blueprint", "list"]), null);
  assertEquals(findRename(["plan"]), null);
  assertEquals(findRename([]), null);
});

Deno.test("findRename matches the legacy words as a prefix of the typed words", () => {
  const exact = rowFor(["blueprint", "ls"]);
  assertStrictEquals(findRename(["blueprint", "ls", "extra"]), exact);
});

Deno.test("renameHint names the legacy command and the replacement", () => {
  const typed = ["blueprint", "ls"];
  const hint = renameHint(rowFor(typed), typed);
  assertStringIncludes(hint, "'exactl blueprint ls' was renamed");
  assertStringIncludes(hint, "use 'exactl blueprint list'");
});

Deno.test("renameHint appends the typed words that follow the legacy prefix", () => {
  const typed = ["blueprint", "rm", "my-agent"];
  assertStringIncludes(renameHint(rowFor(typed), typed), "use 'exactl blueprint remove my-agent'");
  const nested = ["blueprint", "agent-role", "list"];
  assertStringIncludes(renameHint(rowFor(nested), nested), "use 'exactl blueprint list'");
});

Deno.test("renameHint quotes a trailing word that is not a plain token", () => {
  const typed = ["blueprint", "rm", "$(touch pwned)"];
  assertStringIncludes(renameHint(rowFor(typed), typed), "remove '$(touch pwned)'");
});

Deno.test("quoteForShell neutralizes quotes, $(…), backticks, newlines and control characters, and truncates at MAX_HINT_ECHO_CHARS", () => {
  assertEquals(quoteForShell("Fix bug"), "'Fix bug'");
  assertEquals(quoteForShell("it's"), `'it'\\''s'`);
  assertEquals(quoteForShell("$(rm -rf ~)"), "'$(rm -rf ~)'");
  assertEquals(quoteForShell("`id`"), "'`id`'");
  assertEquals(quoteForShell("a\nb"), "'ab'");
  assertEquals(quoteForShell("a\u0007b\u001b[31mc"), "'ab[31mc'");
  const long = "a".repeat(MAX_HINT_ECHO_CHARS + 10);
  assertEquals(quoteForShell(long), `'${"a".repeat(MAX_HINT_ECHO_CHARS)}'`);
});

Deno.test("the journal paths map to log paths", () => {
  const expected: Array<[string[], string]> = [
    [["journal"], "exactl log list"],
    [["logs"], "exactl log list"],
    [["log", "journal"], "exactl log list"],
    [["journal", "wait"], "exactl log wait"],
    [["log", "journal", "wait"], "exactl log wait"],
    [["journal", "verify"], "exactl log verify"],
    [["log", "journal", "verify"], "exactl log verify"],
    [["cost"], "exactl log cost"],
    [["journal", "export-otel"], "exactl log export-otel"],
  ];
  for (const [legacy, canonical] of expected) {
    assertEquals(findRename(legacy)?.canonical, canonical, legacy.join(" "));
  }
});

Deno.test("a valid log path is not a rename", () => {
  for (const typed of [["log"], ["log", "list"], ["log", "wait"], ["log", "verify"], ["log", "cost"]]) {
    assertEquals(findRename(typed), null, typed.join(" "));
  }
});

Deno.test("the skills and memory skill paths map to the skill noun", () => {
  const expected: Array<[string[], string]> = [
    [["skills"], "exactl skill"],
    [["memory", "skill"], "exactl skill"],
  ];
  for (const [legacy, canonical] of expected) {
    assertEquals(findRename(legacy)?.canonical, canonical, legacy.join(" "));
  }
});

Deno.test("a skills hint keeps the typed verb and arguments", () => {
  for (const typed of [["skills", "list"], ["memory", "skill", "list"]]) {
    assertStringIncludes(renameHint(rowFor(typed), typed), "use 'exactl skill list'");
  }
  const approve = ["skills", "approve", "release-notes"];
  assertStringIncludes(renameHint(rowFor(approve), approve), "use 'exactl skill approve release-notes'");
});

Deno.test("other memory paths are not renames", () => {
  for (const typed of [["memory"], ["memory", "list"], ["memory", "search"], ["skill"], ["skill", "list"]]) {
    assertEquals(findRename(typed), null, typed.join(" "));
  }
});
