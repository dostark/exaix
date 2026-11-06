/**
 * @module ScenarioExaCtlPathsTest
 * @path tests/scenario_framework/tests/unit/scenario_exactl_paths_test.ts
 * @description Resolves every exactl scenario step through the live command tree and checks its long options.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/yaml, @std/fs, @exaix/app-exactl/exactl]
 * @related-files [apps/exactl/src/docs/command_tree_walk.ts, tests/scenario_framework/scenarios]
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";
import { createExaCtlCommand } from "@exaix/app-exactl/exactl";
import type { JSONValue } from "@exaix/core/types";
import { readFixtureTextSync } from "@exaix/testing";
import { type ICommandTreeNode, walkCommandTree } from "../../../../apps/exactl/src/docs/command_tree_walk.ts";

const FRAMEWORK_HOME = fromFileUrl(new URL("../../", import.meta.url));
const EXACTL_STEP_TYPE = "exactl";
const OPTION_PREFIX = "-";
const LONG_OPTION_PREFIX = "--";
const OPTION_TERMINATOR = "--";
const REQUEST_COMMAND = "request";
const CREATE_SUBCOMMAND = "create";
const RENAMED_AGENT_OPTION = "--agent-role";
const DROPPED_AGENT_ALIAS = "-a";
const ALWAYS_VALID_OPTIONS: ReadonlySet<string> = new Set(["--help", "--version"]);

interface IExaCtlStep {
  file: string;
  id: string;
  command: string;
  args: string[];
}

interface IStepResolution {
  node: ICommandTreeNode | undefined;
  unknownOptions: string[];
}

function collectSteps(file: string, value: JSONValue, steps: IExaCtlStep[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSteps(file, item, steps);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (value.type === EXACTL_STEP_TYPE && typeof value.command === "string") {
    const args = Array.isArray(value.args) ? value.args.map(String) : [];
    steps.push({ file, id: String(value.id ?? ""), command: value.command, args });
  }
  for (const child of Object.values(value)) collectSteps(file, child, steps);
}

async function loadExaCtlSteps(): Promise<IExaCtlStep[]> {
  const steps: IExaCtlStep[] = [];
  for await (const entry of walk(FRAMEWORK_HOME, { exts: [".yaml", ".yml"], includeDirs: false })) {
    collectSteps(entry.path, parse(await Deno.readTextFile(entry.path)) as JSONValue, steps);
  }
  return steps;
}

function hasPath(nodes: readonly ICommandTreeNode[], path: readonly string[]): ICommandTreeNode | undefined {
  return nodes.find((node) => node.path.length === path.length && node.path.every((word, i) => word === path[i]));
}

/** Resolves `command` and the leading non-option args to the deepest command in the tree. */
function resolveStep(
  nodes: readonly ICommandTreeNode[],
  command: string,
  stepArgs: readonly string[],
): IStepResolution {
  const [root, ...commandWords] = command.trim().split(/\s+/);
  const args = [...commandWords, ...stepArgs];
  let node = hasPath(nodes, [root]);
  if (node === undefined) return { node, unknownOptions: [] };
  for (const arg of args) {
    if (arg.startsWith(OPTION_PREFIX)) break;
    const child = hasPath(nodes, [...node.path, arg]);
    if (child === undefined) break;
    node = child;
  }
  const known = new Set(node.options.flatMap((option) => option.flags));
  const terminator = args.indexOf(OPTION_TERMINATOR);
  const checked = terminator === -1 ? args : args.slice(0, terminator);
  const unknownOptions = checked
    .filter((arg) => arg.startsWith(LONG_OPTION_PREFIX))
    .map((arg) => arg.split("=")[0])
    .filter((flag) => !known.has(flag) && !ALWAYS_VALID_OPTIONS.has(flag));
  return { node, unknownOptions };
}

const liveNodes = walkCommandTree(createExaCtlCommand());

/** Option uses that already failed before the command grammar phase. The list may only shrink. */
const knownStaleOptions = JSON.parse(
  readFixtureTextSync(import.meta.url, "cli", "scenario_exactl_paths_test", "known_stale_options.json"),
) as string[];

Deno.test("every exactl scenario step resolves to a command path in the live tree", async () => {
  const steps = await loadExaCtlSteps();
  assert(steps.length > 0, "no exactl steps found");
  const problems: string[] = [];
  const staleOptionKeys: string[] = [];
  for (const step of steps) {
    const resolution = resolveStep(liveNodes, step.command, step.args);
    const where = `${step.file.replace(FRAMEWORK_HOME, "")}#${step.id}`;
    if (resolution.node === undefined) problems.push(`${where}: unknown command "${step.command}"`);
    for (const option of resolution.unknownOptions) {
      const key = `${where}: ${option}`;
      staleOptionKeys.push(key);
      if (!knownStaleOptions.includes(key)) {
        problems.push(`${where}: "${option}" is not an option of "${resolution.node?.path.join(" ")}"`);
      }
    }
  }
  assertEquals(problems, []);
  assertEquals(knownStaleOptions.filter((key) => !staleOptionKeys.includes(key)), [], "stale allow-list entries");
});

Deno.test("an unknown first command word does not resolve", () => {
  assertEquals(resolveStep(liveNodes, "journal", ["wait"]).node, undefined);
});

Deno.test("leading words resolve to the deepest command", () => {
  assertEquals(resolveStep(liveNodes, "log", ["wait", "--event", "x"]).node?.path, ["log", "wait"]);
  assertEquals(resolveStep(liveNodes, "log", ["list"]).node?.path, ["log", "list"]);
});

Deno.test("an unknown long option is reported and a known one is not", () => {
  assertEquals(resolveStep(liveNodes, "log", ["wait", "--event", "x", "--bogus-option"]).unknownOptions, [
    "--bogus-option",
  ]);
  assertEquals(resolveStep(liveNodes, "log", ["wait", "--event=x", "--timeout", "1"]).unknownOptions, []);
});

Deno.test("every request step names a subcommand and none uses a removed agent option", async () => {
  const subcommands = new Set(
    liveNodes.filter((node) => node.path.length === 2 && node.path[0] === REQUEST_COMMAND).map((node) => node.path[1]),
  );
  assert(subcommands.has(CREATE_SUBCOMMAND), "the live tree has no request create");
  const problems: string[] = [];
  for (const step of await loadExaCtlSteps()) {
    const [root, ...commandWords] = step.command.trim().split(/\s+/);
    if (root !== REQUEST_COMMAND) continue;
    const words = [...commandWords, ...step.args];
    const where = `${step.file.replace(FRAMEWORK_HOME, "")}#${step.id}`;
    if (!subcommands.has(words[0])) problems.push(`${where}: first word "${words[0]}" is not a request subcommand`);
    if (words.some((word) => word.split("=")[0] === RENAMED_AGENT_OPTION)) {
      problems.push(`${where}: ${RENAMED_AGENT_OPTION}`);
    }
    if (words[0] === CREATE_SUBCOMMAND && words.includes(DROPPED_AGENT_ALIAS)) {
      problems.push(`${where}: ${DROPPED_AGENT_ALIAS}`);
    }
  }
  assertEquals(problems, []);
});
