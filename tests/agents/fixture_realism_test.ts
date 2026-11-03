/**
 * @module FixtureRealismTest
 * @path tests/agents/fixture_realism_test.ts
 * @description Guards the fixture-realism rule in the test-development skill.
 * A fixture that exercises only the smallest layout that compiles can certify a
 * subsystem while a whole class of real layouts goes untested.
 * @architectural-layer Test
 */

import { assertStringIncludes } from "@std/assert";

Deno.test("Agent docs: the anti-pattern catalogue requires fixtures to exercise the dominant layout", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assertStringIncludes(
    md,
    "A fixture that tests only the convenient layout",
    "the catalogue must name the convenient-layout anti-pattern",
  );
  assertStringIncludes(
    md,
    "DOMINANT real-world layout",
    "the rule must state that the dominant layout is what a fixture must cover",
  );
  assertStringIncludes(
    md,
    "multiple files per package or module",
    "the rule must name the multi-file-per-package shape as required",
  );
  assertStringIncludes(md, "at least one cross-boundary call", "the rule must require a cross-boundary call");
  assertStringIncludes(
    md,
    "DEFAULT_IGNORE_PATTERNS",
    "the rule must warn that a fixture path can collide with the traversal ignore list",
  );
});
