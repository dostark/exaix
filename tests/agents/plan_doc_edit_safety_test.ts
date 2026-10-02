/**
 * @module PlanDocEditSafetyGuidanceTest
 * @path tests/agents/plan_doc_edit_safety_test.ts
 * @description Guards the plan skill's safe-edit guidance for plan documents. A computed
 *   line-index splice, or a markdown_lint --fix left unverified, drops the `step: N` key
 *   from every step-manifest below the edit point, so the doc blocks at the pre-commit
 *   check:manifests gate. Naming that failure mode in the skill is only worth anything if
 *   the guidance stays there.
 * @architectural-layer Test
 * @related-files [.copilot/skills/plan/SKILL.md, .copilot/skills/next-steps/SKILL.md, scripts/check_step_manifests.ts]
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

Deno.test("Agent docs: the plan skill documents safe plan-doc editing and its failure mode", async () => {
  const planSkill = await Deno.readTextFile(join(REPO_ROOT, ".copilot", "skills", "plan", "SKILL.md"));

  assert(
    planSkill.includes("### Editing an existing plan doc safely"),
    "the plan skill must carry a section on editing an existing plan doc",
  );
  assert(
    planSkill.includes("Never insert or delete by computed line number"),
    "the plan skill must forbid line-index splices, the failure mode that drops step: N",
  );
  assert(
    planSkill.includes("check_step_manifests.ts"),
    "the plan skill must name the structural check that detects the damage",
  );
  assert(
    planSkill.includes("Recovery when it goes wrong"),
    "the plan skill must state the recovery path, so repair is not improvised",
  );
});

Deno.test("Agent docs: the next-steps skill routes plan-doc edit safety to the plan skill", async () => {
  const nextSteps = await Deno.readTextFile(join(REPO_ROOT, ".copilot", "skills", "next-steps", "SKILL.md"));

  assert(
    nextSteps.includes("Editing an existing plan doc safely"),
    "next-steps edits plan docs in place, so its Do/Don't list must point at the safe-edit rule",
  );
});
