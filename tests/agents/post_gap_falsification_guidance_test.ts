/**
 * @module PostGapFalsificationGuidanceTest
 * @path tests/agents/post_gap_falsification_guidance_test.ts
 * @description Regression coverage for the generic problem-statement falsification
 * safeguards in the post-gap-analysis skill.
 */

import { assert } from "@std/assert";

const SKILL_PATH = ".copilot/skills/post-gap-analysis/SKILL.md";

Deno.test("Agent docs: post-gap-analysis requires problem-statement falsification beyond completed step criteria", async () => {
  const md = await Deno.readTextFile(SKILL_PATH);

  assert(
    md.includes("Required Outcome & Falsification Matrix"),
    "post-gap-analysis should require an explicit falsification matrix",
  );
  assert(
    md.includes("independently of the plan's completed step criteria"),
    "post-gap-analysis should derive required outcomes beyond completed step criteria",
  );
  assert(
    md.includes("cancellation, abandonment, and early exit"),
    "post-gap-analysis should require applicable non-success lifecycle probes",
  );
  assert(
    md.includes("canonical persisted or indexed field"),
    "post-gap-analysis should distinguish canonical stored values from payload copies",
  );
  assert(
    md.includes("prevents a required outcome"),
    "post-gap-analysis should not accept a documented limitation that defeats a stated goal",
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
