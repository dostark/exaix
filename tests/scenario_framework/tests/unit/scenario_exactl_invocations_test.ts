/**
 * @module ScenarioExaCtlInvocationsTest
 * @path tests/scenario_framework/tests/unit/scenario_exactl_invocations_test.ts
 * @description Runs every exactl scenario step through the example validator with its arguments quoted, so a stale option or argument count fails the unit tests.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/app-exactl/exactl, @exaix/testing]
 * @related-files [apps/exactl/src/docs/example_validator.ts, tests/scenario_framework/tests/unit/helpers/exactl_scenario_steps.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { createExaCtlCommand } from "@exaix/app-exactl/exactl";
import { readFixtureTextSync } from "@exaix/testing";
import { globalOptionsOf, walkCommandTree } from "../../../../apps/exactl/src/docs/command_tree_walk.ts";
import { validateExample } from "../../../../apps/exactl/src/docs/example_validator.ts";
import { FRAMEWORK_HOME, loadExaCtlSteps } from "./helpers/exactl_scenario_steps.ts";

const PROGRAM = "exactl";
const SINGLE_QUOTE = "'";
const NEEDS_QUOTES = /[\s"'$\\]/;

const rootCommand = createExaCtlCommand();
const liveNodes = walkCommandTree(rootCommand);
const globalFlags = globalOptionsOf(rootCommand);

/** Invocations that already failed before this check. The list may only shrink. */
const knownStaleInvocations = JSON.parse(
  readFixtureTextSync(import.meta.url, "cli", "scenario_exactl_invocations_test", "known_stale_invocations.json"),
) as string[];

/** One word of a shell line. A word with a space or a quote is wrapped in single quotes. */
function quoteWord(word: string): string {
  return NEEDS_QUOTES.test(word) ? `${SINGLE_QUOTE}${word.replaceAll(SINGLE_QUOTE, "")}${SINGLE_QUOTE}` : word;
}

/** The command line of a step, as the validator reads it. */
export function commandLineOf(command: string, args: readonly string[]): string {
  return [PROGRAM, ...command.trim().split(/\s+/), ...args.map(quoteWord)].join(" ");
}

Deno.test("every exactl step of every scenario passes validateExample", async () => {
  const steps = await loadExaCtlSteps();
  assert(steps.length > 0, "no exactl steps found");
  const found: string[] = [];
  for (const step of steps) {
    const issues = validateExample(liveNodes, globalFlags, {
      title: step.id,
      command: commandLineOf(step.command, step.args),
    });
    for (const issue of issues) {
      found.push(`${step.file.replace(FRAMEWORK_HOME, "")}#${step.id}: ${issue.kind} ${issue.token}`);
    }
  }
  assertEquals(found.filter((key) => !knownStaleInvocations.includes(key)), []);
  assertEquals(knownStaleInvocations.filter((key) => !found.includes(key)), [], "stale allow-list entries");
});

Deno.test("an argument with a space stays one word", () => {
  const line = commandLineOf("request", ["create", "Fix the bug", "--priority", "high"]);
  assertEquals(validateExample(liveNodes, globalFlags, { title: "t", command: line }), []);
});

Deno.test("a stale option or a surplus argument is reported", () => {
  const issues = validateExample(liveNodes, globalFlags, {
    title: "t",
    command: commandLineOf("log", ["list", "--format", "json"]),
  });
  assertEquals(issues.map((issue) => issue.token), ["--format", "json"]);
});
