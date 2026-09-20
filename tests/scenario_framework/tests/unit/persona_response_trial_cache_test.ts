/**
 * @module PersonaResponseTrialCacheTest
 * @path tests/scenario_framework/tests/unit/persona_response_trial_cache_test.ts
 * @description Pins the resumable-trial cache read used to skip already-completed live trials.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/persona_response_trial.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { readCachedPersonaTrialSnapshot, writePersonaResponseTrial } from "../../runner/persona_response_trial.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";

Deno.test("[PersonaResponseTrialCache] returns undefined when no cached trial exists", async () => {
  const dir = await Deno.makeTempDir({ prefix: "persona-trial-cache-" });
  try {
    const cached = await readCachedPersonaTrialSnapshot(dir, "swe-persona-response-fix-bug-null-guard", 0);
    assertEquals(cached, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[PersonaResponseTrialCache] reuses a previously persisted trial snapshot", async () => {
  const dir = await Deno.makeTempDir({ prefix: "persona-trial-cache-" });
  try {
    const manifest: IRunManifest = {
      scenarioId: "swe-persona-response-fix-bug-null-guard",
      pack: "persona_response_eval",
      mode: "auto",
      outcome: "success",
      suite_score: 0.72,
      provider: "claude-cli",
      model: "claude-sonnet-5",
      steps: [{
        stepId: "capture-role-response",
        stepType: ScenarioStepType.CAPTURE_ROLE_RESPONSE,
        executionStatus: "success",
        criterionResults: [{
          criterion_id: "response-captured",
          kind: CriterionKind.COMMAND_EXIT_CODE,
          phase: CriterionPhase.OUTPUT,
          status: CriterionStatus.PASSED,
          message: "captured",
          evidence_refs: [],
        }],
      }, {
        stepId: "judge-response",
        stepType: ScenarioStepType.JUDGE,
        executionStatus: "success",
        criterionResults: [{
          criterion_id: "persona-response-quality",
          kind: CriterionKind.LLM_JUDGE,
          phase: CriterionPhase.OUTPUT,
          status: CriterionStatus.PASSED,
          message: "judged",
          evidence_refs: [],
          score: 0.72,
          judge: { provider: "claude-cli", model: "claude-sonnet-5" },
        }],
      }],
    };
    const evidence = {
      traceId: "11111111-1111-4111-8111-111111111111",
      agentRole: "senior-coder",
      provider: "claude-cli",
      model: "claude-sonnet-5",
      experimentId: "phase161-step2-full-senior-coder",
      taskId: "swe-persona-response-fix-bug-null-guard",
      trialIndex: 0,
      variant: "shipped",
      runId: "22222222-2222-4222-8222-222222222222",
      responseRowid: 1,
      planPath: "Workspace/Plans/current_plan.md",
      content: "accepted content",
      contentHash: Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("accepted content"))),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join(""),
      rawResponseHash: "b".repeat(64),
    } as const;
    const path = join(dir, "persona-trials", "swe-persona-response-fix-bug-null-guard", "trial-0.json");
    await Deno.mkdir(join(dir, "persona-trials", "swe-persona-response-fix-bug-null-guard"), { recursive: true });
    await writePersonaResponseTrial(path, "22222222-2222-4222-8222-222222222222", manifest, evidence);

    const cached = await readCachedPersonaTrialSnapshot(dir, "swe-persona-response-fix-bug-null-guard", 0);
    assertEquals(cached?.manifest.suite_score, 0.72);
    assertEquals(cached?.runId, "22222222-2222-4222-8222-222222222222");
    const invalidManifest: IRunManifest = {
      ...manifest,
      steps: [manifest.steps[0], {
        ...manifest.steps[1],
        criterionResults: [{
          ...manifest.steps[1].criterionResults[0],
          status: CriterionStatus.ERROR,
          score: undefined,
        }],
      }],
    };
    await assertRejects(
      () => writePersonaResponseTrial(join(dir, "invalid-trial.json"), evidence.runId, invalidManifest, evidence),
      Error,
      "Invalid or drifted persona response judgment",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
