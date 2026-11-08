/**
 * @module ModelCommandTreeTest
 * @path apps/exactl/tests/model_command_tree_test.ts
 * @description Verifies the model noun, its route sub-noun and the removal of the models, routing and config model paths.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/command_tree.ts]
 * @related-files [apps/exactl/src/command_builders/model_command.ts, apps/exactl/src/exactl.ts]
 */

import { assertArrayIncludes, assertEquals } from "@std/assert";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../src/exactl_constants.ts";
import { childrenOf, nodes } from "./helpers/command_tree.ts";

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
