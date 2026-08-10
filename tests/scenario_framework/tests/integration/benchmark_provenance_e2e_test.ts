/**
 * @module BenchmarkProvenanceE2eTest
 * @path tests/scenario_framework/tests/integration/benchmark_provenance_e2e_test.ts
 * @description Phase 144 Step 5 — RED-first integration test, closing the
 * `terminal-bench-benchmark-field-population` Reachability Ledger row (Phase 144 Step 4). A
 * manifest whose tags carry the `bench:<name>` / `bench-version:<sha>` convention Step 5's
 * `renderExternalBenchTaskTemplate` now emits must have `benchmark`/`benchmark_version` derived
 * from those tags and land in the real SQLite `eval_runs` row via the actual production call
 * chain (`writeEvalHistoryEntries`, extracted from main.ts's step-12 CLI action) — not just a
 * direct `EvalSqliteStore.writeRun()` unit call. A manifest without those tags (every
 * pre-existing internal run) must persist NULL, unaffected.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/history_writer_dispatch.ts, tests/scenario_framework/runner/history_writer.ts, packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalSqliteStore } from "@exaix/eval-history";
import { writeEvalHistoryEntries } from "../../runner/history_writer_dispatch.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";
import type { IScenarioVerdict } from "../../runner/scoring.ts";

function makeManifest(scenarioId: string, tags?: string[]): IRunManifest {
  return {
    scenarioId,
    pack: "external_terminal_bench",
    mode: "auto",
    outcome: "success",
    suite_score: 1.0,
    tags,
    steps: [
      {
        stepId: "verify-tests",
        stepType: ScenarioStepType.SHELL,
        executionStatus: "passed",
        criterionResults: [
          {
            criterion_id: "tests-pass",
            kind: CriterionKind.FILE_EXISTS,
            phase: CriterionPhase.OUTPUT,
            status: CriterionStatus.PASSED,
            message: "tests passed",
            evidence_refs: [],
          },
        ],
      },
    ],
  };
}

Deno.test({
  name:
    "[BenchmarkProvenanceE2e] the real main.ts step-12 call chain derives benchmark/benchmark_version from bench:/bench-version: tags",
  fn: async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-bench-provenance-" });
    const dbPath = join(outputDir, "eval.db");

    try {
      const manifest = makeManifest("external-terminal-bench-log-summary", [
        "bench:terminal-bench",
        "bench-version:d28711d0da2675d0bb1d56de45ae5df6082438a3",
        "docker",
        "provider-live",
      ]);
      const manifests = new Map([["external-terminal-bench-log-summary", manifest]]);
      const scenarioVerdicts: IScenarioVerdict[] = [
        {
          scenarioId: "external-terminal-bench-log-summary",
          pack: "external_terminal_bench",
          suiteScore: 1.0,
          passed: true,
        },
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
          "SELECT benchmark, benchmark_version FROM eval_runs WHERE scenario_id = ?",
        ).get<{ benchmark: string | null; benchmark_version: string | null }>(
          "external-terminal-bench-log-summary",
        );

        assertEquals(row?.benchmark, "terminal-bench");
        assertEquals(row?.benchmark_version, "d28711d0da2675d0bb1d56de45ae5df6082438a3");
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
  name:
    "[BenchmarkProvenanceE2e] an internal run with no bench: tags persists NULL benchmark/benchmark_version, unaffected",
  fn: async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-bench-provenance-" });
    const dbPath = join(outputDir, "eval.db");

    try {
      const manifest = makeManifest("swe-write-tests", ["task:bug-fix"]);
      const manifests = new Map([["swe-write-tests", manifest]]);
      const scenarioVerdicts: IScenarioVerdict[] = [
        { scenarioId: "swe-write-tests", pack: "swe_tasks", suiteScore: 1.0, passed: true },
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
          "SELECT benchmark, benchmark_version FROM eval_runs WHERE scenario_id = ?",
        ).get<{ benchmark: string | null; benchmark_version: string | null }>("swe-write-tests");

        assertEquals(row?.benchmark, null);
        assertEquals(row?.benchmark_version, null);
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
