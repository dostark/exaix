/**
 * @module CommandHelpParityTest
 * @path apps/exactl/tests/command_help_parity_test.ts
 * @description Verifies each moved leaf keeps the option set of its old path and adds only the options its move allows.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, apps/exactl/src/docs/command_tree_walk.ts]
 * @related-files [tests/fixtures/cli/command_help_parity_test/old_option_sets.json, apps/exactl/src/command_builders/plan_command.ts]
 */

import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { readFixtureTextSync } from "@exaix/testing";
import { createExaCtlCommand } from "../src/exactl.ts";
import { walkCommandTree } from "../src/docs/command_tree_walk.ts";

/** The old option sets, captured from the tree before the leaves moved. */
const oldOptionSets = JSON.parse(
  readFixtureTextSync(import.meta.url, "cli", "command_help_parity_test", "old_option_sets.json"),
) as Record<string, string[]>;

const BULK_ADDITIONS: readonly string[] = ["--all"];
const NO_FLAGS: readonly string[] = [];

/** An old path, the path that replaces it, the flags the move removes and the flags it may add. */
type Move = readonly [oldPath: string, newPath: string, removed: readonly string[], added: readonly string[]];

const MOVES: readonly Move[] = [
  ["plan approve", "plan approve", NO_FLAGS, BULK_ADDITIONS],
  ["plan approve-all", "plan approve", NO_FLAGS, BULK_ADDITIONS],
  ["plan amendment show", "plan amendment show", NO_FLAGS, BULK_ADDITIONS],
  ["plan amendment show-all", "plan amendment show", NO_FLAGS, BULK_ADDITIONS],
  ["plan amendment approve", "plan amendment approve", NO_FLAGS, BULK_ADDITIONS],
  ["plan amendment approve-all", "plan amendment approve", NO_FLAGS, BULK_ADDITIONS],
  ["memory pending", "memory proposal", NO_FLAGS, NO_FLAGS],
  ["memory pending list", "memory proposal list", NO_FLAGS, NO_FLAGS],
  ["memory pending show", "memory proposal show", NO_FLAGS, NO_FLAGS],
  ["memory pending approve", "memory proposal approve", NO_FLAGS, BULK_ADDITIONS],
  ["memory pending reject", "memory proposal reject", NO_FLAGS, NO_FLAGS],
  ["memory pending approve-all", "memory proposal approve", NO_FLAGS, BULK_ADDITIONS],
  ["memory delete-learning", "memory learning remove", NO_FLAGS, NO_FLAGS],
  ["memory rebuild-index", "memory index rebuild", NO_FLAGS, NO_FLAGS],
  ["git branches", "git branch list", NO_FLAGS, NO_FLAGS],
  ["git worktrees", "git worktree", NO_FLAGS, NO_FLAGS],
  ["git worktrees list", "git worktree list", NO_FLAGS, NO_FLAGS],
  ["git worktrees prune", "git worktree prune", NO_FLAGS, NO_FLAGS],
  ["portal analyze", "portal knowledge analyze", NO_FLAGS, NO_FLAGS],
  ["portal knowledge", "portal knowledge show", NO_FLAGS, NO_FLAGS],
  ["config lock", "config lock add", NO_FLAGS, NO_FLAGS],
  ["config unlock", "config lock remove", NO_FLAGS, NO_FLAGS],
  ["config lock-list", "config lock list", NO_FLAGS, NO_FLAGS],
  ["config use-profile", "config profile use", NO_FLAGS, NO_FLAGS],
  ["config list-profiles", "config profile list", NO_FLAGS, NO_FLAGS],
  ["mcp start", "mcp serve", NO_FLAGS, NO_FLAGS],
  ["mcp connect", "mcp tool call", ["--list-tools", "--call-tool"], ["--server"]],
  ["request", "request create", ["--agent-role", "-a"], ["--agent"]],
  ["watch", "request watch", NO_FLAGS, ["--trace"]],
  ["wait list", "approval list", NO_FLAGS, NO_FLAGS],
  ["wait approve", "approval approve", NO_FLAGS, NO_FLAGS],
  ["wait reject", "approval reject", ["--message", "-m"], NO_FLAGS],
  ["wait amend", "approval amend", NO_FLAGS, NO_FLAGS],
  ["wait expire", "approval expire", NO_FLAGS, NO_FLAGS],
  ["wait cancel", "approval cancel", NO_FLAGS, NO_FLAGS],
  ["tool pending", "approval list", NO_FLAGS, NO_FLAGS],
  ["tool confirm", "approval approve", NO_FLAGS, NO_FLAGS],
  ["tool deny", "approval reject", NO_FLAGS, NO_FLAGS],
];

const nodes = walkCommandTree(createExaCtlCommand());

function flagsOf(path: string): string[] {
  const node = nodes.find((candidate) => candidate.path.join(" ") === path);
  assert(node !== undefined, `no command ${path}`);
  return node.options.flatMap((option) => option.flags).filter((flag) => flag !== "-h" && flag !== "--help").sort();
}

Deno.test("each moved leaf lists the same options as its old path", () => {
  assertEquals(Object.keys(oldOptionSets).sort(), [...new Set(MOVES.map(([oldPath]) => oldPath))].sort());
  const allowedAdded = new Map<string, Set<string>>();
  const kept = new Map<string, Set<string>>();
  for (const [oldPath, newPath, removed, added] of MOVES) {
    const expectedKept = oldOptionSets[oldPath].filter((flag) => !removed.includes(flag));
    assertArrayIncludes(flagsOf(newPath), expectedKept, `${newPath} keeps the options of ${oldPath}`);
    const keptFlags = kept.get(newPath) ?? new Set<string>();
    expectedKept.forEach((flag) => keptFlags.add(flag));
    kept.set(newPath, keptFlags);
    const allowed = allowedAdded.get(newPath) ?? new Set<string>();
    added.forEach((flag) => allowed.add(flag));
    allowedAdded.set(newPath, allowed);
  }
  for (const [newPath, keptFlags] of kept) {
    const extra = flagsOf(newPath).filter((flag) => !keptFlags.has(flag) && !allowedAdded.get(newPath)?.has(flag));
    assertEquals(extra, [], `${newPath} adds only the allowed options`);
  }
});

Deno.test("the bulk leaves take --all", () => {
  for (const path of ["plan approve", "plan amendment show", "plan amendment approve", "memory proposal approve"]) {
    assertArrayIncludes(flagsOf(path), ["--all"], path);
  }
});
