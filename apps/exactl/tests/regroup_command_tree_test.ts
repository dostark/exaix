/**
 * @module RegroupCommandTreeTest
 * @path apps/exactl/tests/regroup_command_tree_test.ts
 * @description Pins the git, portal, config and mcp trees after their leaves moved under sub-nouns.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/command_tree.ts]
 * @related-files [apps/exactl/src/command_builders/git_command.ts, apps/exactl/src/command_builders/mcp_command.ts]
 */

import { assertEquals } from "@std/assert";
import { childrenOf, nodes } from "./helpers/command_tree.ts";

Deno.test("git has status, log, branch and worktree", () => {
  assertEquals(childrenOf("git"), ["branch", "log", "status", "worktree"]);
  assertEquals(childrenOf("git branch"), ["list"]);
  assertEquals(childrenOf("git worktree"), ["list", "prune"]);
});

Deno.test("portal groups analysis and knowledge under knowledge", () => {
  assertEquals(childrenOf("portal knowledge"), ["analyze", "show"]);
  assertEquals(childrenOf("portal").filter((name) => name === "analyze"), []);
});

Deno.test("config groups locks and profiles and drops the compound leaves", () => {
  assertEquals(childrenOf("config lock"), ["add", "list", "remove"]);
  assertEquals(childrenOf("config profile"), ["list", "use"]);
  const removed = ["unlock", "lock-list", "use-profile", "list-profiles", "set-path"];
  assertEquals(childrenOf("config").filter((name) => removed.includes(name)), []);
});

Deno.test("mcp has serve and the tool sub-noun with list and call", () => {
  assertEquals(childrenOf("mcp"), ["serve", "tool"]);
  assertEquals(childrenOf("mcp tool"), ["call", "list"]);
});

Deno.test("mcp tool list and call take --server", () => {
  for (const path of ["mcp tool list", "mcp tool call"]) {
    const node = nodes.find((candidate) => candidate.path.join(" ") === path);
    assertEquals(node?.options.some((option) => option.flags.includes("--server") && option.required), true, path);
  }
});
