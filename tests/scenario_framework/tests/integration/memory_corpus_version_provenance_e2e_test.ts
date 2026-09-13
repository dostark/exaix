/**
 * @module MemoryCorpusVersionProvenanceE2eTest
 * @path tests/scenario_framework/tests/integration/memory_corpus_version_provenance_e2e_test.ts
 * @description Phase 148 Step 6 — mirrors `benchmark_provenance_e2e_test.ts`'s shape for the
 * new `memory-corpus-version:<tag>` convention: a manifest carrying that tag must have
 * `memory_corpus_version` derived and land in the real SQLite `eval_runs` row via the actual
 * production call chain (`writeEvalHistoryEntries`), not just a direct `EvalSqliteStore.writeRun()`
 * unit call. A manifest without the tag (every non-memory run) must persist NULL, unaffected.
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

function makeManifest(scenarioId: string, pack: string, tags?: string[]): IRunManifest {
  return {
    scenarioId,
    pack,
    mode: "auto",
    outcome: "success",
    suite_score: 1.0,
    tags,
    steps: [
      {
        stepId: "verify-step",
        stepType: ScenarioStepType.SHELL,
        executionStatus: "passed",
        criterionResults: [
          {
            criterion_id: "check",
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
    "[MemoryCorpusVersionProvenanceE2e] the real writeEvalHistoryEntries call chain derives memory_corpus_version from a memory-corpus-version: tag",
  fn: async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-memory-corpus-version-" });
    const dbPath = join(outputDir, "eval.db");

    try {
      const manifest = makeManifest("memory-info-extraction-basic", "memory", [
        "domain",
        "subsystem:memory",
        "ability:information-extraction",
        "memory-corpus-version:phase148-v1",
      ]);
      const manifests = new Map([["memory-info-extraction-basic", manifest]]);
      const scenarioVerdicts: IScenarioVerdict[] = [
        { scenarioId: "memory-info-extraction-basic", pack: "memory", suiteScore: 1.0, passed: true },
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
          "SELECT memory_corpus_version FROM eval_runs WHERE scenario_id = ?",
        ).get<{ memory_corpus_version: string | null }>("memory-info-extraction-basic");

        assertEquals(row?.memory_corpus_version, "phase148-v1");
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
    "[MemoryCorpusVersionProvenanceE2e] a non-memory run with no memory-corpus-version: tag persists NULL, unaffected",
  fn: async () => {
    const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-memory-corpus-version-" });
    const dbPath = join(outputDir, "eval.db");

    try {
      const manifest = makeManifest("swe-write-tests", "swe_tasks", ["task:bug-fix"]);
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
          "SELECT memory_corpus_version FROM eval_runs WHERE scenario_id = ?",
        ).get<{ memory_corpus_version: string | null }>("swe-write-tests");

        assertEquals(row?.memory_corpus_version, null);
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
