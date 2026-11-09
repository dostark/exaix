/**
 * @module ShortFlagPolicyTest
 * @path apps/exactl/tests/short_flag_policy_test.ts
 * @description Holds the short-flag policy over the live exactl command tree: each letter has one meaning.
 * @architectural-layer Test
 * @dependencies [@std/assert, @cliffy/command, apps/exactl/tests/helpers/command_tree_lint_rules.ts]
 * @related-files [tests/fixtures/cli/command_tree_lint_test/command_tree_lint_allowlist.json]
 */

import { assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import { readFixtureTextSync } from "@exaix/testing";
import { createExaCtlCommand } from "../src/exactl.ts";
import { walkCommandTree } from "../src/docs/command_tree_walk.ts";
import { findShortFlagViolations, type IGrammarAllowlist } from "./helpers/command_tree_lint_rules.ts";

const allowlist = JSON.parse(
  readFixtureTextSync(import.meta.url, "cli", "command_tree_lint_test", "command_tree_lint_allowlist.json"),
) as IGrammarAllowlist;

const FOLLOWED_NOUNS = ["request", "plan", "review", "approval"];

function unlisted() {
  return findShortFlagViolations(walkCommandTree(createExaCtlCommand())).filter((violation) =>
    !allowlist["short-flag"].includes(violation.path)
  );
}

Deno.test("every short flag follows the policy or is allow-listed", () => {
  assertEquals(unlisted(), []);
});

Deno.test("short flags under the followed nouns follow the policy", () => {
  const entries = allowlist["short-flag"].filter((path) => FOLLOWED_NOUNS.includes(path.split(" ")[0]));
  assertEquals(entries, []);
});

Deno.test("a seeded short flag with another meaning is reported", () => {
  const tree = walkCommandTree(
    new Command().name("exactl").command(
      "plan",
      new Command().command(
        "list",
        new Command().option("-t, --type <type:string>", "Type").option("-s, --status <s:string>", "Status"),
      ),
    ),
  );
  assertEquals(findShortFlagViolations(tree).map((violation) => violation.path), ["plan list -t"]);
});
