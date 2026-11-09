/**
 * @module OutputContractDefinitionNounsTest
 * @path apps/exactl/tests/output_contract_definition_nouns_test.ts
 * @description Runs every COLLECTION and ITEM leaf of flow, blueprint, skill and portal with -o json on a seeded workspace and parses stdout.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts, apps/exactl/src/command_docs/mod.ts]
 * @related-files [apps/exactl/tests/helpers/definition_nouns_seed.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { assertEquals } from "@std/assert";
import { ExaCtlOutputKind } from "@exaix/cli";
import { EXACTL_COMMAND_DOCS } from "../src/command_docs/mod.ts";
import { runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";
import {
  seedDefinitionNouns,
  SEEDED_AGENT_ID,
  SEEDED_FLOW_ID,
  SEEDED_PORTAL_ALIAS,
  SEEDED_PORTAL_DIR,
} from "./helpers/definition_nouns_seed.ts";

const DEFINITION_NOUNS = ["flow", "blueprint", "skill", "portal"];
const READ_KINDS: readonly ExaCtlOutputKind[] = [ExaCtlOutputKind.COLLECTION, ExaCtlOutputKind.ITEM];
const JSON_FLAGS = ["-o", "json"];
const SKILL_SLUG = "seed-skill";
const TRACE_ID = "trace-sweep";

/** Commands that create the entities the read leaves then show. */
const SETUP: readonly (readonly string[])[] = [
  ["blueprint", "create", SEEDED_AGENT_ID, "--name", "Seed Agent", "--model", "mock:test"],
  ["skill", "create", "Seed Skill", "--instructions", "Seed body."],
  ["portal", "add", SEEDED_PORTAL_DIR, SEEDED_PORTAL_ALIAS],
];

/** Leaves that run here, with their arguments on the seeded workspace. */
const INVOCATIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["flow list", ["flow", "list"]],
  ["flow show", ["flow", "show", SEEDED_FLOW_ID]],
  ["flow validate", ["flow", "validate", SEEDED_FLOW_ID]],
  ["blueprint list", ["blueprint", "list"]],
  ["blueprint show", ["blueprint", "show", SEEDED_AGENT_ID]],
  ["blueprint validate", ["blueprint", "validate", SEEDED_AGENT_ID]],
  ["skill list", ["skill", "list"]],
  ["skill show", ["skill", "show", SKILL_SLUG]],
  ["skill match", ["skill", "match", "seed body"]],
  ["skill revisions", ["skill", "revisions", SKILL_SLUG]],
  ["skill usage", ["skill", "usage", "--trace", TRACE_ID]],
  ["skill validate", ["skill", "validate"]],
  ["portal list", ["portal", "list"]],
  ["portal show", ["portal", "show", SEEDED_PORTAL_ALIAS]],
  ["portal verify", ["portal", "verify"]],
  ["portal knowledge show", ["portal", "knowledge", "show", SEEDED_PORTAL_ALIAS]],
]);

/** Leaves whose JSON needs a fixture that this workspace cannot seed cheaply, with the test that holds each. */
const COVERED_ELSEWHERE: ReadonlyMap<string, string> = new Map([
  ["flow bindings", "flow_bindings_command_test.ts"],
]);

const sweptLeaves = EXACTL_COMMAND_DOCS
  .filter((doc) => DEFINITION_NOUNS.includes(doc.path[0]) && READ_KINDS.includes(doc.output))
  .map((doc) => doc.path.join(" "));

Deno.test("every COLLECTION and ITEM leaf of the definition nouns is swept or covered by a named test", () => {
  const known = new Set([...INVOCATIONS.keys(), ...COVERED_ELSEWHERE.keys()]);
  assertEquals(sweptLeaves.filter((leaf) => !known.has(leaf)), []);
  assertEquals([...known].filter((leaf) => !sweptLeaves.includes(leaf)), []);
});

Deno.test("every swept COLLECTION and ITEM leaf of flow, blueprint, skill and portal prints valid JSON with -o json", async () => {
  const leaves = [...INVOCATIONS.keys()];
  const runs = await runExactlSeededWorkspace(
    seedDefinitionNouns,
    [...SETUP.map((args) => [...args]), ...leaves.map((leaf) => [...INVOCATIONS.get(leaf)!, ...JSON_FLAGS])],
  );
  SETUP.forEach((args, index) => assertEquals(runs[index].code, 0, `${args.join(" ")}: ${runs[index].stderr}`));
  runs.slice(SETUP.length).forEach((run, index) => {
    assertEquals(run.code, 0, `${leaves[index]}: ${run.stderr}`);
    JSON.parse(run.stdout);
  });
});
