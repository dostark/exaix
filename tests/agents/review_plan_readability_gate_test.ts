/**
 * @module ReviewPlanReadabilityGateTest
 * @path tests/agents/review_plan_readability_gate_test.ts
 * @description Regression coverage for the review-phase-plan readability and
 * edition-runtime gates. Both were added after a first review pass adjudicated an
 * edition-tier mechanism whose source (an uninitialized submodule) could not be read,
 * and a second pass against the initialized source found blocking gaps.
 */

import { assert } from "@std/assert";

const SKILL_PATH = ".copilot/skills/review-phase-plan/SKILL.md";

Deno.test("Agent docs: review-phase-plan gates the review on submodule readability", async () => {
  const md = await Deno.readTextFile(SKILL_PATH);

  assert(
    md.includes("A claim about unreadable code is `⛔ UNVERIFIED`, never a finding."),
    "review-phase-plan must refuse to treat unreadable code as a finding",
  );
  assert(
    md.includes("Readability gate (run before anything else).** Run `git submodule status`"),
    "Phase 1 must open with a readability gate that runs git submodule status",
  );
  assert(
    md.includes("Check `git submodule status` FIRST."),
    "the Do list must require checking submodule status first",
  );
  assert(
    md.includes('Treat "I cannot read the subsystem"'),
    "Phase 1 must state that an unreadable subsystem is the first finding, not a caveat",
  );
  assert(
    md.includes("do NOT adjudicate the design question it underpins"),
    "the gate must forbid adjudicating a design question whose code is unreadable",
  );
});

Deno.test("Agent docs: review-phase-plan requires the edition build graph, not the tier map", async () => {
  const md = await Deno.readTextFile(SKILL_PATH);

  assert(
    md.includes("An edition-tier plan needs the BUILD graph, not the tier map."),
    "key points must require the build graph for edition-tier plans",
  );
  assert(
    md.includes("only the build graph proves a RUNTIME EXISTS"),
    "the skill must separate tier eligibility from runtime existence",
  );
  assert(
    md.includes("Delivery-vehicle check"),
    "Phase 2 must carry a delivery-vehicle check",
  );
  assert(
    md.includes("Accept an edition-tier claim from the capability map alone"),
    "the Don't list must reject capability-map-only edition claims",
  );
  assert(
    md.includes("Deno SKIPS unresolvable"),
    "the Don't list must warn that a green deno check can hide an uninitialized submodule",
  );
});
