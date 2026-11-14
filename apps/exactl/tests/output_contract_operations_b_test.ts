/**
 * @module OutputContractOperationsBTest
 * @path apps/exactl/tests/output_contract_operations_b_test.ts
 * @description Runs every COLLECTION and ITEM leaf of log, model and daemon with -o json on a seeded workspace and parses stdout.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts, apps/exactl/src/command_docs/mod.ts]
 * @related-files [apps/exactl/tests/helpers/operations_b_seed.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { assertEquals } from "@std/assert";
import { ExaCtlOutputKind } from "@exaix/cli";
import { EXACTL_COMMAND_DOCS } from "../src/command_docs/mod.ts";
import { runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";
import { ROUTING_REQUEST_FILE, seedRoutingWorkspace } from "./helpers/operations_b_seed.ts";

const OPERATIONS_B_NOUNS = ["log", "model", "daemon"];
const READ_KINDS: readonly ExaCtlOutputKind[] = [ExaCtlOutputKind.COLLECTION, ExaCtlOutputKind.ITEM];
const JSON_FLAGS = ["-o", "json"];

/** Leaves that run here, with their arguments on the seeded workspace. */
const INVOCATIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["log list", ["log", "list"]],
  ["log verify", ["log", "verify"]],
  ["log cost", ["log", "cost"]],
  ["model list", ["model", "list"]],
  ["model route explain", ["model", "route", "explain", "--request", ROUTING_REQUEST_FILE]],
  ["model route validate", ["model", "route", "validate"]],
  ["daemon status", ["daemon", "status"]],
]);

const sweptLeaves = EXACTL_COMMAND_DOCS
  .filter((doc) => OPERATIONS_B_NOUNS.includes(doc.path[0]) && READ_KINDS.includes(doc.output))
  .map((doc) => doc.path.join(" "));

Deno.test("every COLLECTION and ITEM leaf of log, model and daemon is swept", () => {
  const known = [...INVOCATIONS.keys()];
  assertEquals(sweptLeaves.filter((leaf) => !known.includes(leaf)), []);
  assertEquals(known.filter((leaf) => !sweptLeaves.includes(leaf)), []);
});

Deno.test("every swept COLLECTION and ITEM leaf of log, model and daemon prints valid JSON with -o json", async () => {
  const leaves = [...INVOCATIONS.keys()];
  const argsList = [...INVOCATIONS.values()].map((args) => [...args, ...JSON_FLAGS]);
  const runs = await runExactlSeededWorkspace(seedRoutingWorkspace, argsList);
  runs.forEach((run, index) => {
    assertEquals(run.code, 0, `${leaves[index]}: ${run.stderr}`);
    JSON.parse(run.stdout);
  });
});
