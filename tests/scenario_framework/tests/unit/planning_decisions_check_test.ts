/**
 * @module PlanningDecisionsCheckTest
 * @path tests/scenario_framework/tests/unit/planning_decisions_check_test.ts
 * @description Checks request identity and independent planning record controls.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/planning_decisions_check.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import { TestEnvironment } from "@exaix/testing";
import { checkPlanningRecord } from "../../runner/planning_decisions_check.ts";
import samples from "../../fixtures/planning_decisions/records.json" with { type: "json" };
import { applyRequirementsControl } from "../helpers/requirements_controls.ts";
import { writeSkillEvalPlan as writePlan } from "../helpers/skill_eval_plan.ts";

const FIRST = "request-0123abcd";
const SECOND = "request-89abcdef";

Deno.test("planning record check evaluates the named request and reports remaining review gates", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    const sample = samples[0];
    const good = JSON.stringify(sample.good);
    const bad = applyRequirementsControl(good, JSON.stringify(sample.bad[0]));
    await writePlan(env.tempDir, FIRST, good);
    await writePlan(env.tempDir, SECOND, bad);
    const result = await checkPlanningRecord(sample.case_id, env.tempDir, FIRST);
    assertEquals(result.recordPassed, true);
    assertEquals(result.semanticReviewPending, true);
    assertEquals(result.fileInspectionPending, true);
    assertEquals(result.evaluation.delivery.status, "pending");
    assertEquals(result.evaluation.behavior.status, "pending");
    assertEquals(result.evaluation.effects.status, "pending");
    assertEquals(result.evaluation.overall, "pending");
    assertEquals((await checkPlanningRecord(sample.case_id, env.tempDir, SECOND)).recordPassed, false);
    await assertRejects(
      () => checkPlanningRecord(sample.case_id, env.tempDir, "../outside"),
      Error,
      "Invalid request identity",
    );
  } finally {
    await env.cleanup();
  }
});

Deno.test("planning record check rejects each independent incorrect outcome", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    for (const sample of samples) {
      const good = JSON.stringify(sample.good);
      await writePlan(env.tempDir, FIRST, good);
      assertEquals((await checkPlanningRecord(sample.case_id, env.tempDir, FIRST)).recordPassed, true);
      for (const changes of sample.bad) {
        const bad = applyRequirementsControl(good, JSON.stringify(changes));
        await writePlan(env.tempDir, FIRST, bad);
        assertEquals((await checkPlanningRecord(sample.case_id, env.tempDir, FIRST)).recordPassed, false);
      }
    }
  } finally {
    await env.cleanup();
  }
});
