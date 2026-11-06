/**
 * @module SkillCommandTreeTest
 * @path apps/exactl/tests/skill_command_tree_test.ts
 * @description Verifies the skill noun exposes its ten commands and that the skills root and the memory skill group are gone.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/docs/command_tree_walk.ts]
 * @related-files [apps/exactl/src/command_builders/skill_commands.ts, apps/exactl/src/exactl.ts]
 */

import { assertArrayIncludes, assertEquals } from "@std/assert";
import { createExaCtlCommand } from "../src/exactl.ts";
import { walkCommandTree } from "../src/docs/command_tree_walk.ts";
import { ExaCtlCommandName, ExaCtlVerb } from "../src/exactl_constants.ts";

const nodes = walkCommandTree(createExaCtlCommand());

Deno.test("skill exposes list, show, match, create, derive, approve, deprecate, revisions, usage, validate", () => {
  const children = nodes
    .filter((node) => node.path.length === 2 && node.path[0] === ExaCtlCommandName.SKILL)
    .map((node) => node.path[1])
    .sort();
  const expected = [
    ExaCtlVerb.LIST,
    ExaCtlVerb.SHOW,
    ExaCtlVerb.MATCH,
    ExaCtlVerb.CREATE,
    ExaCtlVerb.DERIVE,
    ExaCtlVerb.APPROVE,
    ExaCtlVerb.DEPRECATE,
    ExaCtlVerb.REVISIONS,
    ExaCtlVerb.USAGE,
    ExaCtlVerb.VALIDATE,
  ].sort();
  assertEquals(children, expected);
});

Deno.test("the skills root and the memory skill group no longer exist", () => {
  const paths = nodes.map((node) => node.path.join(" "));
  assertEquals(paths.filter((path) => path === "skills" || path.startsWith("skills ")), []);
  assertEquals(paths.filter((path) => path === "memory skill" || path.startsWith("memory skill ")), []);
  assertArrayIncludes(paths, [ExaCtlCommandName.SKILL]);
});

Deno.test("the bare skill command keeps its list options", () => {
  const root = nodes.find((node) => node.path.join(" ") === ExaCtlCommandName.SKILL);
  assertArrayIncludes((root?.options ?? []).flatMap((option) => option.flags), ["--format", "--portal"]);
});
