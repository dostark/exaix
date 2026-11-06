/**
 * @module ModelCommandTreeTest
 * @path apps/exactl/tests/model_command_tree_test.ts
 * @description Verifies the model noun, its route sub-noun and the removal of the models, routing and config model paths.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/docs/command_tree_walk.ts]
 * @related-files [apps/exactl/src/command_builders/model_command.ts, apps/exactl/src/exactl.ts]
 */

import { assertArrayIncludes, assertEquals } from "@std/assert";
import { createExaCtlCommand } from "../src/exactl.ts";
import { walkCommandTree } from "../src/docs/command_tree_walk.ts";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../src/exactl_constants.ts";

const nodes = walkCommandTree(createExaCtlCommand());

function childrenOf(parent: string): string[] {
  const depth = parent.split(" ").length + 1;
  return nodes
    .filter((node) => node.path.length === depth && node.path.slice(0, -1).join(" ") === parent)
    .map((node) => node.path[depth - 1])
    .sort();
}

Deno.test("model exposes list, refresh, use, candidates and route", () => {
  const expected = [
    ExaCtlVerb.LIST,
    ExaCtlVerb.REFRESH,
    ExaCtlVerb.USE,
    ExaCtlVerb.CANDIDATES,
    ExaCtlSubNoun.ROUTE,
  ].sort();
  assertEquals(childrenOf(ExaCtlCommandName.MODEL), expected);
});

Deno.test("model route exposes explain and validate", () => {
  assertEquals(childrenOf("model route"), [ExaCtlVerb.EXPLAIN, ExaCtlVerb.VALIDATE].sort());
});

Deno.test("the models and routing roots no longer exist", () => {
  const roots = nodes.filter((node) => node.path.length === 1).map((node) => node.path[0]);
  assertEquals(roots.filter((root) => root === "models" || root === "routing"), []);
  assertArrayIncludes(roots, [ExaCtlCommandName.MODEL]);
});

Deno.test("config no longer has set-model, set-provider or model", () => {
  const configLeaves = childrenOf(ExaCtlCommandName.CONFIG);
  assertEquals(configLeaves.filter((name) => ["set-model", "set-provider", "model"].includes(name)), []);
});

Deno.test("model candidates keeps the config model options", () => {
  const candidates = nodes.find((node) => node.path.join(" ") === "model candidates");
  assertArrayIncludes((candidates?.options ?? []).flatMap((option) => option.flags), [
    "--size",
    "--characteristic",
    "--clear",
    "--list",
  ]);
});
