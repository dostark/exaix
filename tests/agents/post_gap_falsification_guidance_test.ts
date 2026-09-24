/**
 * @module PostGapFalsificationGuidanceTest
 * @path tests/agents/post_gap_falsification_guidance_test.ts
 * @description Regression coverage for the generic problem-statement falsification
 * safeguards in the review-phase-code skill.
 */

import { assert } from "@std/assert";

const SKILL_PATH = ".copilot/skills/review-phase-code/SKILL.md";

Deno.test("Agent docs: review-phase-code requires problem-statement falsification beyond completed step criteria", async () => {
  const md = await Deno.readTextFile(SKILL_PATH);

  assert(
    md.includes("Required Outcome & Falsification Matrix"),
    "review-phase-code should require an explicit falsification matrix",
  );
  assert(
    md.includes("independently of the plan's completed step criteria"),
    "review-phase-code should derive required outcomes beyond completed step criteria",
  );
  assert(
    md.includes("cancellation, abandonment, and early exit"),
    "review-phase-code should require applicable non-success lifecycle probes",
  );
  assert(
    md.includes("canonical persisted or indexed field"),
    "review-phase-code should distinguish canonical stored values from payload copies",
  );
  assert(
    md.includes("prevents a required outcome"),
    "review-phase-code should not accept a documented limitation that defeats a stated goal",
  );
});

Deno.test("Agent docs: event coverage claims require exhaustive attributable runtime evidence", async () => {
  const postGap = await Deno.readTextFile(SKILL_PATH);
  const remediation = await Deno.readTextFile(
    ".copilot/skills/remediate-code-gaps/SKILL.md",
  );

  for (const md of [postGap, remediation]) {
    assert(
      md.includes("source-declared event") && md.includes("representative"),
      "event coverage guidance must reject representative component evidence as exhaustive proof",
    );
    assert(
      md.includes("real `EventLogger`") || md.includes("real-`EventLogger`"),
      "event coverage guidance must require the real EventLogger path",
    );
  }
  assert(
    /request-trace\s+scoping/.test(postGap),
    "scenario journal evidence must be scoped to the request under test",
  );
  assert(
    remediation.includes("#self-improvement-retro"),
    "gap remediation must hand off to the terminal retrospective before completion",
  );
});

Deno.test("Agent docs: remediation-step template requires a step-manifest and the plan skill requires multiplicity probes", async () => {
  const postGap = await Deno.readTextFile(SKILL_PATH);
  const plan = await Deno.readTextFile(".copilot/skills/plan/SKILL.md");
  const commit = await Deno.readTextFile(".copilot/skills/commit/SKILL.md");

  assert(
    postGap.includes("A phase\nplan step is missing or has an invalid step-manifest"),
    "review-phase-code should warn that a remediation step without a step-manifest blocks the commit",
  );
  assert(postGap.includes("# step-manifest"), "the remediation-step template should carry a step-manifest block");
  assert(
    plan.includes("Probe the multiplicity and edge shapes"),
    "plan §2F should require probing multi-item response shapes against the real API",
  );
  assert(
    commit.includes("Adding one new bullet to an already-completed step is not a plan-step commit"),
    "commit skill should explain that appending to a completed step needs an ordinary docs commit",
  );
});
