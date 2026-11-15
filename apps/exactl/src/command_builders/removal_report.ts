/**
 * @module RemovalReport
 * @path apps/exactl/src/command_builders/removal_report.ts
 * @description Prints the result row of a remove verb, shared by the verbs that remove an entity.
 * @architectural-layer CLI
 * @dependencies [apps/exactl/src/output/exactl_output.ts]
 * @related-files [apps/exactl/src/command_builders/blueprint_command.ts, apps/exactl/src/command_builders/portal_command.ts]
 */

import { ExaCtlVerb, MutationStatus } from "../exactl_constants.ts";
import type { ExaCtlOutputRenderer } from "../output/exactl_output.ts";

/** Prints one mutation row that says the entity was removed. */
export function reportRemoval(renderer: ExaCtlOutputRenderer, id: string): Promise<void> {
  return renderer.mutation([{ id, action: ExaCtlVerb.REMOVE, status: MutationStatus.REMOVED }], false);
}
