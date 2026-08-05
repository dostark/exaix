/**
 * @module CostPropagationTest
 * @path tests/scenario_framework/tests/integration/cost_propagation_test.ts
 * @description Phase 143 Step 4 — locks the cost/token propagation path end-to-end through
 *   the real production call chain (`writeEvalHistoryEntries`): a manifest whose steps carry
 *   `trackedCostUsd`/`tokens` (delegate runs journal the parsed CLI cost as `cost_source:
 *   "tracked"`; bare cells come via `parseDelegateStdout`) lands in BOTH backends — the SQLite
 *   `eval_runs.total_tracked_cost_usd`/`total_tokens_*` row and the JSONL entry — and a run
 *   with no tracked cost is tolerated as absent (NULL / undefined), never zeroed. This is the
 *   "cost_per_solved" source-of-truth the frontier view reads.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/history_writer_dispatch.ts, tests/scenario_framework/runner/history_writer.ts, packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { EvalSqliteStore } from "@exaix/eval-history";
import { writeEvalHistoryEntries } from "../../runner/history_writer_dispatch.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";
import type { IScenarioVerdict } from "../../runner/scoring.ts";
import type { IEvalHistoryEntry } from "@exaix/eval-history";

function makeManifest(
  scenarioId: string,
  opts: { trackedCostUsd?: number; tokens?: { prompt: number; completion: number; total: number } } = {},
): IRunManifest {
  return {
    scenarioId,
    pack: "swe_tasks",
    mode: "auto",
    outcome: "success",
    suite_score: 0.9,
    steps: [
      {
        stepId: "verify-tests",
        stepType: ScenarioStepType.SHELL,
        executionStatus: "passed",
        durationMs: 1000,
        trackedCostUsd: opts.trackedCostUsd,
        tokens: opts.tokens,
        criterionResults: [
          {
            criterion_id: "tests-pass",
            kind: CriterionKind.COMMAND_EXIT_CODE,
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

Deno.test("[CostPropagation] tracked cost/tokens land in both backends; absent cost is tolerated", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "cost-propagation-" });
  const dbPath = join(outputDir, "eval.db");

  try {
    const costed = makeManifest("costed-run", {
      trackedCostUsd: 0.05,
      tokens: { prompt: 100, completion: 50, total: 150 },
    });
    const uncosted = makeManifest("uncosted-run");

    const manifests = new Map([
      ["costed-run", costed],
      ["uncosted-run", uncosted],
    ]);
    const scenarioVerdicts: IScenarioVerdict[] = [
      { scenarioId: "costed-run", pack: "swe_tasks", suiteScore: 0.9, passed: true },
      { scenarioId: "uncosted-run", pack: "swe_tasks", suiteScore: 0.9, passed: true },
    ];

    await writeEvalHistoryEntries({
      manifests,
      scenarioVerdicts,
      trialMetricsMap: new Map(),
      outputDir,
      historyFormat: "sqlite+jsonl",
      dbPath,
    });

    // SQLite backend: costed row carries the aggregate, uncosted row is NULL (absent, not 0).
    const store = new EvalSqliteStore(dbPath);
    try {
      const costedRow = store["db"].prepare(
        "SELECT total_tracked_cost_usd, total_tokens_prompt, total_tokens_completion FROM eval_runs WHERE scenario_id = ?",
      ).get<
        {
          total_tracked_cost_usd: number | null;
          total_tokens_prompt: number | null;
          total_tokens_completion: number | null;
        }
      >("costed-run");
      assertExists(costedRow);
      assertEquals(costedRow.total_tracked_cost_usd, 0.05);
      assertEquals(costedRow.total_tokens_prompt, 100);
      assertEquals(costedRow.total_tokens_completion, 50);

      const uncostedRow = store["db"].prepare(
        "SELECT total_tracked_cost_usd FROM eval_runs WHERE scenario_id = ?",
      ).get<{ total_tracked_cost_usd: number | null }>("uncosted-run");
      assertExists(uncostedRow);
      assertEquals(uncostedRow.total_tracked_cost_usd, null, "absent cost must stay absent, never zeroed");
    } finally {
      store.close();
    }

    // JSONL backend: the global history file carries both entries with the same semantics.
    const historyText = await Deno.readTextFile(join(outputDir, "history", "eval-history.jsonl"));
    const lines = historyText.trim().split("\n").map((l) => JSON.parse(l) as IEvalHistoryEntry);
    const costedEntry = lines.find((e) => e.scenario_id === "costed-run");
    const uncostedEntry = lines.find((e) => e.scenario_id === "uncosted-run");
    assertExists(costedEntry);
    assertExists(uncostedEntry);
    assertEquals(costedEntry.total_tracked_cost_usd, 0.05);
    assertEquals(costedEntry.total_tokens_prompt, 100);
    assertEquals(uncostedEntry.total_tracked_cost_usd, undefined, "absent cost must stay absent in JSONL too");
  } finally {
    await Deno.remove(outputDir, { recursive: true }).catch(() => {});
  }
});
