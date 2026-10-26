// deno-lint-ignore-file no-explicit-any
/**
 * @module SkillSuppressionTest
 * @path packages/execution/tests/skill_suppression_test.ts
 * @description Phase 158 Step 2 (closes GAP-2) — a run-scoped skill-ablation arm
 * suppresses a skill from AgentRunner's resolved set via the EXA_EVAL_SUPPRESS_SKILLS
 * env var, without adding a request-contract field. Suppression applies to the FINAL
 * resolved set (pinned ∪ matched ∪ defaults), not only the dynamic-match sub-path, so a
 * pinned or default-sourced skill is suppressed just as reliably as a dynamically
 * matched one — otherwise a skill-ablation arm's control side would not actually be an
 * ablation for skills that only ever arrive via a pin or a default.
 * @architectural-layer Unit
 * @dependencies [@exaix/execution]
 * @related-files [packages/execution/src/agent_runner.ts]
 */

import { assertArrayIncludes, assertEquals, assertFalse } from "@std/assert";
import { EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR } from "@exaix/execution";
import type { IBlueprint } from "@exaix/execution";
import type { ICapturedEvent } from "@exaix/testing";
import { createRunner, resolutionEvents } from "./helpers/skill_runner_fixture.ts";

/** Runs `fn` with EXA_EVAL_SUPPRESS_SKILLS set, always restoring the prior value. */
async function withSuppressedSkills<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = Deno.env.get(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR);
  try {
    if (value === undefined) Deno.env.delete(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR);
    else Deno.env.set(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR, value);
    return await fn();
  } finally {
    if (previous === undefined) Deno.env.delete(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR);
    else Deno.env.set(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR, previous);
  }
}

Deno.test("[SkillSuppression] a suppressed default skill is absent from the resolved set", async () => {
  await withSuppressedSkills("tdd-methodology", async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured);
    const blueprint: IBlueprint = {
      systemPrompt: "test",
      defaultSkills: ["tdd-methodology", "error-handling"],
    };
    const request = { userPrompt: "do the thing", taskType: "feature" };

    const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-role");
    const resolved: string[] = result.skillIds;

    assertFalse(resolved.includes("tdd-methodology"), "the suppressed skill must not be in the resolved set");
    assertArrayIncludes(resolved, ["error-handling"], "an unsuppressed default must still be present");
  });
});

Deno.test("[SkillSuppression] a suppressed pinned skill is absent from the resolved set", async () => {
  await withSuppressedSkills("portal-grounding", async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured);
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: [] };
    const request = { skills: ["portal-grounding"], userPrompt: "do the thing", taskType: "feature" };

    const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-role");
    const resolved: string[] = result.skillIds;

    assertFalse(resolved.includes("portal-grounding"), "a pin does not override suppression");
  });
});

Deno.test("[SkillSuppression] a suppressed dynamically-matched skill is absent from the resolved set", async () => {
  await withSuppressedSkills("tdd-methodology", async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured, [{ skillId: "tdd-methodology", confidence: 1.0 }]);
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: [] };
    const request = { userPrompt: "fix the bug", taskType: "bugfix" };

    const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-role");
    const resolved: string[] = result.skillIds;

    assertFalse(resolved.includes("tdd-methodology"));
  });
});

Deno.test("[SkillSuppression] skills.resolved records which skill(s) were suppressed", async () => {
  await withSuppressedSkills("tdd-methodology", async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured);
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: ["tdd-methodology", "error-handling"] };
    const request = { userPrompt: "do the thing", taskType: "feature" };

    await (runner as any).matchAndApplySkills(blueprint, request, "test-role");

    const events = resolutionEvents(captured);
    assertEquals(events.length, 1);
    const payload = events[0].payload as { suppressed_skill_ids?: string[] };
    assertEquals(payload.suppressed_skill_ids, ["tdd-methodology"]);
  });
});

Deno.test("[SkillSuppression] with no suppression env var set, resolution is unaffected", async () => {
  await withSuppressedSkills(undefined, async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured);
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: ["tdd-methodology", "error-handling"] };
    const request = { userPrompt: "do the thing", taskType: "feature" };

    const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-role");
    const resolved: string[] = result.skillIds;

    assertArrayIncludes(resolved, ["tdd-methodology"]);
    assertArrayIncludes(resolved, ["error-handling"]);
  });
});

Deno.test("[SkillSuppression] an empty suppression list suppresses nothing", async () => {
  await withSuppressedSkills("", async () => {
    const captured: ICapturedEvent[] = [];
    const runner = createRunner(captured);
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: ["tdd-methodology"] };
    const request = { userPrompt: "do the thing", taskType: "feature" };

    const result = await (runner as any).matchAndApplySkills(blueprint, request, "test-role");
    assertEquals(result.skillIds.includes("tdd-methodology"), true);
  });
});
