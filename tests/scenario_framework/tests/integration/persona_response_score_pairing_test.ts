/**
 * @module PersonaResponseScorePairingTest
 * @path tests/scenario_framework/tests/integration/persona_response_score_pairing_test.ts
 * @description Ensures paired measurements use observed response criteria and exact trial provenance.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/persona_response_trial.ts]
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { readCachedPersonaTrialSnapshot, readPersonaResponseTrial } from "../../runner/persona_response_trial.ts";
import { createPersonaResponseFixture, personaCaptureInput } from "../helpers/persona_response_fixture.ts";
import { capturePersonaRoleResponse } from "../../runner/persona_response_evidence.ts";
import { join } from "@std/path";

Deno.test("[PersonaResponse] pairing retains zero judge score and rejects missing, duplicate or drifted trials", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    ctx.seed("accepted response");
    const input = {
      ...personaCaptureInput(ctx.config),
      taskId: "swe-persona-response-explain-request-flow-codeanalyst",
    };
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
    const outputDir = join(ctx.tempDir, "persona-trials", input.taskId);
    await Deno.mkdir(outputDir, { recursive: true });
    const path = join(outputDir, "trial-0.json");
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
    assertEquals((await readCachedPersonaTrialSnapshot(ctx.tempDir, input.taskId, 0))?.runId, input.runId);
    for (
      const change of [
        {
          ...snapshot,
          manifest: {
            ...manifest,
            steps: [manifest.steps[0], {
              ...manifest.steps[1],
              criterionResults: [{ ...criterion, status: "error", score: undefined }],
            }],
          },
        },
        { ...snapshot, manifest: { ...manifest, provider: "wrong" } },
        { ...snapshot, manifest: { ...manifest, model: "wrong" } },
        { ...snapshot, evidence: { ...evidence, provider: "wrong" } },
        { ...snapshot, evidence: { ...evidence, content: "tampered" } },
        { ...snapshot, runId: crypto.randomUUID() },
        { ...snapshot, manifest: { ...manifest, steps: [] } },
        { ...snapshot, manifest: { ...manifest, steps: [...manifest.steps, manifest.steps[1]] } },
      ]
    ) {
      await Deno.writeTextFile(path, JSON.stringify(change));
      await assertRejects(() => readPersonaResponseTrial(path, expected));
      await assertRejects(() => readCachedPersonaTrialSnapshot(ctx.tempDir, input.taskId, 0));
    }
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "tests/scenario_framework/runner/main.ts",
        "--eval-mode",
        "--trials",
        "3",
        "--workspace",
        ctx.tempDir,
        "--output",
        ctx.tempDir,
        "--cell",
        "claude-code",
        "--scenario",
        input.taskId,
      ],
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    assertStringIncludes(output, "Executing 1 scenarios");
    assertEquals(result.code, 2, output);
    assertEquals(output.includes("[trial 2/3] Running"), false);
  } finally {
    await ctx.cleanup();
  }
});
