/**
 * @module ExaCtlGrammarCutoverTest
 * @path apps/exactl/tests/exactl_grammar_cutover_test.ts
 * @description Proves the exactl command grammar through the real Solo and Team entry points: the root set, a request-to-approval workflow, one removed path per rename group and the Team export command.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/tests/helpers/exactl_cli_process.ts, apps/exactl/src/exactl_renames.ts]
 * @related-files [apps/exactl/main.ts, exaix-team/apps/exactl/main.ts, apps/exactl/src/exactl_constants.ts]
 */

import { assert, assertArrayIncludes, assertEquals, assertNotMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ExaCtlCommandName } from "../src/exactl_constants.ts";
import { EXACTL_RENAMES, type IExaCtlRename } from "../src/exactl_renames.ts";
import {
  runExactlSeededWorkspace,
  runExactlSequenceInTempWorkspace,
  TEAM_ENTRY,
} from "./helpers/exactl_cli_process.ts";

const USAGE_EXIT_CODE = 2;
const COMMANDS_HEADING = "Commands:";
const COMMAND_LINE = /^ {2}([a-z][a-z-]*) +- /;
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");
const USAGE_TEMPLATE_MARKER = "<";
const PLAN_ID = "cutover-plan";
const REQUEST_TEXT = "Cutover request";
const NOUN_WORD_INDEX = 1;

/** The command names that the Commands section of a help text lists. */
function listedCommands(help: string): string[] {
  const lines = help.replace(ANSI_ESCAPE, "").split("\n");
  const start = lines.findIndex((line) => line.trim() === COMMANDS_HEADING);
  assert(start >= 0, `no Commands section in:\n${help}`);
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = COMMAND_LINE.exec(line);
    if (match !== null) names.push(match[1]);
  }
  return names;
}

async function seedReviewPlan(root: string): Promise<void> {
  const plans = join(root, "Workspace", "Plans");
  await Deno.mkdir(plans, { recursive: true });
  await Deno.writeTextFile(
    join(plans, `${PLAN_ID}.md`),
    `---\ntrace_id: "trace-cutover"\nstatus: review\nagent_role: senior-coder\ncreated_at: "2026-01-01T00:00:00Z"\nsubject: Plan to approve\n---\n\n# Plan\n`,
  );
}

/** One removed path for each noun that the table replaces: the first row that a bare typed path can hit. */
function onePerRenameGroup(): IExaCtlRename[] {
  const groups = new Map<string, IExaCtlRename>();
  for (const rename of EXACTL_RENAMES) {
    if (rename.unlessNextIn !== undefined || rename.canonical.includes(USAGE_TEMPLATE_MARKER)) continue;
    const noun = rename.canonical.split(" ")[NOUN_WORD_INDEX];
    if (!groups.has(noun)) groups.set(noun, rename);
  }
  return [...groups.values()];
}

Deno.test("the Solo binary exposes exactly the roots of ExaCtlCommandName", async () => {
  const [help] = await runExactlSequenceInTempWorkspace([["--help"]]);
  assertEquals(help.code, 0, help.stderr);
  assertEquals(listedCommands(help.stdout).sort(), Object.values(ExaCtlCommandName).sort());
});

Deno.test("request create → approval list shows the plan → plan approve", async () => {
  const [created, listed, approved, after] = await runExactlSeededWorkspace(seedReviewPlan, [
    ["request", "create", REQUEST_TEXT],
    ["approval", "list"],
    ["plan", "approve", PLAN_ID],
    ["approval", "list"],
  ]);
  assertEquals(created.code, 0, created.stderr);
  assertEquals(listed.code, 0, listed.stderr);
  assertStringIncludes(listed.stdout, `plan:${PLAN_ID}`);
  assertStringIncludes(listed.stdout, `exactl plan approve ${PLAN_ID}`);
  assertEquals(approved.code, 0, approved.stderr);
  assertEquals(after.code, 0, after.stderr);
  assertNotMatch(after.stdout, new RegExp(`plan:${PLAN_ID}`));
});

Deno.test("one legacy path per rename group exits 2 with its hint", async () => {
  const renames = onePerRenameGroup();
  assertArrayIncludes(
    renames.map((rename) => rename.canonical.split(" ")[NOUN_WORD_INDEX]),
    ["blueprint", "log", "skill", "model", "plan", "approval"],
  );
  const runs = await runExactlSequenceInTempWorkspace(renames.map((rename) => [...rename.legacy]));
  runs.forEach((run, index) => {
    const label = `${renames[index].legacy.join(" ")} → ${renames[index].canonical}`;
    assertEquals(run.code, USAGE_EXIT_CODE, `${label}\n${run.stderr}`);
    assertStringIncludes(run.stderr, `use '${renames[index].canonical}'`);
  });
});

Deno.test("the Team binary registers log export-otel and no journal root", async () => {
  const [help, journal] = await runExactlSeededWorkspace(
    () => {},
    [["log", "--help"], ["journal", "-n", "5"]],
    TEAM_ENTRY,
  );
  assertEquals(help.code, 0, help.stderr);
  assertStringIncludes(help.stdout, "export-otel");
  assertEquals(journal.code, USAGE_EXIT_CODE, journal.stderr);
  assertStringIncludes(journal.stderr, "use 'exactl log list'");
});
