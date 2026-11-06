/**
 * @module CommandHelpParityTest
 * @path apps/exactl/tests/command_help_parity_test.ts
 * @description Verifies each moved plan and memory leaf keeps the option set of its old path and adds only --all.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, apps/exactl/src/docs/command_tree_walk.ts]
 * @related-files [tests/fixtures/cli/command_help_parity_test/old_option_sets.json, apps/exactl/src/command_builders/plan_command.ts]
 */

import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { readFixtureTextSync } from "@exaix/testing";
import { createExaCtlCommand } from "../src/exactl.ts";
import { walkCommandTree } from "../src/docs/command_tree_walk.ts";

const ALLOWED_ADDITIONS: readonly string[] = ["--all"];

/** The old option sets, captured from the tree before the plan and memory leaves moved. */
const oldOptionSets = JSON.parse(
  readFixtureTextSync(import.meta.url, "cli", "command_help_parity_test", "old_option_sets.json"),
) as Record<string, string[]>;

/** Each old path and the path that replaces it. */
const MOVES: ReadonlyArray<readonly [string, string]> = [
  ["plan approve", "plan approve"],
  ["plan approve-all", "plan approve"],
  ["plan amendment show", "plan amendment show"],
  ["plan amendment show-all", "plan amendment show"],
  ["plan amendment approve", "plan amendment approve"],
  ["plan amendment approve-all", "plan amendment approve"],
  ["memory pending", "memory proposal"],
  ["memory pending list", "memory proposal list"],
  ["memory pending show", "memory proposal show"],
  ["memory pending approve", "memory proposal approve"],
  ["memory pending reject", "memory proposal reject"],
  ["memory pending approve-all", "memory proposal approve"],
  ["memory delete-learning", "memory learning remove"],
  ["memory rebuild-index", "memory index rebuild"],
];

const nodes = walkCommandTree(createExaCtlCommand());

function flagsOf(path: string): string[] {
  const node = nodes.find((candidate) => candidate.path.join(" ") === path);
  assert(node !== undefined, `no command ${path}`);
  return node.options.flatMap((option) => option.flags).filter((flag) => flag !== "-h" && flag !== "--help").sort();
}

Deno.test("each moved leaf lists the same options as its old path", () => {
  assertEquals(Object.keys(oldOptionSets).sort(), MOVES.map(([oldPath]) => oldPath).sort());
  const keptByNewPath = new Map<string, Set<string>>();
  for (const [oldPath, newPath] of MOVES) {
    assertArrayIncludes(flagsOf(newPath), oldOptionSets[oldPath], `${newPath} keeps the options of ${oldPath}`);
    const kept = keptByNewPath.get(newPath) ?? new Set<string>();
    oldOptionSets[oldPath].forEach((flag) => kept.add(flag));
    keptByNewPath.set(newPath, kept);
  }
  for (const [newPath, kept] of keptByNewPath) {
    const added = flagsOf(newPath).filter((flag) => !kept.has(flag));
    assertEquals(added.filter((flag) => !ALLOWED_ADDITIONS.includes(flag)), [], `${newPath} adds only --all`);
  }
});

Deno.test("the bulk leaves take --all", () => {
  for (const path of ["plan approve", "plan amendment show", "plan amendment approve", "memory proposal approve"]) {
    assertArrayIncludes(flagsOf(path), ["--all"], path);
  }
});
