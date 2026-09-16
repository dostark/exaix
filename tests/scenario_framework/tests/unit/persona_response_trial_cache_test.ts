/**
 * @module PersonaResponseTrialCacheTest
 * @path tests/scenario_framework/tests/unit/persona_response_trial_cache_test.ts
 * @description Pins the resumable-trial cache read used to skip already-completed live trials.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/persona_response_trial.ts]
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { readCachedPersonaTrialSnapshot, writePersonaResponseTrial } from "../../runner/persona_response_trial.ts";
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
      steps: [],
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
      contentHash: "a".repeat(64),
      rawResponseHash: "b".repeat(64),
    } as const;
    const path = join(dir, "persona-trials", "swe-persona-response-fix-bug-null-guard", "trial-0.json");
    await Deno.mkdir(join(dir, "persona-trials", "swe-persona-response-fix-bug-null-guard"), { recursive: true });
    await writePersonaResponseTrial(path, "33333333-3333-4333-8333-333333333333", manifest, evidence);

    const cached = await readCachedPersonaTrialSnapshot(dir, "swe-persona-response-fix-bug-null-guard", 0);
    assertEquals(cached?.manifest.suite_score, 0.72);
    assertEquals(cached?.runId, "33333333-3333-4333-8333-333333333333");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
