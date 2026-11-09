/**
 * @module DocumentedChildren
 * @path apps/exactl/src/command_builders/documented_children.ts
 * @description Applies the doc record of each leaf to the children of a noun command.
 * @architectural-layer CLI
 * @dependencies [@cliffy/command, @exaix/cli]
 * @related-files [apps/exactl/src/command_docs/mod.ts, apps/exactl/src/command_builders/plan_command.ts]
 */

import type { Command } from "@cliffy/command";
import { documented } from "@exaix/cli";
import { commandDocFor } from "../command_docs/mod.ts";
import { HELP_COMMAND_NAME } from "../docs/command_tree_walk.ts";

/** Gives every leaf child of `parent` its doc record. A child that has children of its own is a sub-noun and is skipped. */
export function documentLeaves(
  parent: { getCommands(): readonly Command[] },
  path: readonly string[],
  lifecycle: readonly string[],
): void {
  for (const child of parent.getCommands()) {
    const name = child.getName();
    if (name === HELP_COMMAND_NAME || child.getCommands().length > 0) continue;
    documented(child, commandDocFor([...path, name]), lifecycle);
  }
}
