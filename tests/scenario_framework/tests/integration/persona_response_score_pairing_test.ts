/**
 * @module PersonaResponseScorePairingTest
 * @path tests/scenario_framework/tests/integration/persona_response_score_pairing_test.ts
 * @description Ensures paired measurements use observed response criteria and exact trial provenance.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/persona_response_trial.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import { readPersonaResponseTrial } from "../../runner/persona_response_trial.ts";
import { createPersonaResponseFixture, personaCaptureInput } from "../helpers/persona_response_fixture.ts";
import { capturePersonaRoleResponse } from "../../runner/persona_response_evidence.ts";
import { join } from "@std/path";

Deno.test("[PersonaResponse] pairing retains zero judge score and rejects missing, duplicate or drifted trials", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    ctx.seed("accepted response");
    const input = personaCaptureInput(ctx.config);
    const evidence = await capturePersonaRoleResponse(input);
    const criterion = {
      criterion_id: "persona-response-quality",
      kind: "llm-judge",
      phase: "output",
      status: "failed",
      message: "valid zero",
      evidence_refs: [],
      score: 0,
      judge: { provider: input.provider, model: input.model },
    };
    const manifest = {
      scenarioId: input.taskId,
      pack: "persona_response_eval",
      mode: "auto",
      outcome: "failure",
      suite_score: 0.8,
      provider: input.provider,
      model: input.model,
      steps: [{
        stepId: "capture-role-response",
        stepType: "capture-role-response",
        executionStatus: "success",
        criterionResults: [{
          criterion_id: "response-captured",
          kind: "command-exit-code",
          phase: "output",
          status: "passed",
          message: "ok",
          evidence_refs: [],
        }],
      }, { stepId: "judge-response", stepType: "judge", executionStatus: "failure", criterionResults: [criterion] }],
    };
    const path = join(ctx.tempDir, "trial.json");
    const snapshot = { runId: input.runId, manifest, evidence };
    await Deno.writeTextFile(path, JSON.stringify(snapshot));
    const expected = {
      experimentId: input.experimentId,
      taskId: input.taskId,
      trialIndex: 0,
      variant: input.variant,
      provider: input.provider,
      model: input.model,
      agentRole: input.agentRole,
    };
    assertEquals((await readPersonaResponseTrial(path, expected)).score, 0);
    for (
      const change of [
        { ...snapshot, evidence: { ...evidence, provider: "wrong" } },
        { ...snapshot, evidence: { ...evidence, content: "tampered" } },
        { ...snapshot, runId: crypto.randomUUID() },
        { ...snapshot, manifest: { ...manifest, steps: [] } },
        { ...snapshot, manifest: { ...manifest, steps: [...manifest.steps, manifest.steps[1]] } },
      ]
    ) {
      await Deno.writeTextFile(path, JSON.stringify(change));
      await assertRejects(() => readPersonaResponseTrial(path, expected));
    }
  } finally {
    await ctx.cleanup();
  }
});
