/**
 * @module ScenarioCliSurfaceTest
 * @path tests/scenario_framework/tests/unit/scenario_cli_surface_test.ts
 * @description Phase 142 Step 15 — every `exactl` step must name a command the CLI actually has.
 *
 *   The `dynamic_execution` pack was authored against a CLI that does not exist. Eight scenarios
 *   invoke `exactl flow run <flow> --request <file>`; `flow` has only `list`, `show` and
 *   `validate`, and there is no way to execute a flow from the command line at all — a flow runs
 *   when a request naming it is submitted, which is what the (now green) `flow_blueprints` pack
 *   does. Cliffy answers an unknown subcommand with a usage dump on stdout and a non-zero exit,
 *   so the scenario failed on `command-output-contains` naming the missing text rather than on
 *   the invocation, and the fiction survived every review.
 *
 *   The tree is read from the real root command rather than restated, so a renamed or removed
 *   subcommand fails here instead of inside a scenario run.
 * @architectural-layer Test
 * @related-files [apps/exactl/src/exactl.ts, tests/scenario_framework/runner/step_executor.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { walk } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";
import { __test_command } from "../../../../apps/exactl/src/exactl.ts";

const SCENARIOS_DIR = join(resolve(import.meta.dirname!, "..", ".."), "scenarios");

/**
 * A registered subcommand, taken from the real root command's own return type — Cliffy's `Command`
 * is generic over its option/argument shape, so the root and its children are different types and
 * naming either explicitly requires a cast. Deriving the child type keeps the tree honest without
 * one, and the walk below tracks child LISTS rather than nodes so the root needs no name at all.
 */
type CommandNode = ReturnType<typeof __test_command.getCommands>[number];

/** Cliffy registers `show <flowId:string>` under the bare name `show`. */
function namesOf(commands: CommandNode[]): string[] {
  return commands.map((child) => child.getName());
}

function findCommand(name: string): CommandNode | undefined {
  return __test_command.getCommands().find((child) => child.getName() === name);
}

/** The scenario-step fields this test reads. `args` is YAML, so entries may be any scalar. */
interface IScenarioStepDoc {
  type?: string;
  command?: string;
  args?: (string | number | boolean | null)[];
}

interface IExactlInvocation {
  scenario: string;
  /** The full argv the executor builds: `tokenizeCommand(step.command)` followed by `step.args`. */
  argv: string[];
}

/** A bare word — not a flag, not an unexpanded `$VAR`, not a path. */
function isBareWord(arg: string): boolean {
  return !arg.startsWith("-") && !arg.startsWith("$") && !arg.includes("/");
}

async function collectInvocations(): Promise<IExactlInvocation[]> {
  const invocations: IExactlInvocation[] = [];
  for await (const entry of walk(SCENARIOS_DIR, { exts: [".yaml"], includeDirs: false })) {
    const doc = parseYaml(await Deno.readTextFile(entry.path)) as {
      id?: string;
      steps?: IScenarioStepDoc[];
    };
    for (const step of doc?.steps ?? []) {
      if (step?.type !== "exactl" || typeof step.command !== "string") continue;
      // step_executor.ts:499 — `command` is whitespace-tokenized, so `command: "daemon start"`
      // and `command: "daemon", args: ["start"]` are the same invocation.
      const argv = [
        ...step.command.split(/\s+/).filter((token) => token.length > 0),
        ...(step.args ?? []).filter((arg): arg is string => typeof arg === "string"),
      ];
      if (argv.length > 0) invocations.push({ scenario: doc.id ?? entry.name, argv });
    }
  }
  return invocations;
}

/**
 * Walk the argv down the command tree, returning the failing prefix or null.
 *
 * Stops descending at the first token that is not a bare word (a flag or a positional's value),
 * and at a command with no children — both mean the remaining tokens are arguments, not names.
 */
function firstUnknownPrefix(argv: string[]): string | null {
  let candidates: CommandNode[] = __test_command.getCommands();
  for (let index = 0; index < argv.length; index += 1) {
    if (candidates.length === 0) return null;
    const token = argv[index];
    if (!isBareWord(token)) return null;
    const child = candidates.find((candidate) => candidate.getName() === token);
    if (!child) {
      // A bare word where a subcommand is required and none matches is the fiction we are after —
      // unless the parent takes a positional, which only the root never does.
      const known = namesOf(candidates);
      if (index === 0) return `exactl ${token} (top-level; has: ${known.sort().join(", ")})`;
      return `exactl ${argv.slice(0, index + 1).join(" ")} (has: ${known.join(", ")})`;
    }
    candidates = child.getCommands();
  }
  return null;
}

Deno.test("[cli-surface] every exactl step names a command the CLI defines", async () => {
  const unknown = [
    ...new Set(
      (await collectInvocations())
        .map((invocation) => ({ invocation, failure: firstUnknownPrefix(invocation.argv) }))
        .filter((row) => row.failure !== null)
        .map((row) => `${row.invocation.scenario}: ${row.failure}`),
    ),
  ].sort();

  assertEquals(
    unknown,
    [],
    `Cliffy answers these with a usage dump and a non-zero exit, which a scenario reports as a ` +
      `failed assertion rather than a bad invocation:\n${unknown.join("\n")}`,
  );
});

Deno.test("[cli-surface] the tree is read from the real root command", () => {
  // Guards the reader: were the export renamed or the tree built lazily, both checks above
  // would pass vacuously by finding no commands to compare against.
  const top = namesOf(__test_command.getCommands());
  assert(top.includes("flow"), `expected a 'flow' command, got: ${top.join(", ")}`);
  assert(namesOf(findCommand("flow")!.getCommands()).includes("validate"));
});
