/**
 * @module LogCommandTreeTest
 * @path apps/exactl/tests/log_command_tree_test.ts
 * @description Verifies the Solo log noun exposes exactly list, wait, verify and cost, and the removed roots are gone.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/docs/command_tree_walk.ts]
 * @related-files [apps/exactl/src/command_builders/log_command.ts, apps/exactl/src/exactl.ts]
 */

import { assertArrayIncludes, assertEquals } from "@std/assert";
import { createExaCtlCommand } from "../src/exactl.ts";
import { walkCommandTree } from "../src/docs/command_tree_walk.ts";
import { ExaCtlCommandName, ExaCtlVerb } from "../src/exactl_constants.ts";

const nodes = walkCommandTree(createExaCtlCommand());

Deno.test("log has exactly list, wait, verify, cost", () => {
  const children = nodes
    .filter((node) => node.path.length === 2 && node.path[0] === ExaCtlCommandName.LOG)
    .map((node) => node.path[1])
    .sort();
  assertEquals(children, [ExaCtlVerb.COST, ExaCtlVerb.LIST, ExaCtlVerb.VERIFY, ExaCtlVerb.WAIT].sort());
});

Deno.test("the journal, logs and cost roots no longer exist", () => {
  const roots = nodes.filter((node) => node.path.length === 1).map((node) => node.path[0]);
  assertEquals(roots.filter((root) => ["journal", "logs", "cost"].includes(root)), []);
  assertArrayIncludes(roots, [ExaCtlCommandName.LOG]);
});

Deno.test("log list keeps the journal query options", () => {
  const list = nodes.find((node) => node.path.join(" ") === "log list");
  const flags = (list?.options ?? []).flatMap((option) => option.flags);
  assertArrayIncludes(flags, [
    "--filter",
    "--tail",
    "--format",
    "--distinct",
    "--count",
    "--payload",
    "--actor",
    "--target",
  ]);
});

Deno.test("log wait keeps the barrier options and log cost keeps the report options", () => {
  const flagsOf = (path: string) =>
    (nodes.find((node) => node.path.join(" ") === path)?.options ?? []).flatMap((option) => option.flags);
  assertArrayIncludes(flagsOf("log wait"), ["--event", "--since", "--since-rowid", "--timeout", "--payload"]);
  assertArrayIncludes(flagsOf("log cost"), ["--trace-id", "--portal", "--since", "--model", "--group-by"]);
});
