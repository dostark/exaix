/**
 * @module ScenarioFrameworkHistoryWriter
 * @path tests/scenario_framework/runner/history_writer.ts
 * @description Implements eval history JSONL writing with atomic append
 * to both scenario-specific and global history files.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/history_schema.ts, tests/scenario_framework/tests/unit/history_writer_test.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";
import { EvalScoringMode } from "@exaix/core";
import { dirname, fromFileUrl, resolve } from "@std/path";
import { gitServiceFor } from "./git_helpers.ts";
import {
  EvalHistoryEntrySchema,
  getDefaultComponentVersions,
  type IComponentVersions,
  type IEvalHistoryEntry,
} from "@exaix/eval-history";
import type { IRunManifest, IRunManifestStep } from "./evidence_collector.ts";
import { ScoringMode } from "./scoring.ts";

export interface IWriteEvalHistoryOptions {
  outputDir: string;
  scenarioId: string;
  manifest: IRunManifest;
  scoreThreshold?: number;
  thresholdPassed?: boolean;
  trials?: number;
  trialScores?: number[];
  suiteScoreMean?: number;
  suiteScoreStdev?: number;
  passAt1?: number;
  passPowK?: number;
  durationMs?: number;
  traceId?: string;
  provider?: string;
  model?: string;
  cellId?: string;
  benchmark?: string;
  benchmarkVersion?: string;
}

// The scenario framework lives at <repo>/tests/scenario_framework; this file is under runner/.
const FRAMEWORK_DIR = resolve(fromFileUrl(new URL(".", import.meta.url)), "..");
const GIT_UNKNOWN_COMMIT = "unknown";

/**
 * Capture the scenario-framework's git provenance for an eval run: the HEAD commit and whether the
 * working tree has uncommitted changes. This records WHICH framework code produced a result (the
 * runner/executor/assertion logic, which evolves independently of the declarative schema version).
 * Resolution failures (no git, detached, CI without .git) degrade to `unknown`/`false` rather than
 * failing the run — provenance is best-effort metadata, never a gate.
 */
async function captureFrameworkGitProvenance(): Promise<{ commit: string; dirty: boolean }> {
  const git = gitServiceFor(FRAMEWORK_DIR);
  async function gitSafe(args: string[]): Promise<{ ok: boolean; out: string }> {
    try {
      const result = await git.runGitCommand(args, { throwOnError: false });
      return { ok: result.exitCode === 0, out: result.output.trim() };
    } catch {
      return { ok: false, out: "" };
    }
  }
  const head = await gitSafe(["rev-parse", "HEAD"]);
  // `git status --porcelain` of the framework subtree: any output = uncommitted changes present.
  const status = await gitSafe(["status", "--porcelain", "--", FRAMEWORK_DIR]);
  return {
    commit: head.ok && head.out.length > 0 ? head.out : GIT_UNKNOWN_COMMIT,
    dirty: status.ok ? status.out.length > 0 : false,
  };
}

async function buildComponentVersions(): Promise<IComponentVersions> {
  const provenance = await captureFrameworkGitProvenance();
  return {
    ...getDefaultComponentVersions(),
    framework_commit: provenance.commit,
    framework_dirty: provenance.dirty,
  };
}

const GLOBAL_HISTORY_DIR = "history";
const HISTORY_FILE = "eval-history.jsonl";

/**
 * Writes an eval history entry to both scenario-specific and global history files.
 * Uses atomic append: writes to a temp file in the same directory, then renames.
 */
export async function writeEvalHistoryEntry(options: IWriteEvalHistoryOptions): Promise<IEvalHistoryEntry> {
  const componentVersions = await buildComponentVersions();
  const entry = buildEvalHistoryEntry(options.manifest, componentVersions, options);

  const parsed = EvalHistoryEntrySchema.parse(entry);

  // Scenario-specific history
  const scenarioDir = resolve(options.outputDir, GLOBAL_HISTORY_DIR, options.scenarioId);
  await writeJsonlLine(scenarioDir, parsed);

  // Global history
  const globalDir = resolve(options.outputDir, GLOBAL_HISTORY_DIR);
  await writeJsonlLine(globalDir, parsed);

  return parsed;
}

function buildEvalHistoryEntry(
  manifest: IRunManifest,
  componentVersions: IComponentVersions,
  opts?: Opt<IWriteEvalHistoryOptions, Reason.OptionalInput>,
): IEvalHistoryEntry {
  const entry: IEvalHistoryEntry = {
    run_id: crypto.randomUUID(),
    scenario_id: manifest.scenarioId,
    pack: manifest.pack,
    outcome: manifest.outcome,
    mode: manifest.mode,
    suite_score: manifest.suite_score,
    score_threshold: opts?.scoreThreshold,
    scoring_mode: manifest.scoringMode === ScoringMode.GATED ? EvalScoringMode.GATED : EvalScoringMode.ADDITIVE,
    failure_classes: manifest.failureClasses,
    step_count: manifest.steps.length,
    step_results: manifest.steps.map((s) => ({
      step_id: s.stepId,
      score: s.score ??
        (s.criterionResults.length > 0
          ? s.criterionResults.filter((c) => c.status === "passed").length / s.criterionResults.length
          : 1.0),
      criteria_passed: s.criterionResults.filter((c) => c.status === "passed").length,
      criteria_total: s.criterionResults.length,
      duration_ms: s.durationMs,
      llm_duration_ms: s.llmDurationMs,
      tokens_prompt: s.tokens?.prompt,
      tokens_completion: s.tokens?.completion,
      tokens_cache_read: s.tokens?.cacheRead,
      tokens_cache_creation: s.tokens?.cacheCreation,
      tracked_cost_usd: s.trackedCostUsd,
    })),
    ...aggregateStepMetrics(manifest.steps),
    tags: manifest.tags,
    passed: opts?.thresholdPassed ?? manifest.outcome === "success",
    timestamp: new Date().toISOString(),
    component_versions: componentVersions,
  };

  // Populate multi-trial fields when provided
  if (opts?.trials !== undefined && opts.trials > 1) {
    entry.trials = opts.trials;
    entry.trial_scores = opts.trialScores;
    entry.suite_score_mean = opts.suiteScoreMean;
    entry.suite_score_stdev = opts.suiteScoreStdev;
    entry.pass_at_1 = opts.passAt1;
    entry.pass_pow_k = opts.passPowK;
  }

  // Enrichment fields
  if (opts?.durationMs !== undefined) entry.duration_ms = opts.durationMs;
  if (opts?.traceId !== undefined) entry.trace_id = opts.traceId;
  if (opts?.provider !== undefined) entry.provider = opts.provider;
  if (opts?.model !== undefined) entry.model = opts.model;
  if (opts?.cellId !== undefined) entry.cell_id = opts.cellId;
  if (opts?.benchmark !== undefined) entry.benchmark = opts.benchmark;
  if (opts?.benchmarkVersion !== undefined) entry.benchmark_version = opts.benchmarkVersion;

  return entry;
}

interface IStepMetricAggregates {
  total_llm_duration_ms?: number;
  total_tokens_prompt?: number;
  total_tokens_completion?: number;
  total_tokens_cache_read?: number;
  total_tokens_cache_creation?: number;
  total_tracked_cost_usd?: number;
}

/**
 * Scenario-level aggregates summed across step_results. total_tracked_cost_usd sums only the
 * steps that have a defined trackedCostUsd, omitting (not zeroing) any step whose LLM calls
 * were all predicted-cost — a scenario with zero tracked steps produces undefined, not 0.
 */
function aggregateStepMetrics(steps: IRunManifestStep[]): IStepMetricAggregates {
  const sumOptional = (values: Array<number | undefined>): number | undefined => {
    const defined = values.filter((v): v is number => v !== undefined);
    return defined.length > 0 ? defined.reduce((a, b) => a + b, 0) : undefined;
  };

  return {
    total_llm_duration_ms: sumOptional(steps.map((s) => s.llmDurationMs)),
    total_tokens_prompt: sumOptional(steps.map((s) => s.tokens?.prompt)),
    total_tokens_completion: sumOptional(steps.map((s) => s.tokens?.completion)),
    total_tokens_cache_read: sumOptional(steps.map((s) => s.tokens?.cacheRead)),
    total_tokens_cache_creation: sumOptional(steps.map((s) => s.tokens?.cacheCreation)),
    total_tracked_cost_usd: sumOptional(steps.map((s) => s.trackedCostUsd)),
  };
}

/**
 * Appends a JSONL line to a file using true append mode (O_APPEND).
 * Deno.open with { append: true, create: true } opens or creates the file
 * and positions the write cursor at the end, so concurrent writers do not
 * clobber each other. A single write() syscall appends the line atomically
 * at the OS level (for lines < PIPE_BUF, typically 4KiB).
 *
 * Partial-line risk: if a single write() produces more bytes than the
 * kernel's atomic-guarantee size (PIPE_BUF on most Unixes), a concurrent
 * reader could see a partial line. In practice, JSONL entries are
 * 1–3 KiB, well within the guarantee. Documented for future awareness.
 */
async function writeJsonlLine(directory: string, entry: IEvalHistoryEntry): Promise<void> {
  const historyPath = resolve(directory, HISTORY_FILE);
  await Deno.mkdir(dirname(historyPath), { recursive: true });

  const line = JSON.stringify(entry) + "\n";
  const file = await Deno.open(historyPath, { append: true, create: true, write: true });
  try {
    await file.write(new TextEncoder().encode(line));
  } finally {
    file.close();
  }
}
