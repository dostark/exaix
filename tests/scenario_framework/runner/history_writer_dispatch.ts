/**
 * @module ScenarioFrameworkHistoryWriterDispatch
 * @path tests/scenario_framework/runner/history_writer_dispatch.ts
 * @description Dispatches eval history writes (JSONL via history_writer.ts, and — unless
 * historyFormat is "jsonl" — SQLite via EvalSqliteStore.writeRun) for every scenario in a
 * run's manifests map. Extracted out of main.ts's step-12 CLI action (Phase 140a Step 1) so
 * it can be imported and driven directly by tests — main.ts's top-level `await new
 * Command()....parse(Deno.args)` chain runs immediately on import, making main.ts itself
 * unsafe to import from a test.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/runner/history_writer.ts, packages/eval-history/src/history_sqlite.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";
import { EvalSqliteStore, resolveEvalDbPath } from "@exaix/eval-history";
import { writeEvalHistoryEntry } from "./history_writer.ts";
import type { IRunManifest } from "./evidence_collector.ts";
import type { IScenarioVerdict } from "./scoring.ts";

export interface IWriteEvalHistoryEntriesOptions {
  manifests: Map<string, IRunManifest>;
  scenarioVerdicts: IScenarioVerdict[];
  trialMetricsMap: Map<string, {
    trials: number;
    trialScores: number[];
    suiteScoreMean: number;
    suiteScoreStdev: number;
    passAt1: number;
    passPowK: number;
  }>;
  outputDir: string;
  historyFormat?: Opt<string, Reason.OptionalInput>;
  scoreThreshold?: Opt<number, Reason.OptionalInput>;
  /** Override for the SQLite history db path — defaults to resolveEvalDbPath() (production
   *  behavior). Test-only seam so this real call chain can be driven with a temp db. */
  dbPath?: Opt<string, Reason.OptionalInput>;
}

const BENCHMARK_TAG_PREFIX = "bench:";
const BENCHMARK_VERSION_TAG_PREFIX = "bench-version:";

/** One tag's value shape: benchmark provenance derived from a manifest's `bench:<name>` /
 *  `bench-version:<sha>` tags — the convention `renderExternalBenchTaskTemplate` stamps onto
 *  every generated Terminal-Bench scenario. Absent on every internal (non-external) run. */
interface IBenchmarkProvenance {
  benchmark?: string;
  benchmarkVersion?: string;
}

function deriveBenchmarkProvenance(tags: Opt<string[], Reason.OptionalInput>): IBenchmarkProvenance {
  const benchmark = tags?.find((t) => t.startsWith(BENCHMARK_TAG_PREFIX))?.slice(BENCHMARK_TAG_PREFIX.length);
  const benchmarkVersion = tags?.find((t) => t.startsWith(BENCHMARK_VERSION_TAG_PREFIX))?.slice(
    BENCHMARK_VERSION_TAG_PREFIX.length,
  );
  return {
    ...(benchmark !== undefined ? { benchmark } : {}),
    ...(benchmarkVersion !== undefined ? { benchmarkVersion } : {}),
  };
}

// The sole production call site that projects `manifest.steps` into `EvalSqliteStore.writeRun`'s
// `steps` parameter; independent of `history_writer.ts`'s own `step_results` (JSONL) mapping —
// a field widened only there is silently absent from `eval_run_steps` unless widened here too.
export async function writeEvalHistoryEntries(options: IWriteEvalHistoryEntriesOptions): Promise<void> {
  const historyFormat = options.historyFormat ?? "sqlite+jsonl";
  let sqliteStore: EvalSqliteStore | undefined;
  if (historyFormat !== "jsonl") {
    const dbPath = options.dbPath ?? resolveEvalDbPath();
    sqliteStore = new EvalSqliteStore(dbPath);
    try {
      sqliteStore.initialize();
    } catch (error) {
      console.error("Failed to initialize SQLite history store:", error);
      sqliteStore = undefined;
    }
  }

  for (const [scenarioId, manifest] of options.manifests) {
    const scenarioVerdict = options.scenarioVerdicts.find((v) => v.scenarioId === scenarioId);
    try {
      const trialMetrics = options.trialMetricsMap.get(scenarioId);
      const entry = await writeEvalHistoryEntry({
        outputDir: options.outputDir,
        scenarioId,
        manifest,
        scoreThreshold: scenarioVerdict !== undefined ? options.scoreThreshold : undefined,
        thresholdPassed: scenarioVerdict?.passed,
        ...(trialMetrics ?? {}),
        cellId: manifest.cellId,
        provider: manifest.provider,
        model: manifest.model,
        ...deriveBenchmarkProvenance(manifest.tags),
      });

      if (sqliteStore) {
        try {
          sqliteStore.writeRun(
            entry,
            manifest.steps.map((s) => ({
              stepId: s.stepId,
              stepType: s.stepType,
              score: s.score ?? computeStepScoreFromCriterionResults(s.criterionResults, s.executionStatus),
              executionStatus: s.executionStatus,
              durationMs: s.durationMs,
              llmDurationMs: s.llmDurationMs,
              tokens: s.tokens,
              trackedCostUsd: s.trackedCostUsd,
            })),
          );
        } catch (error) {
          console.error(`Failed to write SQLite history for ${scenarioId}:`, error);
        }
      }
    } catch (error) {
      console.error(`Failed to write eval history for ${scenarioId}:`, error);
    }
  }

  if (sqliteStore) {
    sqliteStore.close();
  }
}

function computeStepScoreFromCriterionResults(
  results: { status: string; score_weight?: number; score?: number }[],
  executionStatus?: Opt<string, Reason.OptionalContext>,
): number {
  if (executionStatus === "execution-failed") return 0;
  if (results.length === 0) return 1.0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const r of results) {
    if (r.status === "skipped") continue;
    if (r.status === "error" || r.status === "timeout") {
      const w = r.score_weight ?? 1.0;
      totalWeight += w;
      continue;
    }
    const w = r.score_weight ?? 1.0;
    totalWeight += w;
    const score = r.score !== undefined ? r.score : (r.status === "passed" ? 1 : 0);
    weightedSum += score * w;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 1.0;
}
