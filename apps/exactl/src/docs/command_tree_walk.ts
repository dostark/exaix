/**
 * @module CommandTreeWalk
 * @path apps/exactl/src/docs/command_tree_walk.ts
 * @description Walks a cliffy command into a flat list of nodes for lint rules, example checks and generated docs.
 * @architectural-layer CLI
 * @dependencies [@exaix/core]
 * @related-files [apps/exactl/tests/command_tree_lint_test.ts, apps/exactl/src/exactl.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";

/** The part of a cliffy command that the walker reads. */
export interface IWalkableCommand {
  getName(): string;
  getAliases(): string[];
  getDescription(): string;
  getArguments(): ReadonlyArray<{
    name: string;
    optional?: Opt<boolean, Reason.OptionalInput>;
    variadic?: Opt<boolean, Reason.OptionalInput>;
  }>;
  getBaseOptions(hidden: boolean): ReadonlyArray<IWalkableOption>;
  getExamples(): ReadonlyArray<{ name: string; description: string }>;
  getBaseCommands(hidden: boolean): IWalkableCommand[];
}

/** The default value of an option. Cliffy types it loosely, so the alias borrows the loose parameter of `String`. */
type OptionDefault = Parameters<typeof String>[0];

/** The part of a cliffy option that the walker reads. */
interface IWalkableOption {
  name: string;
  flags: string[];
  description?: Opt<string, Reason.OptionalInput>;
  default?: Opt<OptionDefault, Reason.OptionalInput>;
  args?: Opt<ReadonlyArray<IWalkableOptionArgument>, Reason.OptionalInput>;
  global?: Opt<boolean, Reason.OptionalInput>;
  required?: Opt<boolean, Reason.OptionalInput>;
  hidden?: Opt<boolean, Reason.OptionalInput>;
}

/** The value argument of an option, such as `<status:string>`. */
interface IWalkableOptionArgument {
  name?: Opt<string, Reason.OptionalInput>;
  type?: Opt<string, Reason.OptionalInput>;
}

/** The root command also exposes its own options, some of which every subcommand inherits. */
export interface IWalkableRoot extends IWalkableCommand {
  getOptions(hidden: boolean): ReadonlyArray<IWalkableOption>;
}

interface ICommandTreeArg {
  name: string;
  optional: boolean;
  variadic: boolean;
}

export interface ICommandTreeOption {
  name: string;
  flags: string[];
  /** True when the option reads a value, such as `--status <status>`. */
  takesValue: boolean;
  required: boolean;
  hidden: boolean;
  description: string;
  /** The name of the value in the usage line, such as `status`. Absent for a flag. */
  valueName: Opt<string, Reason.OptionalInput>;
  /** The value type, such as `string` or `number`. Absent for a flag. */
  valueType: Opt<string, Reason.OptionalInput>;
  /** The default value as text. Absent when the option has none. */
  defaultValue: Opt<string, Reason.OptionalInput>;
}

interface ICommandTreeExample {
  name: string;
  description: string;
}

export interface ICommandTreeNode {
  /** Command words after the root name. */
  path: string[];
  aliases: string[];
  args: ICommandTreeArg[];
  options: ICommandTreeOption[];
  description: string;
  examples: ICommandTreeExample[];
  /** The cliffy command object, for identity checks. */
  command: IWalkableCommand;
}

export const HELP_COMMAND_NAME = "help";

/** The default of an option as text. A default that cliffy computes at parse time has none. */
function defaultText(value: Opt<OptionDefault, Reason.OptionalInput>): Opt<string, Reason.OptionalInput> {
  if (value === undefined || value === null || typeof value === "function") return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function toOption(option: IWalkableOption): ICommandTreeOption {
  const value = (option.args ?? [])[0];
  return {
    name: option.name,
    flags: option.flags,
    takesValue: value !== undefined,
    required: option.required ?? false,
    hidden: option.hidden ?? false,
    description: option.description ?? "",
    valueName: value?.name,
    valueType: value?.type,
    defaultValue: defaultText(option.default),
  };
}

/** The options that every subcommand of `root` inherits. */
export function globalOptionsOf(root: IWalkableRoot): ICommandTreeOption[] {
  return root.getOptions(true).filter((option) => option.global === true).map(toOption);
}

function toNode(command: IWalkableCommand, path: string[]): ICommandTreeNode {
  return {
    path,
    aliases: command.getAliases(),
    args: command.getArguments().map(({ name, optional, variadic }) => ({
      name,
      optional: optional ?? false,
      variadic: variadic ?? false,
    })),
    options: command.getBaseOptions(true).map(toOption),
    description: command.getDescription(),
    examples: command.getExamples().map(({ name, description }) => ({ name, description })),
    command,
  };
}

/** Every descendant of `root` in registration order. The root itself and `help` are left out. */
export function walkCommandTree(root: IWalkableCommand, parentPath: string[] = []): ICommandTreeNode[] {
  const nodes: ICommandTreeNode[] = [];
  for (const child of root.getBaseCommands(true)) {
    if (child.getName() === HELP_COMMAND_NAME) continue;
    const path = [...parentPath, child.getName()];
    nodes.push(toNode(child, path), ...walkCommandTree(child, path));
  }
  return nodes;
}
