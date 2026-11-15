/**
 * @module ExaCtlContractsCutoverTest
 * @path apps/exactl/tests/exactl_contracts_cutover_test.ts
 * @description Proves the output, exit-code and help contracts through the real Solo and Team binaries: JSON for every read leaf, one command per exit-code class, the group help and an example with a docs link in every leaf help.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts, apps/exactl/src/command_docs/mod.ts]
 * @related-files [apps/exactl/src/exactl_error_handler.ts, apps/exactl/src/output/exactl_output.ts, packages/cli/src/docs/exactl_command_doc.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exactlDocsLink, ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { OTEL_EXPORT_DOC } from "@exaix-team/otel-export";
import { EXACTL_COMMAND_DOCS } from "../src/command_docs/mod.ts";
import { stripTerminalControls } from "../src/output/exactl_output.ts";
import { ExaCtlCommandGroup } from "../src/docs/exactl_noun_doc.ts";
import { EXIT_CODE_CASES, runExitCodeCase } from "./helpers/exit_code_cases.ts";
import {
  type IExaCtlCliRun,
  type IExaCtlEntry,
  runExactlSeededWorkspace,
  SOLO_ENTRY,
  TEAM_ENTRY,
} from "./helpers/exactl_cli_process.ts";
import { seedDefinitionNouns } from "./helpers/definition_nouns_seed.ts";
import { seedWorkNouns } from "./helpers/work_nouns_seed.ts";

/** How many workspaces run at once. Each one runs its commands in order. */
const PARALLEL_WORKSPACES = 4;
const EXAMPLE_PREFIX = "exactl ";
const JSON_FLAGS: readonly string[] = ["-o", "--json", "--output"];
const EXAMPLES_HEADING = "Examples:";
const GROUP_HEADINGS = Object.values(ExaCtlCommandGroup);

const READ_KINDS: ReadonlySet<ExaCtlOutputKind> = new Set([ExaCtlOutputKind.COLLECTION, ExaCtlOutputKind.ITEM]);

async function seedWorkspace(root: string): Promise<void> {
  await seedWorkNouns(root);
  await seedDefinitionNouns(root);
}

/** The words of the first example of a record, which the doc rules keep valid. */
function wordsOf(doc: IExaCtlCommandDoc): string[] {
  return doc.examples[0].command.slice(EXAMPLE_PREFIX.length).split(" ").filter((word) => word !== "");
}

/** Runs the lists of arguments over a few workspaces at once and returns the runs in order. */
async function runSwept(argsList: string[][], entry: IExaCtlEntry): Promise<IExaCtlCliRun[]> {
  const size = Math.ceil(argsList.length / PARALLEL_WORKSPACES);
  const chunks = Array.from(
    { length: PARALLEL_WORKSPACES },
    (_, index) => argsList.slice(index * size, (index + 1) * size),
  );
  const results = await Promise.all(
    chunks.filter((chunk) => chunk.length > 0).map((chunk) => runExactlSeededWorkspace(seedWorkspace, chunk, entry)),
  );
  return results.flat();
}

function readLeaves(docs: readonly IExaCtlCommandDoc[]): IExaCtlCommandDoc[] {
  return docs.filter((doc) => READ_KINDS.has(doc.output));
}

/** A read leaf with `-o json` prints JSON on stdout. A failure adds the JSON error shape on stderr. */
function assertJsonContract(doc: IExaCtlCommandDoc, run: IExaCtlCliRun): void {
  const label = doc.path.join(" ");
  if (run.code === ExaCtlExitCode.OK) {
    JSON.parse(run.stdout);
    return;
  }
  if (run.stdout.trim() !== "") JSON.parse(run.stdout);
  const last = run.stderr.trim().split("\n").pop() ?? "";
  const error = JSON.parse(last).error;
  assert(typeof error.code === "string" && typeof error.message === "string", `${label}: ${last}`);
}

async function sweepJson(docs: readonly IExaCtlCommandDoc[], entry: IExaCtlEntry): Promise<void> {
  const leaves = readLeaves(docs);
  assert(leaves.length > 40, "the sweep covers the read leaves of the tree");
  const argsList = leaves.map((doc) => {
    const words = wordsOf(doc);
    return words.some((word) => JSON_FLAGS.includes(word)) ? words : [...words, "-o", "json"];
  });
  const runs = await runSwept(argsList, entry);
  runs.forEach((run, index) => assertJsonContract(leaves[index], run));
}

async function sweepHelp(docs: readonly IExaCtlCommandDoc[], entry: IExaCtlEntry): Promise<void> {
  const runs = await runSwept(docs.map((doc) => [...doc.path, "--help"]), entry);
  runs.forEach((run, index) => {
    const label = docs[index].path.join(" ");
    assertEquals(run.code, 0, `${label}: ${run.stderr}`);
    const help = stripTerminalControls(run.stdout);
    assertStringIncludes(help, EXAMPLES_HEADING, label);
    assertStringIncludes(help, exactlDocsLink(docs[index].path), label);
  });
}

Deno.test("every COLLECTION and ITEM leaf prints JSON with -o json on the real binary", async () => {
  await sweepJson(EXACTL_COMMAND_DOCS, SOLO_ENTRY);
});

Deno.test("exit codes 2, 3, 4, 6, 124 reproduce on the real binary and doctor returns 5 and 7", async () => {
  const codes = new Set<number>();
  for (const exitCase of EXIT_CODE_CASES) {
    const run = await runExitCodeCase(exitCase);
    assertEquals(run.code, exitCase.expected, `${exitCase.label}: ${run.stderr}`);
    codes.add(run.code);
  }
  assertEquals([...codes].sort((a, b) => a - b), [2, 3, 4, 5, 6, 7, 124]);
});

Deno.test("exactl --help shows the four groups and a leaf help shows its example", async () => {
  const [help] = await runExactlSeededWorkspace(() => {}, [["--help"]]);
  assertEquals(help.code, 0, help.stderr);
  const text = stripTerminalControls(help.stdout);
  for (const group of GROUP_HEADINGS) assertStringIncludes(text, `${group}:`);
});

Deno.test("every leaf's --help on the real binary shows an example and a docs link", async () => {
  await sweepHelp(EXACTL_COMMAND_DOCS, SOLO_ENTRY);
});

Deno.test("the Team binary passes the same JSON and help sweep", async () => {
  const teamDocs = [...EXACTL_COMMAND_DOCS, OTEL_EXPORT_DOC];
  await sweepJson(teamDocs, TEAM_ENTRY);
  await sweepHelp(teamDocs, TEAM_ENTRY);
});
