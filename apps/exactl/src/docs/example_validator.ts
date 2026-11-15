/**
 * @module ExampleValidator
 * @path apps/exactl/src/docs/example_validator.ts
 * @description Checks a doc example against the command tree without running any action.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli, apps/exactl/src/docs/command_tree_walk.ts]
 * @related-files [apps/exactl/src/docs/command_tree_walk.ts, apps/exactl/tests/example_validator_test.ts]
 */

import type { IExaCtlExample } from "@exaix/cli";
import type { Opt, Reason } from "@exaix/core/types";
import { OPTION_PREFIX, OPTION_TERMINATOR } from "../exactl_renames.ts";
import { SINGLE_QUOTE } from "../exactl_shell.ts";
import type { ICommandTreeNode } from "./command_tree_walk.ts";

export enum ExampleIssueKind {
  UNKNOWN_COMMAND = "unknown_command",
  UNKNOWN_OPTION = "unknown_option",
  MISSING_ARGUMENT = "missing_argument",
  TOO_MANY_ARGUMENTS = "too_many_arguments",
}

export interface IExampleIssue {
  readonly kind: ExampleIssueKind;
  readonly token: string;
}

/** An option the example may use: its flags and whether it reads a value. */
export interface IExampleFlag {
  readonly flags: readonly string[];
  readonly takesValue: boolean;
}

const PROGRAM_NAME = "exactl";
const LONG_OPTION_PREFIX = "--";
const VALUE_SEPARATOR = "=";
const DOUBLE_QUOTE = '"';
const SHORT_FLAG_LENGTH = 2;
const WHITESPACE = /\s/;

/** Splits a command line like a shell does: whitespace separates words and quotes group them. */
function splitWords(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  for (const character of line) {
    if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === SINGLE_QUOTE || character === DOUBLE_QUOTE) {
      quote = character;
      started = true;
    } else if (WHITESPACE.test(character)) {
      if (started || current !== "") words.push(current);
      current = "";
      started = false;
    } else {
      current += character;
    }
  }
  if (started || current !== "") words.push(current);
  return words;
}

function findFlag(flags: readonly IExampleFlag[], token: string): IExampleFlag | undefined {
  const name = token.split(VALUE_SEPARATOR)[0];
  const exact = flags.find((flag) => flag.flags.includes(name));
  if (exact !== undefined || token.startsWith(LONG_OPTION_PREFIX) || token.length <= SHORT_FLAG_LENGTH) return exact;
  return flags.find((flag) => flag.takesValue && flag.flags.includes(token.slice(0, SHORT_FLAG_LENGTH)));
}

function pathOf(node: Opt<ICommandTreeNode, Reason.OptionalInput>): string[] {
  return node === undefined ? [] : node.path;
}

function childrenOf(nodes: readonly ICommandTreeNode[], parent: readonly string[]): ICommandTreeNode[] {
  return nodes.filter((node) =>
    node.path.length === parent.length + 1 && parent.every((word, index) => node.path[index] === word)
  );
}

function positionalIssues(node: ICommandTreeNode, positionals: readonly string[]): IExampleIssue[] {
  const required = node.args.filter((arg) => !arg.optional);
  const variadic = node.args.some((arg) => arg.variadic);
  if (positionals.length < required.length) {
    return [{ kind: ExampleIssueKind.MISSING_ARGUMENT, token: node.args[positionals.length].name }];
  }
  if (!variadic && positionals.length > node.args.length) {
    return [{ kind: ExampleIssueKind.TOO_MANY_ARGUMENTS, token: positionals[node.args.length] }];
  }
  return [];
}

/** What the walk over the words of one example has found so far. */
interface IWalkState {
  node: Opt<ICommandTreeNode, Reason.OptionalInput>;
  terminated: boolean;
  readonly positionals: string[];
  readonly issues: IExampleIssue[];
}

/** True for a word that looks like an option. A value never does, so an optional value cannot swallow the next option. */
function isOptionWord(word: string): boolean {
  return word.startsWith(OPTION_PREFIX) && word.length > 1;
}

/** Handles one option word and returns how many following words it consumed. */
function consumeOption(
  state: IWalkState,
  word: string,
  next: Opt<string, Reason.OptionalInput>,
  globalFlags: readonly IExampleFlag[],
): number {
  const flag = findFlag([...(state.node?.options ?? []), ...globalFlags], word);
  if (flag === undefined) {
    state.issues.push({ kind: ExampleIssueKind.UNKNOWN_OPTION, token: word.split(VALUE_SEPARATOR)[0] });
    return 0;
  }
  return flag.takesValue && flag.flags.includes(word) && next !== undefined && !isOptionWord(next) ? 1 : 0;
}

/** Handles one plain word: a command word while no argument was seen and the node has children, otherwise an argument. */
function consumeWord(state: IWalkState, nodes: readonly ICommandTreeNode[], word: string): boolean {
  const children = childrenOf(nodes, pathOf(state.node));
  if (state.positionals.length > 0 || children.length === 0) {
    state.positionals.push(word);
    return true;
  }
  const child = children.find((candidate) =>
    candidate.path[candidate.path.length - 1] === word || candidate.aliases.includes(word)
  );
  if (child === undefined) {
    state.issues.push({ kind: ExampleIssueKind.UNKNOWN_COMMAND, token: word });
    return false;
  }
  state.node = child;
  return true;
}

/** Reports what is wrong with one example: unknown commands and options, missing and surplus arguments. */
export function validateExample(
  nodes: readonly ICommandTreeNode[],
  globalFlags: readonly IExampleFlag[],
  example: IExaCtlExample,
): IExampleIssue[] {
  const words = splitWords(example.command);
  if (words[0] !== PROGRAM_NAME) return [{ kind: ExampleIssueKind.UNKNOWN_COMMAND, token: words[0] ?? "" }];
  const state: IWalkState = { node: undefined, terminated: false, positionals: [], issues: [] };
  for (let index = 1; index < words.length; index++) {
    const word = words[index];
    if (!state.terminated && word === OPTION_TERMINATOR) state.terminated = true;
    else if (!state.terminated && word.startsWith(OPTION_PREFIX) && word.length > 1) {
      index += consumeOption(state, word, words[index + 1], globalFlags);
    } else if (!consumeWord(state, nodes, word)) return state.issues;
  }
  const { node } = state;
  if (node === undefined) return [...state.issues, { kind: ExampleIssueKind.UNKNOWN_COMMAND, token: "" }];
  if (childrenOf(nodes, node.path).length > 0) {
    return [...state.issues, { kind: ExampleIssueKind.UNKNOWN_COMMAND, token: node.path.join(" ") }];
  }
  return [...state.issues, ...positionalIssues(node, state.positionals)];
}
