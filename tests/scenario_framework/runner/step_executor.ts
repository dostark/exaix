/**
 * @module ScenarioFrameworkStepExecutor
 * @path tests/scenario_framework/runner/step_executor.ts
 * @description Executes individual scenario steps for the initial Step 3
 * execution core, capturing stdout, stderr, exit code, timestamps, and
 * combined output for shell and exactl step kinds.
 * Supports wait-for-file steps with polling and timeout.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/config.ts, tests/scenario_framework/tests/unit/scenario_loader_execution_core_test.ts]
 */

import {
  CriterionKind,
  type ICriterion,
  type ICriterionResult,
  type IScenarioStep,
  ScenarioStepType,
} from "../schema/step_schema.ts";
import { copy, ensureDir } from "@std/fs";
import { dirname, globToRegExp, join, relative, resolve } from "@std/path";
import { Database } from "@db/sqlite";
import type { Opt, Reason } from "@exaix/core/types";
import {
  captureToolCallsFromJournal,
  type IExpectedTrajectory,
  type ITrajectoryResult,
  scoreTrajectory,
} from "./trajectory_evaluator.ts";

export interface IExecuteScenarioStepOptions {
  step: IScenarioStep;
  exactlExecutable?: string;
  cwd?: string;
  env?: { [key: string]: string };
  verbose?: boolean;
  /**
   * Epoch-ms floor for artefacts this scenario may claim as its own. Scenarios in a pack
   * run share one sandbox workspace, so `**\/*_plan.md` also matches every plan an earlier
   * scenario produced — a `wait-for-file` step was satisfied INSTANTLY by a stale match and
   * returned before the current request's plan existed. Set to the scenario's start time,
   * this rejects prior scenarios' artefacts the same way the daemon-ready wait rejects
   * stale journal events via a `sinceRowid` baseline. Omit to accept any match.
   */
  artifactBaselineMs?: number;
  /**
   * Journal rowid floor for a `wait-for-journal-event` barrier: only events above it count.
   *
   * The step used to capture this itself, at the moment the wait began — which cannot see an
   * event the PRECEDING step already produced. `exactl daemon start` now blocks until
   * `daemon.ready` is journalled, so every `wait-for-daemon-ready` barrier placed after it
   * (30 scenarios) sat above that row and waited out its timeout for a second `daemon.ready`
   * that never comes. Pass the rowid the runner captured before the producing step ran.
   * Omit to fall back to capturing at wait-start.
   */
  journalBaselineRowid?: number;
}

export interface IScenarioStepExecutionResult {
  stepId: string;
  stepType: IScenarioStep["type"];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  /**
   * True when this step's own input/output criteria did not all pass, independent of
   * exitCode. Distinguishes "the process ran fine but the assertions failed" from an
   * execution failure — the mode engine (modes.ts) continues running subsequent steps
   * (so cleanup steps like `daemon stop` still execute) but reports the scenario's
   * final outcome as scenario-failure if this was ever true for any step.
   */
  criteriaFailed?: boolean;
  /**
   * True when the step failed at the EXECUTION stage, stated explicitly rather than inferred.
   *
   * `toModeExecutionResult` used to signal an execution failure by normalising `exitCode` to 1,
   * and `modes.ts` re-derived the verdict from that exit code through `expect_failure` semantics —
   * where a non-zero exit means *the expected failure happened*. On an `expect_failure` step the
   * two readings are exact opposites, so a step that failed because its command unexpectedly
   * SUCCEEDED was reported as the refusal the scenario asked for, and the scenario finished
   * `Outcome: success` at `suite_score: 0.000`.
   *
   * Found by Phase 142 Step 21's first real run of the declared pack mutations: the mcp-client
   * pack reported green while the scenario under it scored zero. Sibling of the Step 10 defect in
   * `evaluateStepOutcome`, and fixed the same way — say what happened instead of encoding it in a
   * value whose meaning depends on the reader.
   */
  executionFailed?: boolean;
  /**
   * Criterion results populated by trajectory-assert steps (and potentially
   * other non-shell step types) for direct forwarding into evaluateStepOutcome.
   */
  criterionResults?: ICriterionResult[];
}

const TEXT_DECODER = new TextDecoder();
const WHITESPACE_PATTERN = /\s+/;
const WAIT_FOR_FILE_POLL_INTERVAL_MS = 2000; // Check every 2 seconds

/** The cwd token that resolves to the scenario's newest execution worktree. */
export const CWD_WORKTREE_TOKEN = "$WORKTREE";

/** Substitute runtime-only variables into a command spec: `$TRACE_ID` → the current request's
 *  full trace, `$REQUEST_ID` → `request-<trace[0:8]>` (the review/plan approve key). Resolved at
 *  step-execution time (the trace does not exist at scenario load). */
function substituteRuntimeVars(
  spec: ICommandSpec,
  workspaceRoot: string,
  baselineRowid?: Opt<number, Reason.OptionalInput>,
): ICommandSpec {
  const traceId = resolveCurrentTrace(workspaceRoot, baselineRowid);
  if (!traceId) return spec;
  const vars: Record<string, string> = {
    TRACE_ID: traceId,
    REQUEST_ID: `request-${traceId.slice(0, 8)}`,
  };
  const apply = (value: string): string => value.replace(/\$([A-Z][A-Z0-9_]*)/g, (match, name) => vars[name] ?? match);
  return {
    executable: apply(spec.executable),
    args: spec.args.map(apply),
  };
}

/** Resolve a step's declared working directory: omitted → workspace root, a relative path →
 *  workspace-relative, `$WORKTREE` → the newest execution worktree (baseline-aware). */
export async function resolveExecutionBase(
  step: { cwd?: string },
  workspaceRoot: string,
  baselineMs?: Opt<number, Reason.OptionalInput>,
): Promise<string> {
  if (!step.cwd) return workspaceRoot;
  if (step.cwd === CWD_WORKTREE_TOKEN) {
    const worktree = await resolveNewestWorktree(workspaceRoot, baselineMs);
    return worktree ?? workspaceRoot;
  }
  return resolve(workspaceRoot, step.cwd);
}

/** The newest worktree directory under `.exa/worktrees/<alias>/<trace>` (baseline-aware), or
 *  undefined when none exists. */
async function resolveNewestWorktree(
  workspaceRoot: string,
  baselineMs?: Opt<number, Reason.OptionalInput>,
): Promise<string | undefined> {
  const worktreesRoot = join(workspaceRoot, ".exa", "worktrees");
  let best: { path: string; mtime: number } | undefined;
  try {
    for await (const alias of Deno.readDir(worktreesRoot)) {
      if (!alias.isDirectory) continue;
      for await (const trace of Deno.readDir(join(worktreesRoot, alias.name))) {
        if (!trace.isDirectory) continue;
        const worktreePath = join(worktreesRoot, alias.name, trace.name);
        const mtime = (await Deno.stat(worktreePath).catch(() => null))?.mtime?.getTime() ?? 0;
        if (baselineMs !== undefined && mtime < baselineMs) continue;
        if (!best || mtime > best.mtime) best = { path: worktreePath, mtime };
      }
    }
  } catch {
    // No worktrees yet — fall back to the workspace root by returning undefined.
  }
  return best?.path;
}

export async function executeScenarioStep(
  options: IExecuteScenarioStepOptions,
): Promise<IScenarioStepExecutionResult> {
  const startedAtEpochMs = Date.now();
  const startedAt = new Date(startedAtEpochMs).toISOString();

  // Handle wait-for-file step type with polling
  if (options.step.type === ScenarioStepType.WAIT_FOR_FILE) {
    return await executeWaitForFileStep(options, startedAt, startedAtEpochMs);
  }

  // Handle wait-for-journal-event — a readiness barrier that polls the workspace journal
  if (options.step.type === ScenarioStepType.WAIT_FOR_JOURNAL_EVENT) {
    return await executeWaitForJournalEventStep(options, startedAt, startedAtEpochMs);
  }

  // Handle file-contains — wait (poll) until the step's glob(s) resolve to at least `min_matches`
  // files AND the resolved target's content satisfies the step's text criteria, then let
  // evaluateStepOutcome assert the file/text criteria declaratively.
  if (options.step.type === ScenarioStepType.FILE_CONTAINS) {
    return await executeFileContainsStep(options, startedAt, startedAtEpochMs);
  }

  // Handle journal-assert — run a declarative SQL assertion against the workspace journal
  // (native @db/sqlite, trace-scoped via $TRACE_ID). The query must return a row when the
  // assertion holds; a row → exit 0, no row → exit 1.
  if (options.step.type === ScenarioStepType.JOURNAL_ASSERT) {
    return await executeJournalAssertStep(options, startedAt, startedAtEpochMs);
  }

  // Handle patch-blueprint — add capabilities to a sandboxed blueprint's frontmatter.
  if (options.step.type === ScenarioStepType.PATCH_BLUEPRINT) {
    return await executePatchBlueprintStep(options, startedAt, startedAtEpochMs);
  }

  // Handle prepare-evidence — copy a cwd-relative source file to a workspace evidence target.
  if (options.step.type === ScenarioStepType.PREPARE_EVIDENCE) {
    return await executePrepareEvidenceStep(options, startedAt, startedAtEpochMs);
  }

  // Handle write-file — write a content string to a workspace-relative path.
  if (options.step.type === ScenarioStepType.WRITE_FILE) {
    return await executeWriteFileStep(options, startedAt, startedAtEpochMs);
  }

  // Handle remove-files — remove workspace files matching a glob (sandbox cleanup).
  if (options.step.type === ScenarioStepType.REMOVE_FILES) {
    return await executeRemoveFilesStep(options, startedAt, startedAtEpochMs);
  }

  // Handle trajectory-assert — reads journal directly via SQLite instead of executing a command
  if (options.step.type === ScenarioStepType.TRAJECTORY_ASSERT) {
    const dbPath = join(options.cwd ?? Deno.cwd(), ".exa", "journal.db");
    const sinceRowid = options.step.source_step_rowid_start ?? 0;
    const untilRowid = options.step.source_step_rowid_end ?? 0;
    const capture = captureToolCallsFromJournal(dbPath, { sinceRowid, untilRowid });

    const trajectoryObserved: ITrajectoryResult = {
      matchedCount: capture.matchedCount,
      unmatchedCount: 0,
      extraCount: 0,
      sequence: capture.sequence,
    };

    const trajectoryExpected: IExpectedTrajectory = {
      expectedSequence: options.step.expected_sequence ?? [],
      orderMatters: options.step.order_matters ?? true,
      allowExtraTools: options.step.allow_extra_tools ?? false,
      partialCredit: options.step.partial_credit ?? true,
    };

    const results = scoreTrajectory(trajectoryObserved, trajectoryExpected);
    const allPassed = results.every((r) => r.status === "passed");
    const stdout = results.map((r) => r.message).join("\n");

    const completedAtEpochMs = Date.now();
    const completedAt = new Date(completedAtEpochMs).toISOString();

    return {
      stepId: options.step.id,
      stepType: options.step.type,
      startedAt,
      completedAt,
      durationMs: completedAtEpochMs - startedAtEpochMs,
      exitCode: allPassed ? 0 : 1,
      stdout,
      stderr: "",
      combinedOutput: stdout,
      criterionResults: results,
    };
  }

  const commandSpec = buildCommandSpec(options);
  const executionBase = await resolveExecutionBase(options.step, options.cwd || Deno.cwd(), options.artifactBaselineMs);
  const resolved = substituteRuntimeVars(commandSpec, options.cwd || Deno.cwd(), options.journalBaselineRowid);

  if (options.verbose) {
    console.log(`\n%c > ${resolved.executable} ${resolved.args.join(" ")}`, "color: green; font-weight: bold;");
  }

  const output = await new Deno.Command(resolved.executable, {
    args: resolved.args,
    cwd: executionBase,
    env: options.env,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();

  const completedAtEpochMs = Date.now();
  const completedAt = new Date(completedAtEpochMs).toISOString();
  const stdout = TEXT_DECODER.decode(output.stdout);
  const stderr = TEXT_DECODER.decode(output.stderr);

  return {
    stepId: options.step.id,
    stepType: options.step.type,
    startedAt,
    completedAt,
    durationMs: completedAtEpochMs - startedAtEpochMs,
    exitCode: output.code,
    stdout,
    stderr,
    combinedOutput: `${stdout}${stderr}`,
  };
}

async function executeWaitForFileStep(
  options: IExecuteScenarioStepOptions,
  startedAt: string,
  startedAtEpochMs: number,
): Promise<IScenarioStepExecutionResult> {
  const timeoutSec = options.step.timeout_sec ?? 120; // Default 2 minutes
  const pathPattern = options.step.args?.[0] || "**/*_analysis.json";
  const failureGlob = options.step.failure_glob;
  const executionBase = await resolveExecutionBase(options.step, options.cwd || Deno.cwd(), options.artifactBaselineMs);
  const timeoutMs = timeoutSec * 1000;

  const pattern = globToRegExp(pathPattern);
  const failurePattern = failureGlob ? globToRegExp(failureGlob) : undefined;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Search for matching files
    const found = await findMatchingFiles(executionBase, pattern, options.artifactBaselineMs);

    if (found.length > 0) {
      const completedAtEpochMs = Date.now();
      const completedAt = new Date(completedAtEpochMs).toISOString();

      if (options.verbose) {
        console.log(
          `\n%c > File found after ${completedAtEpochMs - startedAtEpochMs}ms: ${found[0]}`,
          "color: green; font-weight: bold;",
        );
      }

      return {
        stepId: options.step.id,
        stepType: options.step.type,
        startedAt,
        completedAt,
        durationMs: completedAtEpochMs - startedAtEpochMs,
        exitCode: 0,
        stdout: `File found: ${found[0]}`,
        stderr: "",
        combinedOutput: `File found: ${found[0]}`,
      };
    }

    // A failure_glob match means the outcome we're waiting for can never happen (e.g. the
    // request that would have produced a plan was already rejected) — fail immediately
    // instead of burning the rest of timeout_sec, and surface the failure file's content
    // so the real error (not a generic timeout) reaches the scenario's failure details.
    if (failurePattern) {
      const failureFound = await findMatchingFiles(executionBase, failurePattern);
      if (failureFound.length > 0) {
        const completedAtEpochMs = Date.now();
        const completedAt = new Date(completedAtEpochMs).toISOString();
        const failureContent = await Deno.readTextFile(failureFound[0]).catch(() => "");
        const message = `Failure file matched ${failureGlob}: ${failureFound[0]}\n${failureContent}`;

        if (options.verbose) {
          console.log(`\n%c > ${message}`, "color: red; font-weight: bold;");
        }

        return {
          stepId: options.step.id,
          stepType: options.step.type,
          startedAt,
          completedAt,
          durationMs: completedAtEpochMs - startedAtEpochMs,
          exitCode: 1,
          stdout: "",
          stderr: message,
          combinedOutput: message,
        };
      }
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_FILE_POLL_INTERVAL_MS));
  }

  // Timeout reached
  const completedAtEpochMs = Date.now();
  const completedAt = new Date(completedAtEpochMs).toISOString();

  if (options.verbose) {
    console.log(`\n%c > Timeout after ${timeoutMs}ms waiting for: ${pathPattern}`, "color: red; font-weight: bold;");
  }

  return {
    stepId: options.step.id,
    stepType: options.step.type,
    startedAt,
    completedAt,
    durationMs: completedAtEpochMs - startedAtEpochMs,
    exitCode: 1,
    stdout: "",
    stderr: `Timeout after ${timeoutSec}s waiting for file matching: ${pathPattern}`,
    combinedOutput: `Timeout after ${timeoutSec}s waiting for file matching: ${pathPattern}`,
  };
}

/** The text patterns a `file-contains` step's output criteria require in the resolved file. */
interface IFileContentExpectation {
  contains: string[];
  matches: RegExp[];
}

/** Collect the positive content expectations (text-contains/text-matches) from a step's criteria. */
function collectFileContentExpectations(criteria: ICriterion[]): IFileContentExpectation {
  const expectation: IFileContentExpectation = { contains: [], matches: [] };
  for (const criterion of criteria ?? []) {
    if (criterion.kind === CriterionKind.TEXT_CONTAINS) {
      const value = (criterion as { contains?: string }).contains;
      if (value) expectation.contains.push(value);
    }
    if (criterion.kind === CriterionKind.TEXT_MATCHES) {
      const values = (criterion as { matches?: string[] }).matches;
      for (const pattern of values ?? []) expectation.matches.push(new RegExp(pattern));
    }
  }
  return expectation;
}

/** The file the content expectation is judged against: the newest of the matched files. */
async function newestMatchingFile(matches: string[]): Promise<Opt<string, Reason.OptionalInput>> {
  let best: { path: string; mtime: number } | undefined;
  for (const file of matches) {
    const mtime = (await Deno.stat(file).catch(() => null))?.mtime?.getTime() ?? 0;
    if (!best || mtime > best.mtime) best = { path: file, mtime };
  }
  return best?.path;
}

/** True when the resolved file's content satisfies every expected pattern. */
async function fileSatisfiesExpectation(
  file: Opt<string, Reason.OptionalInput>,
  expectation: IFileContentExpectation,
): Promise<boolean> {
  if (expectation.contains.length === 0 && expectation.matches.length === 0) return true;
  if (!file) return false;
  const content = await Deno.readTextFile(file).catch(() => "");
  return expectation.contains.every((pattern) => content.includes(pattern)) &&
    expectation.matches.every((regex) => regex.test(content));
}

/** A `file-contains` step: wait until the glob(s) resolve to ≥ `min_matches` files whose
 *  content (when the output criteria demand it) satisfies the expected patterns. A criterion
 *  of `file-not-exists` is a negative assertion — no wait, evaluated immediately. */
async function executeFileContainsStep(
  options: IExecuteScenarioStepOptions,
  startedAt: string,
  startedAtEpochMs: number,
): Promise<IScenarioStepExecutionResult> {
  const timeoutSec = options.step.timeout_sec ?? 120;
  const executionBase = await resolveExecutionBase(options.step, options.cwd || Deno.cwd(), options.artifactBaselineMs);
  const timeoutMs = timeoutSec * 1000;
  const startTime = Date.now();

  const globs = [
    ...(options.step.file_pattern ? [options.step.file_pattern] : []),
    ...(options.step.args ?? []),
  ].filter((glob) => glob.length > 0);
  const minMatches = options.step.min_matches ?? 1;
  const expectations = collectFileContentExpectations(options.step.output_criteria);
  const negativeAssertion = (options.step.output_criteria ?? []).some((c) => c.kind === CriterionKind.FILE_NOT_EXISTS);

  // A negative assertion (file-not-exists) is evaluated immediately — the file must NEVER
  // appear, so there is nothing to wait for.
  if (negativeAssertion) {
    const completedAtEpochMs = Date.now();
    const completedAt = new Date(completedAtEpochMs).toISOString();
    return {
      stepId: options.step.id,
      stepType: options.step.type,
      startedAt,
      completedAt,
      durationMs: completedAtEpochMs - startedAtEpochMs,
      exitCode: 0,
      stdout: "Negative assertion evaluated immediately",
      stderr: "",
      combinedOutput: "Negative assertion evaluated immediately",
    };
  }

  while (Date.now() - startTime < timeoutMs) {
    const matches: string[] = [];
    for (const glob of globs) {
      const found = await findMatchingFiles(executionBase, globToRegExp(glob), options.artifactBaselineMs);
      for (const file of found) {
        if (!matches.includes(file)) matches.push(file);
      }
    }

    const target = await newestMatchingFile(matches);
    const contentReady = await fileSatisfiesExpectation(target, expectations);

    if (matches.length >= minMatches && (negativeAssertion || contentReady)) {
      const completedAtEpochMs = Date.now();
      const completedAt = new Date(completedAtEpochMs).toISOString();
      const message = `File(s) ready: ${matches.join(", ")}`;
      if (options.verbose) {
        console.log(`\n%c > ${message}`, "color: green; font-weight: bold;");
      }
      return {
        stepId: options.step.id,
        stepType: options.step.type,
        startedAt,
        completedAt,
        durationMs: completedAtEpochMs - startedAtEpochMs,
        exitCode: 0,
        stdout: message,
        stderr: "",
        combinedOutput: message,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_FILE_POLL_INTERVAL_MS));
  }

  const completedAtEpochMs = Date.now();
  const completedAt = new Date(completedAtEpochMs).toISOString();
  const message = `Timeout after ${timeoutSec}s waiting for ${globs.join(" or ")} ` +
    `(${minMatches}+ files${
      expectations.contains.length || expectations.matches.length ? " with matching content" : ""
    })`;
  if (options.verbose) {
    console.log(`\n%c > ${message}`, "color: red; font-weight: bold;");
  }
  return {
    stepId: options.step.id,
    stepType: options.step.type,
    startedAt,
    completedAt,
    durationMs: completedAtEpochMs - startedAtEpochMs,
    exitCode: 1,
    stdout: "",
    stderr: message,
    combinedOutput: message,
  };
}

/**
 * True once the workspace journal (`<workspaceRoot>/.exa/journal.db`) holds an `activity` row
 * with the given `action_type` **and a rowid greater than `sinceRowid`**. The poll predicate for
 * `wait-for-journal-event`. The `sinceRowid` baseline lets a wait ignore events that already
 * existed when it began — e.g. a stale `daemon.ready` from the daemon that a restart just killed,
 * so the barrier waits for the NEW daemon's readiness, not the old one's leftover. Pass 0 (default)
 * to match any event of the type. Tolerant: a missing DB, a fresh DB without the `activity` table,
 * or any read error counts as "not yet" (false), never an exception.
 */
export async function journalHasEvent(
  workspaceRoot: string,
  eventType: string,
  sinceRowid = 0,
): Promise<boolean> {
  const dbPath = join(workspaceRoot, ".exa", "journal.db");
  try {
    await Deno.stat(dbPath);
  } catch {
    return false; // journal not created yet
  }
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare("SELECT 1 FROM activity WHERE action_type = ? AND rowid > ? LIMIT 1")
      .get(eventType, sinceRowid);
    return row !== undefined;
  } catch {
    return false; // no activity table yet / locked / unreadable — treat as not-ready
  } finally {
    db?.close();
  }
}

/**
 * The current highest `rowid` in the workspace journal — the baseline a `wait-for-journal-event`
 * captures before polling, so it only counts events that arrive AFTER the wait starts. Returns 0
 * for a missing/empty/uninitialized journal (so the first event always counts as "after").
 */
export async function currentMaxRowid(workspaceRoot: string): Promise<number> {
  const dbPath = join(workspaceRoot, ".exa", "journal.db");
  try {
    await Deno.stat(dbPath);
  } catch {
    return 0;
  }
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number | null }>();
    return row?.m ?? 0;
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

const DEFAULT_WAIT_FOR_JOURNAL_TIMEOUT_SEC = 30;

/**
 * Readiness barrier: poll the workspace journal until `step.event_type` appears (or timeout).
 * Used after `daemon restart` to wait for `watcher.started` — the daemon's file-watch is active
 * only once that event is journalled, so submitting a request before it would race the watcher.
 */
async function executeWaitForJournalEventStep(
  options: IExecuteScenarioStepOptions,
  startedAt: string,
  startedAtEpochMs: number,
): Promise<IScenarioStepExecutionResult> {
  const eventType = options.step.event_type;
  const timeoutSec = options.step.timeout_sec ?? DEFAULT_WAIT_FOR_JOURNAL_TIMEOUT_SEC;
  const workspaceRoot = options.cwd ?? Deno.cwd();
  const timeoutMs = timeoutSec * 1000;
  const startTime = Date.now();

  // Baseline: only events above this rowid count, which makes the barrier ignore a stale
  // `daemon.ready` left by a daemon a prior `restart` step already killed. It comes from the
  // runner, captured BEFORE the producing step ran — capturing it here instead would sit above
  // the event the immediately preceding step just produced and could never be satisfied.
  const sinceRowid = options.journalBaselineRowid ?? await currentMaxRowid(workspaceRoot);

  if (!eventType) {
    const completedAtEpochMs = Date.now();
    const message = "wait-for-journal-event requires `event_type`";
    return {
      stepId: options.step.id,
      stepType: options.step.type,
      startedAt,
      completedAt: new Date(completedAtEpochMs).toISOString(),
      durationMs: completedAtEpochMs - startedAtEpochMs,
      exitCode: 1,
      stdout: "",
      stderr: message,
      combinedOutput: message,
    };
  }

  while (Date.now() - startTime < timeoutMs) {
    if (await journalHasEvent(workspaceRoot, eventType, sinceRowid)) {
      const completedAtEpochMs = Date.now();
      if (options.verbose) {
        console.log(
          `\n%c > Journal event '${eventType}' (rowid > ${sinceRowid}) seen after ${
            completedAtEpochMs - startedAtEpochMs
          }ms`,
          "color: green; font-weight: bold;",
        );
      }
      const msg = `Journal event present: ${eventType}`;
      return {
        stepId: options.step.id,
        stepType: options.step.type,
        startedAt,
        completedAt: new Date(completedAtEpochMs).toISOString(),
        durationMs: completedAtEpochMs - startedAtEpochMs,
        exitCode: 0,
        stdout: msg,
        stderr: "",
        combinedOutput: msg,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_FILE_POLL_INTERVAL_MS));
  }

  const completedAtEpochMs = Date.now();
  const message = `Timeout after ${timeoutSec}s waiting for journal event: ${eventType}`;
  return {
    stepId: options.step.id,
    stepType: options.step.type,
    startedAt,
    completedAt: new Date(completedAtEpochMs).toISOString(),
    durationMs: completedAtEpochMs - startedAtEpochMs,
    exitCode: 1,
    stdout: "",
    stderr: message,
    combinedOutput: message,
  };
}

/**
 * True when `path` was last modified at or after `baselineMs` — i.e. it belongs to the
 * current scenario rather than an earlier one sharing the workspace. No baseline means
 * every match is acceptable (single-scenario runs, and callers that do not correlate).
 */
async function isAtOrAfterBaseline(
  path: string,
  baselineMs?: Opt<number, Reason.OptionalInput>,
): Promise<boolean> {
  if (baselineMs === undefined) return true;
  try {
    const modified = (await Deno.stat(path)).mtime?.getTime();
    return modified === undefined ? false : modified >= baselineMs;
  } catch {
    return false;
  }
}

async function findMatchingFiles(
  root: string,
  pattern: RegExp,
  baselineMs?: Opt<number, Reason.OptionalInput>,
): Promise<string[]> {
  const matches: string[] = [];
  const workspaceRoot = root;

  try {
    for await (const entry of Deno.readDir(root)) {
      await checkEntry(entry, root, pattern, matches, workspaceRoot, baselineMs);
    }
  } catch {
    // Directory not accessible
  }

  return matches;
}

async function checkEntry(
  entry: Deno.DirEntry,
  basePath: string,
  pattern: RegExp,
  matches: string[],
  workspaceRoot: string,
  baselineMs?: Opt<number, Reason.OptionalInput>,
): Promise<void> {
  const fullPath = resolve(basePath, entry.name);
  const relPath = relative(workspaceRoot, fullPath);

  if (entry.isFile && (pattern.test(entry.name) || pattern.test(relPath))) {
    if (await isAtOrAfterBaseline(fullPath, baselineMs)) {
      matches.push(fullPath);
    }
    return;
  }

  if (entry.isDirectory && !entry.name.startsWith(".")) {
    try {
      for await (const subEntry of Deno.readDir(fullPath)) {
        await checkEntry(subEntry, fullPath, pattern, matches, workspaceRoot, baselineMs);
      }
    } catch {
      // Directory not accessible
    }
  }
}

interface ICommandSpec {
  executable: string;
  args: string[];
}

/** Resolve the current scenario's request trace: the first `request.created` rowid above the
 *  scenario's journal baseline. ASC+LIMIT 1 is deterministic (rowid is monotonic and ties never
 *  occur — two request.created rows CAN share a millisecond), and the baseline rejects an
 *  earlier scenario's request in a shared sandbox. */
function resolveCurrentTrace(
  workspaceRoot: string,
  baselineRowid?: Opt<number, Reason.OptionalInput>,
): string | undefined {
  const dbPath = join(workspaceRoot, ".exa", "journal.db");
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    const where = baselineRowid ? " AND rowid > ?" : "";
    const row = db
      .prepare(
        `SELECT trace_id FROM activity WHERE action_type = 'request.created'${where} ORDER BY rowid ASC LIMIT 1`,
      )
      .get<{ trace_id: string }>(baselineRowid);
    return row?.trace_id;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

/** A `patch-blueprint` step: add capabilities to a sandboxed blueprint's frontmatter. */
async function executePatchBlueprintStep(
  options: IExecuteScenarioStepOptions,
  startedAt: string,
  startedAtEpochMs: number,
): Promise<IScenarioStepExecutionResult> {
  const blueprint = options.step.blueprint ?? options.step.args?.[0] ?? "";
  const capabilities = options.step.add_capabilities ?? [];
  const workspaceRoot = options.cwd || Deno.cwd();
  const blueprintPath = join(workspaceRoot, "Blueprints", "Identities", `${blueprint}.md`);
  let message = "";
  let ok = false;
  try {
    const text = await Deno.readTextFile(blueprintPath);
    const lines = text.split("\n");
    const idx = lines.findIndex((l) => l.startsWith("capabilities:"));
    if (idx !== -1) {
      const raw = lines[idx].slice("capabilities:".length).trim();
      const array = JSON.parse(raw) as string[];
      for (const capability of capabilities) {
        if (!array.includes(capability)) array.push(capability);
      }
      lines[idx] = `capabilities: ${JSON.stringify(array)}`;
      await Deno.writeTextFile(blueprintPath, lines.join("\n"));
      ok = capabilities.every((c) => array.includes(c));
      message = `patched ${blueprint}: ${capabilities.join(", ")}`;
    } else {
      message = `no capabilities: line in ${blueprint}.md`;
    }
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  const completedAtEpochMs = Date.now();
  const completedAt = new Date(completedAtEpochMs).toISOString();
  return {
    stepId: options.step.id,
    stepType: options.step.type,
    startedAt,
    completedAt,
    durationMs: completedAtEpochMs - startedAtEpochMs,
    exitCode: ok ? 0 : 1,
    stdout: message,
    stderr: ok ? "" : message,
    combinedOutput: message,
  };
}

/** A `prepare-evidence` step: copy a cwd-relative source file to a workspace evidence target. */
async function executePrepareEvidenceStep(
  options: IExecuteScenarioStepOptions,
  startedAt: string,
  startedAtEpochMs: number,
): Promise<IScenarioStepExecutionResult> {
  const source = options.step.source ?? options.step.args?.[0] ?? "";
  const target = options.step.target ?? "llm-judge-input.txt";
  const workspaceRoot = options.cwd || Deno.cwd();
  const executionBase = await resolveExecutionBase(options.step, workspaceRoot, options.artifactBaselineMs);
  let message = "";
  let ok = false;
  try {
    await copy(join(executionBase, source), join(workspaceRoot, target), { overwrite: true });
    ok = true;
    message = `prepared evidence: ${source} → ${target}`;
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  const completedAtEpochMs = Date.now();
  const completedAt = new Date(completedAtEpochMs).toISOString();
  return {
    stepId: options.step.id,
    stepType: options.step.type,
    startedAt,
    completedAt,
    durationMs: completedAtEpochMs - startedAtEpochMs,
    exitCode: ok ? 0 : 1,
    stdout: message,
    stderr: ok ? "" : message,
    combinedOutput: message,
  };
}

/** A `write-file` step: write a content string to a workspace-relative path (or append). */
async function executeWriteFileStep(
  options: IExecuteScenarioStepOptions,
  startedAt: string,
  startedAtEpochMs: number,
): Promise<IScenarioStepExecutionResult> {
  const relPath = options.step.path ?? options.step.args?.[0] ?? "";
  const workspaceRoot = options.cwd || Deno.cwd();
  const rawContent = options.step.content ?? options.step.args?.[1] ?? "";
  const content = rawContent.replaceAll("$WORKSPACE_ROOT", workspaceRoot);
  let message = "";
  let ok = false;
  try {
    const target = resolve(workspaceRoot, relPath);
    await ensureDir(dirname(target));
    const previous = options.step.append ? await Deno.readTextFile(target).catch(() => "") : "";
    await Deno.writeTextFile(target, previous + content);
    ok = true;
    message = `${options.step.append ? "appended to" : "wrote"} ${relPath}`;
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  const completedAtEpochMs = Date.now();
  const completedAt = new Date(completedAtEpochMs).toISOString();
  return {
    stepId: options.step.id,
    stepType: options.step.type,
    startedAt,
    completedAt,
    durationMs: completedAtEpochMs - startedAtEpochMs,
    exitCode: ok ? 0 : 1,
    stdout: message,
    stderr: ok ? "" : message,
    combinedOutput: message,
  };
}

/** A `remove-files` step: remove workspace files matching the declared glob(s). */
async function executeRemoveFilesStep(
  options: IExecuteScenarioStepOptions,
  startedAt: string,
  startedAtEpochMs: number,
): Promise<IScenarioStepExecutionResult> {
  const globs = options.step.args ?? [];
  const workspaceRoot = options.cwd || Deno.cwd();
  let removed = 0;
  let errorMessage = "";
  try {
    for (const glob of globs) {
      const matches = await findMatchingFiles(workspaceRoot, globToRegExp(glob));
      for (const file of matches) {
        await Deno.remove(file).catch(() => {});
        removed++;
      }
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  const completedAtEpochMs = Date.now();
  const completedAt = new Date(completedAtEpochMs).toISOString();
  const message = `removed ${removed} file(s)${errorMessage ? `: ${errorMessage}` : ""}`;
  return {
    stepId: options.step.id,
    stepType: options.step.type,
    startedAt,
    completedAt,
    durationMs: completedAtEpochMs - startedAtEpochMs,
    exitCode: errorMessage ? 1 : 0,
    stdout: message,
    stderr: errorMessage ? message : "",
    combinedOutput: message,
  };
}

/** A `journal-assert` step: run a DECLARATIVE activity-journal assertion against the workspace
 *  journal — no raw SQL lives in scenario YAML, the framework builds the query from the step's
 *  filter/projection/assertion fields. `trace_scoped` resolves to the current request's trace
 *  (first request.created above the scenario baseline) so the assertion never reads an earlier
 *  scenario's rows in a shared sandbox.
 *
 *  Assertion contract: the step exits 0 when the assertion holds —
 *   - `expect_count`  : matching rows == N (negative assertion, e.g. "no tool calls");
 *   - `expect_sum`    : SUM(payload.<path>) > bound (e.g. "files changed > 0");
 *   - `expect_contains`: every substring appears in the LATEST matching row's payload;
 *   - otherwise       : at least one matching row exists.
 *  The result rows are emitted as JSON on stdout so json-query criteria can score them. */
function executeJournalAssertStep(
  options: IExecuteScenarioStepOptions,
  startedAt: string,
  startedAtEpochMs: number,
): IScenarioStepExecutionResult {
  const workspaceRoot = options.cwd || Deno.cwd();
  const traceId = options.step.trace_scoped
    ? resolveCurrentTrace(workspaceRoot, options.journalBaselineRowid)
    : undefined;

  const where: string[] = [];
  const params: Array<string | number | boolean> = [];
  if (options.step.action_type) {
    where.push("action_type = ?");
    params.push(options.step.action_type);
  }
  if (options.step.action_type_prefix) {
    where.push("action_type LIKE ?");
    params.push(`${options.step.action_type_prefix}%`);
  }
  if (options.step.action_types?.length) {
    where.push(`action_type IN (${options.step.action_types.map(() => "?").join(", ")})`);
    params.push(...options.step.action_types);
  }
  if (traceId) {
    where.push("trace_id = ?");
    params.push(traceId);
  }
  for (const entry of options.step.payload_equals ?? []) {
    where.push(`json_extract(payload, '$.${safeJsonPath(entry.path)}') = ?`);
    params.push(entry.value);
  }
  for (const needle of options.step.payload_contains ?? []) {
    where.push("payload LIKE ?");
    params.push(`%${needle}%`);
  }
  for (const needle of options.step.payload_not_contains ?? []) {
    where.push("payload NOT LIKE ?");
    params.push(`%${needle}%`);
  }
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";

  let matched = false;
  let rowsJson = "[]";
  let errorMessage = "";
  const dbPath = join(workspaceRoot, ".exa", "journal.db");
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    if (options.step.sums && Object.keys(options.step.sums).length) {
      const columns = Object.entries(options.step.sums)
        .map(([column, path]) =>
          `COALESCE(SUM(json_extract(payload, '$.${safeJsonPath(path)}')), 0) AS ${safeColumnName(column)}`
        )
        .join(", ");
      const rows = db.prepare(`SELECT ${columns} FROM activity${whereSql}`).all(...params);
      matched = rows.length > 0;
      rowsJson = JSON.stringify(rows);
    } else if (options.step.expect_count !== undefined) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM activity${whereSql}`).get(...params) as
        | { count: number }
        | undefined;
      const count = row?.count ?? 0;
      matched = count === options.step.expect_count;
      rowsJson = JSON.stringify([{ count }]);
    } else if (options.step.expect_sum) {
      const row = db.prepare(
        `SELECT COALESCE(SUM(json_extract(payload, '$.${
          safeJsonPath(options.step.expect_sum.path)
        }')), 0) AS sum FROM activity${whereSql}`,
      ).get(...params) as { sum: number } | undefined;
      const sum = row?.sum ?? 0;
      matched = sum > options.step.expect_sum.gt;
      rowsJson = JSON.stringify([{ sum }]);
    } else if (options.step.expect_contains?.length) {
      const row = db.prepare(
        `SELECT payload FROM activity${whereSql} ORDER BY rowid DESC LIMIT 1`,
      ).get(...params) as { payload: string } | undefined;
      const payload = row?.payload ?? "";
      matched = options.step.expect_contains.every((needle) => payload.includes(needle));
      rowsJson = JSON.stringify([{ payload }]);
    } else {
      const projection = buildJournalProjection(options.step.project);
      const order = options.step.latest_only ? " ORDER BY rowid DESC LIMIT 1" : " ORDER BY rowid";
      const rows = db.prepare(`SELECT ${projection} FROM activity${whereSql}${order}`).all(...params);
      matched = rows.length > 0;
      rowsJson = JSON.stringify(rows);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    db?.close();
  }

  const completedAtEpochMs = Date.now();
  const completedAt = new Date(completedAtEpochMs).toISOString();
  const message = matched
    ? "Journal assertion held"
    : `Journal assertion failed${errorMessage ? `: ${errorMessage}` : ""}`;
  if (options.verbose) {
    console.log(`\n%c > ${message}`, matched ? "color: green; font-weight: bold;" : "color: red; font-weight: bold;");
  }
  return {
    stepId: options.step.id,
    stepType: options.step.type,
    startedAt,
    completedAt,
    durationMs: completedAtEpochMs - startedAtEpochMs,
    exitCode: matched ? 0 : 1,
    stdout: rowsJson,
    stderr: matched ? "" : `${message}${errorMessage ? `: ${errorMessage}` : ""}`,
    combinedOutput: rowsJson,
  };
}

const JOURNAL_SAFE_PATH_RE = /^[A-Za-z0-9_.-]+$/;
const JOURNAL_SAFE_COLUMN_RE = /^[A-Za-z0-9_]+$/;

/** A journal-assert payload path placed into a json_extract selector must be strictly
 *  alphanumeric/underscore/dot/hyphen — never attacker- or YAML-controllable SQL. */
function safeJsonPath(path: string): string {
  if (!JOURNAL_SAFE_PATH_RE.test(path)) {
    throw new Error(`invalid journal-assert payload path: ${path}`);
  }
  return path;
}

function safeColumnName(column: string): string {
  if (!JOURNAL_SAFE_COLUMN_RE.test(column)) {
    throw new Error(`invalid journal-assert column name: ${column}`);
  }
  return column;
}

/** Build the SELECT list for a journal-assert probe from a `project` map of column name -> value
 *  source ("action_type"/"trace_id"/"rowid", or a "payload.<path>" extraction). Defaults to a
 *  constant row so a bare probe still passes when any row matches. */
function buildJournalProjection(
  project: Opt<Record<string, string>, Reason.OptionalInput> = undefined,
): string {
  if (!project || Object.keys(project).length === 0) {
    return "1 AS matched";
  }
  return Object.entries(project).map(([column, source]) => {
    const name = safeColumnName(column);
    if (source === "action_type") return `action_type AS ${name}`;
    if (source === "trace_id") return `trace_id AS ${name}`;
    if (source === "rowid") return `rowid AS ${name}`;
    if (source.startsWith("payload.")) {
      return `json_extract(payload, '$.${safeJsonPath(source.slice("payload.".length))}') AS ${name}`;
    }
    throw new Error(`invalid journal-assert project source: ${source}`);
  }).join(", ");
}

function buildCommandSpec(options: IExecuteScenarioStepOptions): ICommandSpec {
  if (options.step.type === ScenarioStepType.SHELL) {
    if (!options.step.command) {
      throw new Error(`shell step requires a command: ${options.step.id}`);
    }

    return {
      executable: options.step.command,
      args: options.step.args ?? [],
    };
  }

  // run-script executes a declared framework helper command (e.g. `deno run -A
  // $FRAMEWORK_HOME/scripts/call_mcp_tool.ts <tool> <args>`) — a semantic wrapper over the
  // shell form so helper invocations are not raw procedural shell.
  if (options.step.type === ScenarioStepType.RUN_SCRIPT) {
    if (!options.step.command) {
      throw new Error(`run-script step requires a command: ${options.step.id}`);
    }
    return {
      executable: options.step.command,
      args: options.step.args ?? [],
    };
  }

  // test-run executes the repo's test command in the step's resolved `cwd` (workspace, portal
  // dir, or `$WORKTREE`) — a framework-owned test-runner instead of a `cd ... && deno test`
  // shell step. Defaults to `deno test`.
  if (options.step.type === ScenarioStepType.TEST_RUN) {
    return {
      executable: options.step.command ?? "deno",
      args: options.step.args ?? ["test"],
    };
  }

  if (options.step.type === ScenarioStepType.EXACTL) {
    if (!options.step.command) {
      throw new Error(`exactl step requires a command: ${options.step.id}`);
    }

    return {
      executable: options.exactlExecutable ?? "exactl",
      args: [...tokenizeCommand(options.step.command), ...(options.step.args ?? [])],
    };
  }

  // Virtual success for step types that rely on criteria evaluation only
  return {
    executable: "true",
    args: [],
  };
}

function tokenizeCommand(command: string): string[] {
  return command.split(WHITESPACE_PATTERN).filter((token) => token.length > 0);
}
