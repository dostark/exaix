/**
 * @module ExaCtlRenamesTest
 * @path apps/exactl/tests/exactl_renames_test.ts
 * @description Verifies the rename table lookup, the rename hint text and the shell quoting of echoed text.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/exactl_renames.ts]
 * @related-files [apps/exactl/src/exactl_renames.ts]
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertNotMatch,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import {
  EXACTL_RENAMES,
  findOptionRename,
  findRename,
  optionRenameHint,
  renameHint,
  requestCreateHint,
} from "../src/exactl_renames.ts";
import { MAX_HINT_ECHO_CHARS } from "../src/exactl_shell.ts";

function rowFor(legacy: readonly string[]) {
  const row = findRename(legacy);
  assert(row !== null, `no rename row for ${legacy.join(" ")}`);
  return row;
}

Deno.test("findRename returns the row for every table entry", () => {
  assertNotEquals(EXACTL_RENAMES.length, 0);
  for (const row of EXACTL_RENAMES) {
    const typed = row.unlessNextIn === undefined ? row.legacy : [...row.legacy, "typed-argument"];
    assertStrictEquals(findRename(typed), row, typed.join(" "));
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

Deno.test("the models, routing and config model paths map to the model noun", () => {
  const expected: Array<[string[], string]> = [
    [["models"], "exactl model"],
    [["models", "pricing"], "exactl model list"],
    [["routing", "explain"], "exactl model route explain"],
    [["routing", "policy", "validate"], "exactl model route validate"],
    [["config", "model"], "exactl model candidates"],
    [["config", "set-provider"], "exactl model use"],
    [["config", "set-model"], "exactl config set models.<name>.model <model>"],
  ];
  for (const [legacy, canonical] of expected) {
    assertEquals(findRename(legacy)?.canonical, canonical, legacy.join(" "));
  }
});

Deno.test("a models hint keeps the typed verb and a pricing hint drops it", () => {
  const refresh = ["models", "refresh"];
  assertStringIncludes(renameHint(rowFor(refresh), refresh), "use 'exactl model refresh'");
  const pricing = ["models", "pricing"];
  assertStringIncludes(renameHint(rowFor(pricing), pricing), "use 'exactl model list'");
  const provider = ["config", "set-provider", "openai"];
  assertStringIncludes(renameHint(rowFor(provider), provider), "use 'exactl model use openai'");
});

Deno.test("a usage template replaces the typed arguments instead of following them", () => {
  const typed = ["config", "set-model", "fast", "gpt-5"];
  const hint = renameHint(rowFor(typed), typed);
  assertStringIncludes(hint, "use 'exactl config set models.<name>.model <model>'");
  assertNotMatch(hint, /gpt-5/);
});

Deno.test("other config paths are not renames", () => {
  for (const typed of [["config", "get"], ["config", "set"], ["config", "show"], ["model", "list"], ["routing"]]) {
    assertEquals(findRename(typed), null, typed.join(" "));
  }
});

Deno.test("the plan and memory compound paths map to their grouped paths", () => {
  const expected: Array<[string[], string]> = [
    [["plan", "approve-all"], "exactl plan approve --all"],
    [["plan", "amendment", "show-all"], "exactl plan amendment show --all"],
    [["plan", "amendment", "approve-all"], "exactl plan amendment approve --all"],
    [["memory", "pending"], "exactl memory proposal"],
    [["memory", "pending", "approve-all"], "exactl memory proposal approve --all"],
    [["memory", "delete-learning"], "exactl memory learning remove"],
    [["memory", "rebuild-index"], "exactl memory index rebuild"],
  ];
  for (const [legacy, canonical] of expected) {
    assertEquals(findRename(legacy)?.canonical, canonical, legacy.join(" "));
  }
});

Deno.test("a memory pending hint keeps the typed verb and arguments", () => {
  const list = ["memory", "pending", "list"];
  assertStringIncludes(renameHint(rowFor(list), list), "use 'exactl memory proposal list'");
  const reject = ["memory", "pending", "reject", "p-1"];
  assertStringIncludes(renameHint(rowFor(reject), reject), "use 'exactl memory proposal reject p-1'");
  const remove = ["memory", "delete-learning", "l-1"];
  assertStringIncludes(renameHint(rowFor(remove), remove), "use 'exactl memory learning remove l-1'");
});

Deno.test("the grouped plan and memory paths are not renames", () => {
  const grouped = [["plan", "approve"], ["plan", "amendment", "show"], ["memory", "proposal", "approve"]];
  for (const typed of [...grouped, ["memory", "learning", "remove"], ["memory", "index", "rebuild"]]) {
    assertEquals(findRename(typed), null, typed.join(" "));
  }
});

Deno.test("the git, portal, config and mcp paths map to their grouped paths", () => {
  const expected: Array<[string[], string]> = [
    [["git", "branches"], "exactl git branch list"],
    [["git", "worktrees"], "exactl git worktree"],
    [["portal", "analyze"], "exactl portal knowledge analyze"],
    [["portal", "knowledge", "my-portal"], "exactl portal knowledge show"],
    [["config", "lock", "ai.timeout_ms"], "exactl config lock add"],
    [["config", "unlock"], "exactl config lock remove"],
    [["config", "lock-list"], "exactl config lock list"],
    [["config", "use-profile"], "exactl config profile use"],
    [["config", "list-profiles"], "exactl config profile list"],
    [["config", "set-path"], "exactl config set paths.<key> <dir>"],
    [["mcp", "start"], "exactl mcp serve"],
    [["mcp", "connect"], "exactl mcp tool list --server <url>, or exactl mcp tool call <tool> --server <url>"],
  ];
  for (const [typed, canonical] of expected) {
    assertEquals(findRename(typed)?.canonical, canonical, typed.join(" "));
  }
});

Deno.test("a legacy leaf that became a noun matches only when its argument follows", () => {
  for (
    const typed of [["portal", "knowledge"], ["portal", "knowledge", "show", "p"], [
      "portal",
      "knowledge",
      "analyze",
      "p",
    ]]
  ) {
    assertEquals(findRename(typed), null, typed.join(" "));
  }
  for (
    const typed of [["config", "lock"], ["config", "lock", "list"], ["config", "lock", "add", "k"], [
      "config",
      "lock",
      "remove",
      "k",
    ]]
  ) {
    assertEquals(findRename(typed), null, typed.join(" "));
  }
});

Deno.test("hints for the grouped paths keep the typed arguments or show a usage template", () => {
  const knowledge = ["portal", "knowledge", "my-portal"];
  assertStringIncludes(renameHint(rowFor(knowledge), knowledge), "use 'exactl portal knowledge show my-portal'");
  const lock = ["config", "lock", "ai.timeout_ms"];
  assertStringIncludes(renameHint(rowFor(lock), lock), "use 'exactl config lock add ai.timeout_ms'");
  const setPath = ["config", "set-path", "workspace", "/tmp/w"];
  const pathHint = renameHint(rowFor(setPath), setPath);
  assertStringIncludes(pathHint, "use 'exactl config set paths.<key> <dir>'");
  assertNotMatch(pathHint, /\/tmp\/w/);
  const connect = ["mcp", "connect", "http://localhost:3000/mcp"];
  assertStringIncludes(renameHint(rowFor(connect), connect), "exactl mcp tool call <tool> --server <url>");
});

Deno.test("the grouped git, config and mcp paths are not renames", () => {
  const grouped = [["git", "branch", "list"], ["git", "worktree", "prune"], ["config", "profile", "use"], [
    "mcp",
    "tool",
    "list",
  ]];
  for (const typed of grouped) assertEquals(findRename(typed), null, typed.join(" "));
});

Deno.test("the request create option renames map --agent-role and -a to --agent", () => {
  for (const legacy of ["--agent-role", "-a"]) {
    const row = findOptionRename(["request", "create", "Fix bug", legacy, "qa"]);
    assertEquals(row?.canonicalOption, "--agent", legacy);
  }
  assertEquals(findOptionRename(["request", "create", "Fix bug", "--agent-role=qa"])?.canonicalOption, "--agent");
});

Deno.test("an option rename needs its command path and stops at the option terminator", () => {
  assertEquals(findOptionRename(["request", "list", "-a"]), null);
  assertEquals(findOptionRename(["request", "create", "--agent", "qa"]), null);
  assertEquals(findOptionRename(["request", "create", "--", "--agent-role"]), null);
  assertEquals(findOptionRename(["blueprint", "create", "-a"]), null);
});

Deno.test("optionRenameHint names the legacy option and the replacement", () => {
  const row = findOptionRename(["request", "create", "--agent-role", "qa"]);
  assert(row !== null);
  assertEquals(
    optionRenameHint(row),
    "'exactl request create --agent-role' was renamed: use '--agent'",
  );
});

Deno.test("requestCreateHint quotes the typed description", () => {
  assertEquals(
    requestCreateHint(["Fix", "bug"]),
    "'exactl request <text>' was removed: use 'exactl request create 'Fix bug''",
  );
  assertStringIncludes(requestCreateHint(["$(rm -rf ~)"]), "exactl request create '$(rm -rf ~)'");
  assertStringIncludes(requestCreateHint(["it's"]), `'it'\\''s'`);
});

Deno.test("the root watch path maps to request watch with a trace id", () => {
  assertEquals(
    findRename(["watch", "550e8400-e29b-41d4-a716-446655440000"])?.canonical,
    "exactl request watch --trace <trace-id>",
  );
  assertEquals(findRename(["request", "watch"]), null);
});

Deno.test("the wait and tool paths map to the approval noun", () => {
  const expected: Array<[string[], string]> = [
    [["wait"], "exactl approval <list|show|approve|reject|amend|expire|cancel>"],
    [["wait", "list"], "exactl approval list"],
    [["wait", "approve", "tok"], "exactl approval approve wait:<token>"],
    [["wait", "reject", "tok"], "exactl approval reject wait:<token>"],
    [["wait", "amend", "tok"], "exactl approval amend wait:<token>"],
    [["wait", "expire", "tok"], "exactl approval expire wait:<token>"],
    [["wait", "cancel", "tok"], "exactl approval cancel wait:<token>"],
    [["tool"], "exactl approval <list|show|approve|reject>"],
    [["tool", "pending"], "exactl approval list"],
    [["tool", "confirm", "id"], "exactl approval approve tool:<id>"],
    [["tool", "deny", "id"], "exactl approval reject tool:<id>"],
  ];
  for (const [typed, canonical] of expected) assertEquals(findRename(typed)?.canonical, canonical, typed.join(" "));
});

Deno.test("the approval paths and the mcp tool path are not renames", () => {
  for (const typed of [["approval", "list"], ["approval", "approve", "wait:t"], ["mcp", "tool", "list"]]) {
    assertEquals(findRename(typed), null, typed.join(" "));
  }
});

Deno.test("renameHint cuts a long plain word at the echo limit", () => {
  const row = rowFor(["journal"]);
  const hint = renameHint(row, ["journal", "a".repeat(MAX_HINT_ECHO_CHARS * 5)]);
  assertNotMatch(hint, new RegExp(`a{${MAX_HINT_ECHO_CHARS + 1}}`));
  assertStringIncludes(hint, "a".repeat(MAX_HINT_ECHO_CHARS));
});
