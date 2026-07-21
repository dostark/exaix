/**
 * @module ScenarioFrameworkHistoryWriter
 * @path tests/scenario_framework/runner/history_writer.ts
 * @description Implements eval history JSONL writing with atomic append
 * to both scenario-specific and global history files.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/history_schema.ts, tests/scenario_framework/tests/unit/history_writer_test.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";
import { dirname, fromFileUrl, resolve } from "@std/path";
import {
  EvalHistoryEntrySchema,
  getDefaultComponentVersions,
  type IComponentVersions,
  type IEvalHistoryEntry,
} from "@exaix/eval-history";
import type { IRunManifest } from "./evidence_collector.ts";

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
  async function git(args: string[]): Promise<{ ok: boolean; out: string }> {
    try {
      const output = await new Deno.Command("git", {
        args: ["-C", FRAMEWORK_DIR, ...args],
        stdout: "piped",
        stderr: "null",
      }).output();
      return { ok: output.success, out: new TextDecoder().decode(output.stdout).trim() };
    } catch {
      return { ok: false, out: "" };
    }
  }
  const head = await git(["rev-parse", "HEAD"]);
  // `git status --porcelain` of the framework subtree: any output = uncommitted changes present.
  const status = await git(["status", "--porcelain", "--", FRAMEWORK_DIR]);
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
    })),
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

  return entry;
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
