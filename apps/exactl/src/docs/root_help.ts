/**
 * @module RootHelp
 * @path apps/exactl/src/docs/root_help.ts
 * @description Renders the root description of exactl: the command groups and the global options.
 * @architectural-layer CLI
 * @dependencies [apps/exactl/src/docs/exactl_noun_doc.ts]
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "./exactl_noun_doc.ts";

/** The part of a global option that the root help reads. */
interface IRootHelpOption {
  readonly flags: readonly string[];
  readonly description: string;
  readonly args?: ReadonlyArray<{ readonly name: string }>;
}

const GLOBAL_HEADING = "Global options (before or after the command):";
const LEADING_EXAMPLE = "Example: exactl -o json plan list";
const HELP_LINE_END = "\n";
const INDENT = "  ";

function describeOption(option: IRootHelpOption): string {
  const argument = (option.args ?? []).map((arg) => ` <${arg.name}>`).join("");
  return `${INDENT}${option.flags.join(", ")}${argument}  ${option.description}`;
}

/** The intro, one line per group with its documented nouns, and the global options with a leading-position example. */
export function renderRootDescription(
  intro: string,
  nounDocs: readonly IExaCtlNounDoc[],
  globalOptions: readonly IRootHelpOption[],
): string {
  const groups = Object.values(ExaCtlCommandGroup).map((group) => {
    const nouns = nounDocs.filter((doc) => doc.group === group).map((doc) => doc.noun);
    return `${group}: ${nouns.join(", ")}`.trimEnd();
  });
  return [
    intro,
    groups.join(HELP_LINE_END),
    [GLOBAL_HEADING, ...globalOptions.map(describeOption), `${INDENT}${LEADING_EXAMPLE}`].join(HELP_LINE_END),
  ].join(HELP_LINE_END + HELP_LINE_END);
}
