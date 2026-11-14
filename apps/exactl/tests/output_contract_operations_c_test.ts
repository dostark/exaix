/**
 * @module OutputContractOperationsCTest
 * @path apps/exactl/tests/output_contract_operations_c_test.ts
 * @description Runs every COLLECTION and ITEM leaf of eval with -o json on a fresh workspace and parses stdout.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts, apps/exactl/src/command_docs/mod.ts]
 * @related-files [apps/exactl/src/command_docs/eval_docs.ts, apps/exactl/src/command_builders/eval_command.ts]
 */

import { assertEquals } from "@std/assert";
import { ExaCtlOutputKind } from "@exaix/cli";
import { EXACTL_COMMAND_DOCS } from "../src/command_docs/mod.ts";
import { runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const READ_KINDS: readonly ExaCtlOutputKind[] = [ExaCtlOutputKind.COLLECTION, ExaCtlOutputKind.ITEM];
const JSON_FLAGS = ["-o", "json"];

/** Leaves that run here, with their arguments on a workspace that has no evaluation history. */
const INVOCATIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["eval history", ["eval", "history"]],
  ["eval compare", ["eval", "compare", "--run-a", "run-a", "--run-b", "run-b"]],
]);

const sweptLeaves = EXACTL_COMMAND_DOCS
  .filter((doc) => doc.path[0] === "eval" && READ_KINDS.includes(doc.output))
  .map((doc) => doc.path.join(" "));

Deno.test("every COLLECTION and ITEM leaf of eval is swept", () => {
  const known = [...INVOCATIONS.keys()];
  assertEquals(sweptLeaves.filter((leaf) => !known.includes(leaf)), []);
  assertEquals(known.filter((leaf) => !sweptLeaves.includes(leaf)), []);
});

Deno.test("every COLLECTION and ITEM leaf of eval prints valid JSON with -o json on an empty history", async () => {
  const leaves = [...INVOCATIONS.keys()];
  const runs = await runExactlSequenceInTempWorkspace(
    [...INVOCATIONS.values()].map((args) => [...args, ...JSON_FLAGS]),
  );
  runs.forEach((run, index) => {
    assertEquals(run.code, 0, `${leaves[index]}: ${run.stderr}`);
    JSON.parse(run.stdout);
  });
});

Deno.test("eval history -o json on an empty history prints an empty array", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["eval", "history", ...JSON_FLAGS]]);
  assertEquals(JSON.parse(run.stdout), []);
});

Deno.test("eval compare -o json reports that neither run was found", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([[...INVOCATIONS.get("eval compare")!, ...JSON_FLAGS]]);
  const report = JSON.parse(run.stdout);
  assertEquals([report.run_a, report.run_b, report.found, report.score_delta], ["run-a", "run-b", false, null]);
});
