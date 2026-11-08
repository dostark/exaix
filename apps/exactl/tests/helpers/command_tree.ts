/**
 * @module ExaCtlCommandTreeHelper
 * @path apps/exactl/tests/helpers/command_tree.ts
 * @description Test helper that lists the direct children of one command path in the live exactl command tree.
 * @architectural-layer Test
 * @dependencies [apps/exactl/src/exactl.ts, apps/exactl/src/docs/command_tree_walk.ts]
 * @related-files [apps/exactl/tests/model_command_tree_test.ts, apps/exactl/tests/regroup_command_tree_test.ts]
 */

import { createExaCtlCommand } from "../../src/exactl.ts";
import { walkCommandTree } from "../../src/docs/command_tree_walk.ts";

/** Every node of the live exactl command tree. */
export const nodes = walkCommandTree(createExaCtlCommand());

/** The sorted names of the direct children of a command path such as `git worktree`. */
export function childrenOf(parent: string): string[] {
  const depth = parent.split(" ").length + 1;
  return nodes
    .filter((node) => node.path.length === depth && node.path.slice(0, -1).join(" ") === parent)
    .map((node) => node.path[depth - 1])
    .sort();
}
