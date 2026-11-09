/**
 * @module ExaCtlNounDoc
 * @path apps/exactl/src/docs/exactl_noun_doc.ts
 * @description The doc record of one root noun: its group, summary, description and lifecycle.
 * @architectural-layer CLI
 * @dependencies [@cliffy/command, apps/exactl/src/exactl_constants.ts]
 * @related-files [packages/cli/src/docs/exactl_command_doc.ts, apps/exactl/src/command_docs/mod.ts]
 */

import type { Command } from "@cliffy/command";
import type { ExaCtlCommandName } from "../exactl_constants.ts";

export enum ExaCtlCommandGroup {
  WORK = "Work",
  DEFINITIONS = "Definitions",
  OPERATIONS = "Operations",
  SYSTEM = "System",
}

/** The entity paragraph of one root noun. */
export interface IExaCtlNounDoc {
  readonly noun: ExaCtlCommandName;
  readonly group: ExaCtlCommandGroup;
  readonly summary: string;
  readonly description: string;
  /** Status values in lifecycle order, taken from the status constants. Empty when the noun has none. */
  readonly lifecycle: readonly string[];
}

const SECTION_BREAK = "\n\n";
const LIFECYCLE_SEPARATOR = " → ";

/** Applies a noun record to its command: the summary is the first description line. */
export function documentedNoun<T extends Command>(command: T, doc: IExaCtlNounDoc): T {
  const sections = [doc.summary, doc.description];
  if (doc.lifecycle.length > 0) sections.push(`Lifecycle: ${doc.lifecycle.join(LIFECYCLE_SEPARATOR)}`);
  command.description(sections.join(SECTION_BREAK));
  return command;
}
