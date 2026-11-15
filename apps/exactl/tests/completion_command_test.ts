/**
 * @module CompletionCommandTest
 * @path apps/exactl/tests/completion_command_test.ts
 * @description Runs the real exactl binary to check that the completion scripts name every root command and that the helper alias that the scripts call resolves.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/command_builders/completion_command.ts, apps/exactl/src/command_docs/system_docs.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createExaCtlCommand } from "../src/exactl.ts";
import { walkCommandTree } from "../src/docs/command_tree_walk.ts";
import { runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

function visibleRoots(): string[] {
  return walkCommandTree(createExaCtlCommand()).filter((node) => node.path.length === 1 && !node.hidden).map((node) =>
    node.path[0]
  );
}

Deno.test("completion bash prints a script that names every root", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["completion", "bash"]]);
  assertEquals(run.code, 0, run.stderr);
  assertStringIncludes(run.stdout, "bash completion support for exactl");
  const roots = visibleRoots();
  assert(roots.includes("doctor") && roots.includes("completion"), "the roots include the system commands");
  for (const root of roots) assertStringIncludes(run.stdout, root);
});

Deno.test("completion fish and zsh print their scripts", async () => {
  const runs = await runExactlSequenceInTempWorkspace([["completion", "fish"], ["completion", "zsh"]]);
  for (const run of runs) {
    assertEquals(run.code, 0, run.stderr);
    assertStringIncludes(run.stdout, "doctor");
  }
});

Deno.test("the hidden completions command that the generated scripts call prints the same script", async () => {
  const [named, aliased] = await runExactlSequenceInTempWorkspace([["completion", "bash"], ["completions", "bash"]]);
  assertEquals(aliased.code, 0, aliased.stderr);
  assertEquals(aliased.stdout, named.stdout);
});

Deno.test("the hidden helper stays out of the help and answers to its callback", async () => {
  const [help, helper] = await runExactlSequenceInTempWorkspace([
    ["completion", "--help"],
    ["completions", "complete", "command", "request"],
  ]);
  assertEquals(help.code, 0, help.stderr);
  assert(!/^\s+complete\b/m.test(help.stdout), help.stdout);
  assertEquals(helper.code, 0, helper.stderr);
});
