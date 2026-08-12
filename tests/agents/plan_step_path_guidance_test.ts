/**
 * @module PlanStepPathGuidanceTest
 * @path tests/agents/plan_step_path_guidance_test.ts
 * @description Verifies the next-steps and remediate-code-gaps skills document the
 * plan-step commit arrow rules for plan-doc-self-referencing criteria, and that the
 * clean-codebase skill names the staged md-path ratchet as the enforceable gate.
 * Regression for phase-162 Step 12: the plan doc's criteria arrows used the internal
 * submodule path, which the parent commit gate rejected ("…not among this commit's
 * changed files"); the fix (gitlink `exaix-dev-docs` arrow + amending the submodule
 * commit instead of adding a follow-up one) had to be reverse-engineered from
 * check_commit_msg.ts + a phase-144 precedent.
 */

import { assert } from "@std/assert";

Deno.test("Agent docs: next-steps documents the gitlink arrow for plan-doc criteria", async () => {
  const md = await Deno.readTextFile(".copilot/skills/next-steps/SKILL.md");

  assert(
    md.includes("exaix-dev-docs`") && md.includes("gitlink"),
    "next-steps should name the gitlink path convention for plan-doc criteria arrows",
  );
  assert(
    md.includes("not among this commit's changed files"),
    "next-steps should warn about the parent gate rejection message",
  );
  assert(
    md.includes("--amend --no-edit"),
    "next-steps should direct amending the submodule commit when the parent gate rejects plan-doc lines",
  );
});

Deno.test("Agent docs: remediate-code-gaps documents the same arrow + amend rules", async () => {
  const md = await Deno.readTextFile(".copilot/skills/remediate-code-gaps/SKILL.md");

  assert(
    md.includes("exaix-dev-docs`") && md.includes("gitlink"),
    "remediate-code-gaps should name the gitlink path convention for plan-doc criteria arrows",
  );
  assert(
    md.includes("--amend --no-edit"),
    "remediate-code-gaps should direct amending the submodule commit when the parent gate rejects plan-doc lines",
  );
  assert(
    md.includes("HEAD~1..HEAD"),
    "remediate-code-gaps should cite the validatePlanStepDiff added-lines requirement",
  );
});

Deno.test("Agent docs: clean-codebase names the staged md-path ratchet as the enforceable gate", async () => {
  const md = await Deno.readTextFile(".copilot/skills/clean-codebase/SKILL.md");

  assert(
    md.includes("check:md-path:staged"),
    "clean-codebase should run the staged md-path ratchet, not the full sweep",
  );
  assert(
    md.includes("unenforced drift"),
    "clean-codebase should warn against fixing historical submodule planning-doc drift",
  );
});
