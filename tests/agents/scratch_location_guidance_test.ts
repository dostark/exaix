/**
 * @module ScratchLocationGuidanceTest
 * @path tests/agents/scratch_location_guidance_test.ts
 * @description Regression coverage for the rule that agent scratch output lives outside the repository.
 */

import { assertStringIncludes } from "@std/assert";

Deno.test("Agent docs: AGENTS.md keeps agent scratch output in the sibling sandbox tree", async () => {
  const md = await Deno.readTextFile("AGENTS.md");
  assertStringIncludes(md, "`<parent-of-repo>/exaix-sandboxes/<phase-or-topic>/`", "the scratch location is missing");
  assertStringIncludes(md, "Never create a scratch directory inside the", "the in-repo prohibition is missing");
  assertStringIncludes(md, "records its evidence as text", "the evidence-as-text rule is missing");
});
