/**
 * @module HistoryWriterStepDurationTest
 * @path tests/scenario_framework/tests/unit/history_writer_step_duration_test.ts
 * @description Phase 140a Step 1 — RED-first test. StepResultSchema has no duration_ms field
 * yet, so a manifest step's durationMs (Phase 140a Step 1) is silently dropped when building
 * the JSONL-bound history entry. Verifies durationMs flows from the manifest into
 * step_results[].duration_ms.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/history_writer.ts, packages/eval-history/src/history_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { writeEvalHistoryEntry } from "../../runner/history_writer.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";

function makeTestManifest(overrides: Partial<IRunManifest> = {}): IRunManifest {
  return {
    scenarioId: "test-scenario",
    pack: "smoke",
    mode: "auto",
    outcome: "success",
    steps: [
      {
        stepId: "step-1",
        stepType: ScenarioStepType.SHELL,
        executionStatus: "passed",
        durationMs: 999,
        criterionResults: [
          {
            criterion_id: "check-1",
            kind: CriterionKind.FILE_EXISTS,
            phase: CriterionPhase.OUTPUT,
            status: CriterionStatus.PASSED,
            message: "file exists",
            evidence_refs: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

Deno.test("[HistoryWriterStepDuration] manifest step durationMs flows into StepResultSchema.duration_ms", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-history-duration-" });

  try {
    const manifest = makeTestManifest();
    const entry = await writeEvalHistoryEntry({
      outputDir,
      scenarioId: "test-scenario",
      manifest,
    });

    assertEquals(entry.step_results?.[0].duration_ms, 999);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[HistoryWriterStepDuration] a step with no durationMs produces duration_ms: undefined, not 0", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-history-duration-" });

  try {
    const manifest = makeTestManifest({
      steps: [
        {
          stepId: "step-1",
          stepType: ScenarioStepType.SHELL,
          executionStatus: "passed",
          criterionResults: [],
        },
      ],
    });
    const entry = await writeEvalHistoryEntry({
      outputDir,
      scenarioId: "test-scenario",
      manifest,
    });

    assertEquals(entry.step_results?.[0].duration_ms, undefined);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});
