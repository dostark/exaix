/**
 * @module EvalHistorySqliteE2eMetricsTest
 * @path tests/scenario_framework/tests/integration/eval_history_sqlite_e2e_metrics_test.ts
 * @description Phase 140a Step 1/4, GAP-1/GAP-5 — RED-first integration test. history_writer.ts's
 * buildEvalHistoryEntry only builds the JSONL-bound IEvalHistoryEntry; the real SQLite write
 * happens via a separate, independent projection in history_writer_dispatch.ts's
 * writeEvalHistoryEntries (extracted out of main.ts's step-12 CLI action, since main.ts's
 * top-level Command().parse(Deno.args) chain runs immediately on import and makes main.ts
 * itself unsafe to import from a test). Widening only history_writer.ts would leave new
 * per-step fields (durationMs in Step 1; llmDurationMs/tokens/trackedCostUsd in Step 4)
 * visible in JSONL but silently absent from eval_run_steps. This test drives the real,
 * extracted function end-to-end with a fixture manifest carrying a step's full metric set,
 * and asserts the resulting eval_run_steps row's columns match — proving the values survive
 * the actual production call chain, not just a direct EvalSqliteStore.writeRun() unit call.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/runner/history_writer_dispatch.ts, tests/scenario_framework/runner/history_writer.ts, packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalSqliteStore } from "@exaix/eval-history";
import { writeEvalHistoryEntries } from "../../runner/history_writer_dispatch.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";
import type { IScenarioVerdict } from "../../runner/scoring.ts";

Deno.test({
  name:
    "[EvalHistorySqliteE2eMetrics] the real main.ts step-12 call chain persists a manifest step's durationMs into eval_run_steps",
  fn: async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-e2e-metrics-" });
    const dbPath = join(outputDir, "eval.db");

    try {
      const manifest: IRunManifest = {
        scenarioId: "e2e-metrics-scenario",
        pack: "smoke",
        mode: "auto",
        outcome: "success",
        suite_score: 1.0,
        steps: [
          {
            stepId: "step-1",
            stepType: ScenarioStepType.SHELL,
            executionStatus: "passed",
            durationMs: 5555,
            llmDurationMs: 4444,
            tokens: { prompt: 100, completion: 50, cacheRead: 10, cacheCreation: 5, total: 150 },
            trackedCostUsd: 0.08,
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
      };

      const manifests = new Map([["e2e-metrics-scenario", manifest]]);
      const scenarioVerdicts: IScenarioVerdict[] = [
        { scenarioId: "e2e-metrics-scenario", pack: "smoke", suiteScore: 1.0, passed: true },
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
          `SELECT duration_ms, llm_duration_ms, tokens_prompt, tokens_completion,
                  tokens_cache_read, tokens_cache_creation, tracked_cost_usd
           FROM eval_run_steps WHERE step_id = ?`,
        ).get<{
          duration_ms: number | null;
          llm_duration_ms: number | null;
          tokens_prompt: number | null;
          tokens_completion: number | null;
          tokens_cache_read: number | null;
          tokens_cache_creation: number | null;
          tracked_cost_usd: number | null;
        }>("step-1");

        assertEquals(row?.duration_ms, 5555);
        assertEquals(row?.llm_duration_ms, 4444);
        assertEquals(row?.tokens_prompt, 100);
        assertEquals(row?.tokens_completion, 50);
        assertEquals(row?.tokens_cache_read, 10);
        assertEquals(row?.tokens_cache_creation, 5);
        assertEquals(row?.tracked_cost_usd, 0.08);

        const runRow = store["db"].prepare(
          "SELECT total_llm_duration_ms, total_tracked_cost_usd FROM eval_runs WHERE scenario_id = ?",
        ).get<{ total_llm_duration_ms: number | null; total_tracked_cost_usd: number | null }>(
          "e2e-metrics-scenario",
        );

        assertEquals(runRow?.total_llm_duration_ms, 4444);
        assertEquals(runRow?.total_tracked_cost_usd, 0.08);
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
