/**
 * @module ScenarioFrameworkTrajectoryEvaluator
 * @path tests/scenario_framework/runner/trajectory_evaluator.ts
 * @description Evaluates tool-call trajectories from the journal against
 * expected sequences for trajectory-assert step type.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/runner/assertions.ts]
 */

import {
  CriterionKind,
  CriterionPhase,
  CriterionStatus,
  type ICriterionResult,
  type IExpectedSequenceEntry,
} from "../schema/step_schema.ts";

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

const LEVENSHTEIN_MAX_LENGTH = 50;

/**
 * Captures tool-call trajectory from journal events.
 * Reads journal entries from the CLI or a pre-loaded list of events.
 */
export async function captureTrajectory(options: {
  workspaceRoot: string;
  sourceStep: string;
  exactlExecutable?: string;
}): Promise<ITrajectoryResult> {
  const events = await loadJournal(options);
  return extractToolCalls(events);
}

/**
 * Scores an observed trajectory against an expected sequence.
 * Returns criterion results compatible with ICriterionResult.
 */
export function scoreTrajectory(
  observed: ITrajectoryResult,
  expected: IExpectedTrajectory,
): ICriterionResult[] {
  const results: ICriterionResult[] = [];

  const { matched, unmatched, score } = matchTrajectory(observed, expected);

  results.push({
    criterion_id: "trajectory-sequence",
    kind: CriterionKind.COMMAND_EXIT_CODE,
    phase: CriterionPhase.OUTPUT,
    status: score >= 1.0 ? CriterionStatus.PASSED : CriterionStatus.FAILED,
    message: `trajectory: matched ${matched}/${matched + unmatched} expected tools (score: ${score.toFixed(2)})`,
    evidence_refs: [],
    observed_value: observed.sequence,
    expected_value: expectedToolNames(expected),
  });

  if (observed.extraCount > 0 && !expected.allowExtraTools) {
    results.push({
      criterion_id: "trajectory-extra-tools",
      kind: CriterionKind.COMMAND_EXIT_CODE,
      phase: CriterionPhase.OUTPUT,
      status: CriterionStatus.FAILED,
      message: `trajectory: ${observed.extraCount} unexpected tool calls`,
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
  if (maxLen > LEVENSHTEIN_MAX_LENGTH) {
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface IJournalEvent {
  action_type?: string;
  event_type?: string;
  tool_name?: string;
  name?: string;
}

async function loadJournal(options: {
  workspaceRoot: string;
  exactlExecutable?: string;
}): Promise<IJournalEvent[]> {
  const exactl = options.exactlExecutable || "exactl";
  try {
    const command = new Deno.Command(exactl, {
      args: ["journal", "--format", "json", "-n", "500"],
      stdout: "piped",
      stderr: "piped",
      cwd: options.workspaceRoot,
    });
    const { code, stdout } = await command.output();
    if (code !== 0) return [];
    const text = new TextDecoder().decode(stdout);
    return JSON.parse(text) as IJournalEvent[];
  } catch {
    return [];
  }
}

function extractToolCalls(events: IJournalEvent[]): ITrajectoryResult {
  const toolCalls: string[] = [];

  for (const event of events) {
    const type = event.action_type || event.event_type || "";
    if (type.includes("tool_call") || type.includes("tool.use") || type.includes("tool_call_start")) {
      const toolName = typeof event.tool_name === "string"
        ? event.tool_name
        : typeof event.name === "string"
        ? event.name
        : type;
      toolCalls.push(toolName);
    }
  }

  return {
    matchedCount: 0,
    unmatchedCount: 0,
    extraCount: 0,
    sequence: toolCalls,
  };
}

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
