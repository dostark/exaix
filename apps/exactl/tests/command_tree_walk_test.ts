/**
 * @module CommandTreeWalkTest
 * @path apps/exactl/tests/command_tree_walk_test.ts
 * @description Verifies the command tree walker reports paths, aliases, arguments, options, descriptions and examples.
 * @architectural-layer Test
 * @dependencies [@std/assert, @cliffy/command, apps/exactl/src/docs/command_tree_walk.ts]
 * @related-files [apps/exactl/src/docs/command_tree_walk.ts]
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import { walkCommandTree } from "../src/docs/command_tree_walk.ts";

const leaf = new Command()
  .alias("ls")
  .description("List the things")
  .arguments("<kind:string> [more...:string]")
  .option("-s, --status <status:string>", "Filter by status", { required: true })
  .option("-n, --limit <count:number>", "Show last N entries", { default: 20 })
  .option("--hidden-flag", "Not listed in help", { hidden: true })
  .example("List everything", "exactl thing list all")
  .action(() => {});

function fixtureTree() {
  return new Command().name("exactl").command("thing", new Command().description("Things").command("list", leaf));
}

Deno.test("walkCommandTree lists every descendant with its path and skips help", () => {
  const nodes = walkCommandTree(fixtureTree());
  assertEquals(nodes.map((node) => node.path.join(" ")), ["thing", "thing list"]);
});

Deno.test("walkCommandTree reports aliases, arguments, options and examples of a leaf", () => {
  const node = walkCommandTree(fixtureTree()).find((candidate) => candidate.path.join(" ") === "thing list");
  assertEquals(node?.aliases, ["ls"]);
  assertEquals(node?.description, "List the things");
  assertEquals(node?.args, [
    { name: "kind", optional: false, variadic: false },
    { name: "more", optional: true, variadic: true },
  ]);
  const status = node?.options.find((option) => option.name === "status");
  assertEquals(status, {
    name: "status",
    flags: ["-s", "--status"],
    takesValue: true,
    required: true,
    hidden: false,
    description: "Filter by status",
    valueName: "status",
    valueType: "string",
    defaultValue: undefined,
  });
  const limit = node?.options.find((option) => option.name === "limit");
  assertEquals([limit?.valueType, limit?.defaultValue], ["number", "20"]);
  assertEquals(node?.options.find((option) => option.name === "hidden-flag")?.hidden, true);
  assertEquals(node?.examples, [{ name: "List everything", description: "exactl thing list all" }]);
  assertStrictEquals(node?.command, leaf);
});

Deno.test("the hidden completion helper and the children of a hidden command are marked hidden", () => {
  const tree = new Command().name("exactl").command(
    "completion",
    new Command().command("bash", new Command()).command("complete", new Command().hidden()),
  ).command("completions", new Command().hidden().command("bash", new Command()));
  const nodes = walkCommandTree(tree);
  assertEquals(nodes.map((node) => [node.path.join(" "), node.hidden]), [
    ["completion", false],
    ["completion bash", false],
    ["completion complete", true],
    ["completions", true],
    ["completions bash", true],
  ]);
});
