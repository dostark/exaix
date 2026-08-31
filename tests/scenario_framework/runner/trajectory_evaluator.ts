/**
 * @module ScenarioFrameworkTrajectoryEvaluator
 * @path tests/scenario_framework/runner/trajectory_evaluator.ts
 * @description Evaluates tool-call trajectories from the journal against
 * expected sequences for trajectory-assert step type.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/runner/assertions.ts]
 */

import { Database } from "@db/sqlite";
import {
  CriterionKind,
  CriterionPhase,
  CriterionStatus,
  type ICriterionResult,
  type IExpectedSequenceEntry,
} from "../schema/step_schema.ts";
import { ACTIVITY_EVENT_DYNAMIC_TOOL_CALL } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

export interface IExpectedTrajectory {
  expectedSequence: IExpectedSequenceEntry[];
  orderMatters: boolean;
  allowExtraTools: boolean;
  partialCredit: boolean;
}

export interface ITrajectoryResult {
  matchedCount: number;
  unmatchedCount: number;
  extraCount: number;
  sequence: string[];
}

export interface IToolCall {
  tool: string;
  args: Record<string, JSONValue>;
}

export interface ITrajectoryCaptureResult {
  sequence: string[];
  toolCalls: IToolCall[];
  matchedCount: number;
  error?: boolean;
}

export interface IMatchArgsOptions {
  minArgs?: number;
  maxArgs?: number;
}

const SENSITIVE_KEYS = new Set(["password", "token", "api_key", "secret", "auth", "credential", "private_key"]);

const ARGS_DISPLAY_MAX_LENGTH = 200;

export function captureToolCallsFromJournal(
  dbPath: string,
  opts: { sinceRowid: number; untilRowid: number },
): ITrajectoryCaptureResult {
  try {
    const db = new Database(dbPath);
    const rows = db.prepare<{ tool: string; args: string }>(
      `SELECT json_extract(payload, '$.tool') AS tool,
              json_extract(payload, '$.args') AS args
       FROM activity
       WHERE action_type = ?
         AND rowid > ? AND rowid <= ?
       ORDER BY rowid ASC`,
    ).all(ACTIVITY_EVENT_DYNAMIC_TOOL_CALL, opts.sinceRowid, opts.untilRowid);
    db.close();

    const toolCalls: IToolCall[] = [];
    const sequence: string[] = [];

    for (const row of rows) {
      if (typeof row.tool !== "string") continue;
      let args: Record<string, JSONValue> = {};
      if (typeof row.args === "object" && row.args !== null) {
        args = row.args as Record<string, JSONValue>;
      } else if (typeof row.args === "string") {
        try {
          args = JSON.parse(row.args) as Record<string, JSONValue>;
        } catch {
          args = {};
        }
      }
      toolCalls.push({ tool: row.tool, args });
      sequence.push(row.tool);
    }

    return { sequence, toolCalls, matchedCount: toolCalls.length };
  } catch {
    return { sequence: [], toolCalls: [], matchedCount: 0, error: true };
  }
}

/**
 * Matches a single tool call's args against expected constraints.
 */
export function matchToolCallArgs(
  call: IToolCall,
  argsContains: string[],
  opts?: Opt<IMatchArgsOptions, Reason.OptionalInput>,
): { passed: boolean; message?: string } {
  const args = call.args;
  const argCount = Object.keys(args).length;

  if (opts?.minArgs !== undefined && argCount < opts.minArgs) {
    return { passed: false, message: `min_args ${opts.minArgs} not met: got ${argCount} args` };
  }
  if (opts?.maxArgs !== undefined && argCount > opts.maxArgs) {
    return { passed: false, message: `max_args ${opts.maxArgs} exceeded: got ${argCount} args` };
  }

  for (const substring of argsContains) {
    const found = Object.values(args).some((v) => {
      if (typeof v === "string") return v.includes(substring);
      return JSON.stringify(v).includes(substring);
    });
    if (!found) {
      return { passed: false, message: `args_contains "${substring}" not found in args` };
    }
  }

  return { passed: true };
}

/**
 * Redacts args for display: truncates long values and masks sensitive keys.
 */
export function redactArgs(args: Record<string, JSONValue>): string {
  const redacted: Record<string, JSONValue> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_KEYS.has(key)) {
      redacted[key] = "***";
      continue;
    }
    if (typeof value === "string" && value.length > ARGS_DISPLAY_MAX_LENGTH) {
      redacted[key] = value.slice(0, ARGS_DISPLAY_MAX_LENGTH) + "...";
    } else if (typeof value === "object" && value !== null) {
      const str = JSON.stringify(value);
      redacted[key] = str.length > ARGS_DISPLAY_MAX_LENGTH ? str.slice(0, ARGS_DISPLAY_MAX_LENGTH) + "..." : str;
    } else {
      redacted[key] = value;
    }
  }
  return JSON.stringify(redacted);
}

export function scoreTrajectory(
  observed: ITrajectoryResult,
  expected: IExpectedTrajectory,
): ICriterionResult[] {
  const results: ICriterionResult[] = [];

  const { matched, unmatched, score } = matchTrajectory(observed, expected);

  results.push({
    criterion_id: "trajectory-sequence",
    kind: CriterionKind.TRAJECTORY,
    phase: CriterionPhase.OUTPUT,
    status: score >= 1.0 ? CriterionStatus.PASSED : CriterionStatus.FAILED,
    message: `trajectory: matched ${matched}/${matched + unmatched} expected tools (score: ${score.toFixed(2)})`,
    score,
    evidence_refs: [],
    observed_value: observed.sequence,
    expected_value: expectedToolNames(expected),
  });

  if (observed.extraCount > 0 && !expected.allowExtraTools) {
    results.push({
      criterion_id: "trajectory-extra-tools",
      kind: CriterionKind.TRAJECTORY,
      phase: CriterionPhase.OUTPUT,
      status: CriterionStatus.FAILED,
      message: `trajectory: ${observed.extraCount} unexpected tool calls`,
      score: 0,
      evidence_refs: [],
      observed_value: observed.extraCount,
      expected_value: 0,
    });
  }

  return results;
}

/**
 * Levenshtein distance for trajectory comparison (capped to avoid perf issues on long sequences).
 */
export function levenshteinTrajectory(a: string[], b: string[]): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  if (maxLen > 50) {
    return Math.abs(a.length - b.length);
  }

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Internal helpers

function expectedToolNames(expected: IExpectedTrajectory): string[] {
  return expected.expectedSequence.map((e) => e.tool);
}

function matchTrajectory(
  observed: ITrajectoryResult,
  expected: IExpectedTrajectory,
): { matched: number; unmatched: number; score: number } {
  const actual = observed.sequence;
  const expectedSeq = expectedToolNames(expected);

  if (expected.expectedSequence.length === 0) {
    return { matched: 0, unmatched: 0, score: 1.0 };
  }

  if (expected.orderMatters) {
    const distance = levenshteinTrajectory(expectedSeq, actual);
    const maxLen = Math.max(expectedSeq.length, actual.length);
    const score = maxLen > 0 ? 1 - (distance / maxLen) : 1.0;

    if (expected.partialCredit === false) {
      return distance === 0
        ? { matched: expectedSeq.length, unmatched: 0, score: 1.0 }
        : { matched: 0, unmatched: expectedSeq.length, score: 0.0 };
    }

    return {
      matched: expectedSeq.length - Math.min(distance, expectedSeq.length),
      unmatched: Math.min(distance, expectedSeq.length),
      score: Math.max(0, score),
    };
  }

  // Order doesn't matter: multiset comparison
  const actualSet = new Set(expected.allowExtraTools ? actual : actual.slice(0, expectedSeq.length));
  const expectedSet = new Set(expectedSeq);

  let matched = 0;
  for (const tool of expectedSet) {
    if (actualSet.has(tool)) matched++;
  }

  const unmatched = expectedSet.size - matched;
  const score = expectedSet.size > 0 ? matched / expectedSet.size : 1.0;

  if (expected.partialCredit === false) {
    return matched === expectedSet.size ? { matched, unmatched: 0, score: 1.0 } : { matched, unmatched, score: 0.0 };
  }

  return { matched, unmatched, score: Math.max(0, score) };
}
