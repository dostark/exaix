/**
 * @module OutputContractWorkNounsTest
 * @path apps/exactl/tests/output_contract_work_nouns_test.ts
 * @description Runs every COLLECTION and ITEM leaf of request, plan, review and approval with -o json on a seeded workspace and parses stdout.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts, apps/exactl/src/command_docs/mod.ts]
 * @related-files [apps/exactl/tests/helpers/work_nouns_seed.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { assertEquals } from "@std/assert";
import { ExaCtlOutputKind } from "@exaix/cli";
import { EXACTL_COMMAND_DOCS } from "../src/command_docs/mod.ts";
import { runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";
import { SEEDED_PLAN_ID, SEEDED_REQUEST_TRACE, SEEDED_WAIT_TOKEN, seedWorkNouns } from "./helpers/work_nouns_seed.ts";

const WORK_NOUNS = ["request", "plan", "review", "approval"];
const READ_KINDS: readonly ExaCtlOutputKind[] = [ExaCtlOutputKind.COLLECTION, ExaCtlOutputKind.ITEM];
const JSON_FLAGS = ["-o", "json"];

/** Leaves that run here, with their arguments on the seeded workspace. */
const INVOCATIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["request list", ["request", "list"]],
  ["request show", ["request", "show", SEEDED_REQUEST_TRACE]],
  ["request analyze", ["request", "analyze", SEEDED_REQUEST_TRACE]],
  ["plan list", ["plan", "list"]],
  ["plan show", ["plan", "show", SEEDED_PLAN_ID]],
  ["plan amendment list", ["plan", "amendment", "list"]],
  ["plan amendment show", ["plan", "amendment", "show", "--all"]],
  ["review list", ["review", "list"]],
  ["approval list", ["approval", "list"]],
  ["approval show", ["approval", "show", `wait:${SEEDED_WAIT_TOKEN}`]],
]);

/** Leaves whose JSON needs a fixture that this workspace cannot seed cheaply, with the test that holds each. */
const COVERED_ELSEWHERE: ReadonlyMap<string, string> = new Map([
  ["request inspect", "inspect_dispatch_test.ts"],
  ["review show", "review_show_json_output_test.ts"],
]);

const sweptLeaves = EXACTL_COMMAND_DOCS
  .filter((doc) => WORK_NOUNS.includes(doc.path[0]) && READ_KINDS.includes(doc.output))
  .map((doc) => doc.path.join(" "));

Deno.test("every COLLECTION and ITEM leaf of the work nouns is swept or covered by a named test", () => {
  const known = new Set([...INVOCATIONS.keys(), ...COVERED_ELSEWHERE.keys()]);
  assertEquals(sweptLeaves.filter((leaf) => !known.has(leaf)), []);
  assertEquals([...known].filter((leaf) => !sweptLeaves.includes(leaf)), []);
});

Deno.test("every swept COLLECTION and ITEM leaf of request, plan, review and approval prints valid JSON with -o json", async () => {
  const leaves = [...INVOCATIONS.keys()];
  const runs = await runExactlSeededWorkspace(
    seedWorkNouns,
    leaves.map((leaf) => [...INVOCATIONS.get(leaf)!, ...JSON_FLAGS]),
  );
  runs.forEach((run, index) => {
    assertEquals(run.code, 0, `${leaves[index]}: ${run.stderr}`);
    JSON.parse(run.stdout);
  });
});
