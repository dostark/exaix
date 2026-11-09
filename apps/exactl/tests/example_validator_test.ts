/**
 * @module ExampleValidatorTest
 * @path apps/exactl/tests/example_validator_test.ts
 * @description Verifies that a doc example is checked against a command tree without running any action.
 * @architectural-layer Test
 * @dependencies [@std/assert, @cliffy/command, apps/exactl/src/docs/example_validator.ts]
 * @related-files [apps/exactl/src/docs/example_validator.ts, apps/exactl/src/docs/command_tree_walk.ts]
 */

import { assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import { walkCommandTree } from "../src/docs/command_tree_walk.ts";
import { ExampleIssueKind, type IExampleFlag, validateExample } from "../src/docs/example_validator.ts";

const GLOBAL_FLAGS: readonly IExampleFlag[] = [
  { flags: ["-o", "--output"], takesValue: true },
  { flags: ["--json"], takesValue: false },
  { flags: ["-q", "--quiet"], takesValue: false },
];

const tree = walkCommandTree(
  new Command()
    .name("exactl")
    .command(
      "plan",
      new Command()
        .command("list", new Command().option("-s, --status <status:string>", "Filter").option("--all", "All"))
        .command("show <id:string>", new Command())
        .command("approve [ids...:string]", new Command()),
    ),
);

function issues(command: string) {
  return validateExample(tree, GLOBAL_FLAGS, { title: "t", command });
}

Deno.test("a valid example passes", () => {
  assertEquals(issues("exactl plan list --status review"), []);
  assertEquals(issues("exactl plan list -s review --all"), []);
  assertEquals(issues("exactl plan approve a b c"), []);
});

Deno.test("an unknown option is reported", () => {
  assertEquals(issues("exactl plan list --bogus"), [{ kind: ExampleIssueKind.UNKNOWN_OPTION, token: "--bogus" }]);
});

Deno.test("an unknown command is reported", () => {
  assertEquals(issues("exactl planz list"), [{ kind: ExampleIssueKind.UNKNOWN_COMMAND, token: "planz" }]);
  assertEquals(issues("exactl plan"), [{ kind: ExampleIssueKind.UNKNOWN_COMMAND, token: "plan" }]);
});

Deno.test("a missing required argument is reported", () => {
  assertEquals(issues("exactl plan show"), [{ kind: ExampleIssueKind.MISSING_ARGUMENT, token: "id" }]);
});

Deno.test("too many arguments are reported", () => {
  assertEquals(issues("exactl plan show a b"), [{ kind: ExampleIssueKind.TOO_MANY_ARGUMENTS, token: "b" }]);
});

Deno.test("a global option before the command passes, and after the verb", () => {
  assertEquals(issues("exactl -o json plan list"), []);
  assertEquals(issues("exactl plan list -o json"), []);
  assertEquals(issues("exactl plan list --output=json --json"), []);
});

Deno.test("a quoted argument counts once and an option value is not an argument", () => {
  assertEquals(issues('exactl plan show "plan one"'), []);
  assertEquals(issues("exactl plan show 'plan one' --json"), []);
  assertEquals(issues("exactl plan list --status review"), []);
});

Deno.test("an example that does not start with exactl is reported", () => {
  assertEquals(issues("plan list"), [{ kind: ExampleIssueKind.UNKNOWN_COMMAND, token: "plan" }]);
});
