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

import { type ICriterionResult, type IScenarioStep, ScenarioStepType } from "../schema/step_schema.ts";
import { globToRegExp, join, relative, resolve } from "@std/path";
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
   * Criterion results populated by trajectory-assert steps (and potentially
   * other non-shell step types) for direct forwarding into evaluateStepOutcome.
   */
  criterionResults?: ICriterionResult[];
}

const TEXT_DECODER = new TextDecoder();
const WHITESPACE_PATTERN = /\s+/;
const WAIT_FOR_FILE_POLL_INTERVAL_MS = 2000; // Check every 2 seconds

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

  if (options.verbose) {
    console.log(`\n%c > ${commandSpec.executable} ${commandSpec.args.join(" ")}`, "color: green; font-weight: bold;");
  }

  const output = await new Deno.Command(commandSpec.executable, {
    args: commandSpec.args,
    cwd: options.cwd,
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
  const workspaceRoot = options.cwd || Deno.cwd();
  const timeoutMs = timeoutSec * 1000;

  const pattern = globToRegExp(pathPattern);
  const failurePattern = failureGlob ? globToRegExp(failureGlob) : undefined;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Search for matching files
    const found = await findMatchingFiles(workspaceRoot, pattern, options.artifactBaselineMs);

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
      const failureFound = await findMatchingFiles(workspaceRoot, failurePattern);
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
