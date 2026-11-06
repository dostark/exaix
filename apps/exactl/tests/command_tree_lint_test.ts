/**
 * @module CommandTreeLintTest
 * @path apps/exactl/tests/command_tree_lint_test.ts
 * @description Walks the live exactl command tree and holds the command grammar with a shrinking allow-list.
 * @architectural-layer Test
 * @dependencies [@std/assert, @cliffy/command, apps/exactl/src/docs/command_tree_walk.ts]
 * @related-files [apps/exactl/tests/helpers/command_tree_lint_rules.ts, tests/fixtures/cli/command_tree_lint_test/command_tree_lint_allowlist.json]
 */

import { assert, assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import { readFixtureTextSync } from "@exaix/testing";
import { createExaCtlCommand } from "../src/exactl.ts";
import { walkCommandTree } from "../src/docs/command_tree_walk.ts";
import { EXACTL_RENAMES } from "../src/exactl_renames.ts";
import {
  findGrammarViolations,
  findLegacyPaths,
  findStaleAllowlistEntries,
  type IGrammarAllowlist,
  isAllowlisted,
} from "./helpers/command_tree_lint_rules.ts";

const allowlist = JSON.parse(
  readFixtureTextSync(import.meta.url, "cli", "command_tree_lint_test", "command_tree_lint_allowlist.json"),
) as IGrammarAllowlist;

const liveNodes = walkCommandTree(createExaCtlCommand());

function seededTree(leafName: string) {
  return new Command().name("exactl").command("plan", new Command().command(leafName, new Command().action(() => {})));
}

Deno.test("every leaf verb is an ExaCtlVerb member or allow-listed", () => {
  const unlisted = findGrammarViolations(liveNodes)
    .filter((violation) => violation.rule === "leaf-verb" && !isAllowlisted(violation, allowlist));
  assertEquals(unlisted, []);
});

Deno.test("every root, sub-noun, compound-leaf and duplicate-handler violation is allow-listed", () => {
  const unlisted = findGrammarViolations(liveNodes)
    .filter((violation) => violation.rule !== "leaf-verb" && !isAllowlisted(violation, allowlist));
  assertEquals(unlisted, []);
});

Deno.test("a seeded compound leaf fails the lint", () => {
  const violations = findGrammarViolations(walkCommandTree(seededTree("foo-all")));
  assert(violations.some((violation) => violation.rule === "compound-leaf" && violation.path === "plan foo-all"));
  assert(violations.some((violation) => violation.rule === "leaf-verb" && violation.path === "plan foo-all"));
});

Deno.test("a seeded valid verb leaf passes the lint", () => {
  assertEquals(findGrammarViolations(walkCommandTree(seededTree("approve"))), []);
});

Deno.test("allow-list entries that no longer occur fail the lint", () => {
  assertEquals(findStaleAllowlistEntries(findGrammarViolations(liveNodes), allowlist), []);
  const withStale: IGrammarAllowlist = { ...allowlist, "leaf-verb": [...allowlist["leaf-verb"], "plan gone-leaf"] };
  assertEquals(findStaleAllowlistEntries(findGrammarViolations(liveNodes), withStale), [
    { rule: "leaf-verb", path: "plan gone-leaf" },
  ]);
});

Deno.test("no legacy path of EXACTL_RENAMES exists in the live tree", () => {
  assertEquals(findLegacyPaths(liveNodes, EXACTL_RENAMES), []);
});

Deno.test("a seeded legacy path is reported", () => {
  const seeded = new Command().name("exactl").command(
    "blueprint",
    new Command().command("ls", new Command().action(() => {})),
  );
  assertEquals(findLegacyPaths(walkCommandTree(seeded), EXACTL_RENAMES), ["blueprint ls"]);
});

Deno.test("no allow-listed compound-leaf entry remains for a plan or memory leaf", () => {
  const remaining = allowlist["compound-leaf"].filter((path) => path.startsWith("plan ") || path.startsWith("memory "));
  assertEquals(remaining, []);
});

Deno.test("the compound-leaf allow-list is empty", () => {
  assertEquals(allowlist["compound-leaf"], []);
});

Deno.test("the grammar allow-list is empty", () => {
  assertEquals(Object.values(allowlist).flat(), []);
});
