/**
 * @module TotalDurationMsE2eTest
 * @path tests/scenario_framework/tests/integration/total_duration_ms_e2e_test.ts
 * @description Phase 148 Step 8 (Post-Gap Analysis GAP-1 remediation) — RED-first test.
 * `eval_runs.duration_ms` (the run-level column `eval_commands.ts`'s memory report reads)
 * is never populated by the real production write chain, even though the real value exists
 * per-step in `eval_run_steps.duration_ms`. This test drives the real
 * `writeEvalHistoryEntries` call chain with two real steps carrying `durationMs` and asserts
 * a new `total_duration_ms` run-level aggregate — mirroring the existing
 * `total_llm_duration_ms` pattern exactly — is genuinely summed and persisted.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/history_writer.ts, tests/scenario_framework/runner/history_writer_dispatch.ts, packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalSqliteStore } from "@exaix/eval-history";
import { writeEvalHistoryEntries } from "../../runner/history_writer_dispatch.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";
import type { IScenarioVerdict } from "../../runner/scoring.ts";

function makeManifest(scenarioId: string): IRunManifest {
  return {
    scenarioId,
    pack: "memory",
    mode: "auto",
    outcome: "success",
    suite_score: 1.0,
    steps: [
      {
        stepId: "step-1",
        stepType: ScenarioStepType.RUN_SCRIPT,
        executionStatus: "passed",
        durationMs: 500,
        criterionResults: [
          {
            criterion_id: "check-1",
            kind: CriterionKind.FILE_EXISTS,
            phase: CriterionPhase.OUTPUT,
            status: CriterionStatus.PASSED,
            message: "passed",
            evidence_refs: [],
          },
        ],
      },
      {
        stepId: "step-2",
        stepType: ScenarioStepType.RUN_SCRIPT,
        executionStatus: "passed",
        durationMs: 300,
        criterionResults: [
          {
            criterion_id: "check-2",
            kind: CriterionKind.FILE_EXISTS,
            phase: CriterionPhase.OUTPUT,
            status: CriterionStatus.PASSED,
            message: "passed",
            evidence_refs: [],
          },
        ],
      },
    ],
  };
}

Deno.test({
  name:
    "[TotalDurationMsE2e] the real writeEvalHistoryEntries call chain sums per-step durationMs into a run-level total_duration_ms",
  fn: async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-total-duration-" });
    const dbPath = join(outputDir, "eval.db");

    try {
      const manifest = makeManifest("total-duration-ms-scenario");
      const manifests = new Map([["total-duration-ms-scenario", manifest]]);
      const scenarioVerdicts: IScenarioVerdict[] = [
        { scenarioId: "total-duration-ms-scenario", pack: "memory", suiteScore: 1.0, passed: true },
      ];

      await writeEvalHistoryEntries({
        manifests,
        scenarioVerdicts,
        trialMetricsMap: new Map(),
        outputDir,
        historyFormat: "sqlite+jsonl",
        dbPath,
        scoreThreshold: 0.6,
      });

      const store = new EvalSqliteStore(dbPath);
      try {
        const row = store["db"].prepare(
          "SELECT total_duration_ms FROM eval_runs WHERE scenario_id = ?",
        ).get<{ total_duration_ms: number | null }>("total-duration-ms-scenario");

        assertEquals(row?.total_duration_ms, 800);
      } finally {
        store.close();
      }
    } finally {
      await Deno.remove(outputDir, { recursive: true });
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[TotalDurationMsE2e] a run with no step durations persists NULL total_duration_ms, unaffected",
  fn: async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-total-duration-" });
    const dbPath = join(outputDir, "eval.db");

    try {
      const manifest: IRunManifest = {
        scenarioId: "no-duration-scenario",
        pack: "memory",
        mode: "auto",
        outcome: "success",
        suite_score: 1.0,
        steps: [
          {
            stepId: "step-1",
            stepType: ScenarioStepType.RUN_SCRIPT,
            executionStatus: "passed",
            criterionResults: [
              {
                criterion_id: "check-1",
                kind: CriterionKind.FILE_EXISTS,
                phase: CriterionPhase.OUTPUT,
                status: CriterionStatus.PASSED,
                message: "passed",
                evidence_refs: [],
              },
            ],
          },
        ],
      };
      const manifests = new Map([["no-duration-scenario", manifest]]);
      const scenarioVerdicts: IScenarioVerdict[] = [
        { scenarioId: "no-duration-scenario", pack: "memory", suiteScore: 1.0, passed: true },
      ];

      await writeEvalHistoryEntries({
        manifests,
        scenarioVerdicts,
        trialMetricsMap: new Map(),
        outputDir,
        historyFormat: "sqlite+jsonl",
        dbPath,
        scoreThreshold: 0.6,
      });

      const store = new EvalSqliteStore(dbPath);
      try {
        const row = store["db"].prepare(
          "SELECT total_duration_ms FROM eval_runs WHERE scenario_id = ?",
        ).get<{ total_duration_ms: number | null }>("no-duration-scenario");

        assertEquals(row?.total_duration_ms, null);
      } finally {
        store.close();
      }
    } finally {
      await Deno.remove(outputDir, { recursive: true });
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
