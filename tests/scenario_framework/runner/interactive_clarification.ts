/**
 * @module ScenarioFrameworkInteractiveClarification
 * @path tests/scenario_framework/runner/interactive_clarification.ts
 * @description Drives `RequestClarifyHandler.clarify()`'s round loop from the test side (Phase
 *   145): `clarify()` handles exactly one round per call and returns a non-terminal
 *   `{status: QUESTIONS, round, questions}` result — this module owns the repeat-until-terminal
 *   loop, binding a `UserSimulator`'s `answer()` as the `promptFn` callback. Convergence is
 *   computed from the resulting `ClarifyResultStatus` sequence.
 *
 *   `ClarifyResultStatus` (COMPLETE/CANCELLED/QUESTIONS/NO_SESSION) does not distinguish a
 *   session that hit `MAX_ROUNDS` from one where the agent was genuinely satisfied — both
 *   surface as COMPLETE. Precise disambiguation needs the persisted `ClarificationSession`'s
 *   own status, not just this wrapper result; deferred to Step 4, where the ambiguous/
 *   adversarial personas make hitting the round cap an expected, real case worth distinguishing.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/interactive_convergence_test.ts, tests/scenario_framework/runner/user_simulator.ts]
 */

import { ClarifyResultStatus } from "@exaix/core";
import type { IClarificationEngineForCLI } from "../../../apps/exactl/src/handlers/request_clarify_handler.ts";

/** Structural subset of `IClarifyResult` this module needs. */
export interface IClarifyStepResult {
  status: ClarifyResultStatus;
  round?: number;
}

export interface IRoundsToConvergeResult {
  rounds: number;
  converged: boolean;
}

/** Minimal shape the driver needs from a simulator (matches `UserSimulator`'s public surface). */
export interface IClarificationSimulator {
  answer(questionText: string, questionId: string): Promise<string>;
}

export interface IDriveInteractiveClarificationOptions {
  requestId: string;
  /** `RequestClarifyHandler.clarify` (or a compatible stub) — bound `interactive: true` and
   *  `engine` are supplied by the caller here, not re-derived, since a real `engine` needs
   *  production DI this test-side module doesn't own. */
  clarify: (
    requestId: string,
    options: {
      interactive: true;
      engine: IClarificationEngineForCLI;
      promptFn: (questionText: string, questionId: string) => Promise<string | null>;
    },
  ) => Promise<IClarifyStepResult>;
  engine: IClarificationEngineForCLI;
  simulator: IClarificationSimulator;
  /** Safety cap on THIS driving loop — distinct from the engine's own internal
   *  `DEFAULT_MAX_CLARIFICATION_ROUNDS` cap, which governs the persisted session instead. */
  maxRounds?: number;
}

export interface IDriveInteractiveClarificationRun {
  results: IClarifyStepResult[];
  rounds: number;
  converged: boolean;
}

const TERMINAL_RESULT_STATUSES = new Set<ClarifyResultStatus>([
  ClarifyResultStatus.COMPLETE,
  ClarifyResultStatus.CANCELLED,
  ClarifyResultStatus.NO_SESSION,
]);

const DEFAULT_DRIVER_ROUND_CAP = 10;

/** `converged` is true only when the sequence's last result is COMPLETE — see the module doc
 *  for why CANCELLED/NO_SESSION and a hit-the-cap COMPLETE cannot yet be told apart precisely. */
export function computeRoundsToConverge(results: IClarifyStepResult[]): IRoundsToConvergeResult {
  const last = results.at(-1);
  return { rounds: results.length, converged: last?.status === ClarifyResultStatus.COMPLETE };
}

/** Repeatedly calls `clarify()` — one round per call — until a terminal `ClarifyResultStatus`
 *  or the safety cap is hit, binding `simulator.answer()` as the round's `promptFn`. */
export async function driveInteractiveClarification(
  options: IDriveInteractiveClarificationOptions,
): Promise<IDriveInteractiveClarificationRun> {
  const cap = options.maxRounds ?? DEFAULT_DRIVER_ROUND_CAP;
  const results: IClarifyStepResult[] = [];

  for (let i = 0; i < cap; i++) {
    const result = await options.clarify(options.requestId, {
      interactive: true,
      engine: options.engine,
      promptFn: (questionText, questionId) => options.simulator.answer(questionText, questionId),
    });
    results.push(result);
    if (TERMINAL_RESULT_STATUSES.has(result.status)) break;
  }

  const { rounds, converged } = computeRoundsToConverge(results);
  return { results, rounds, converged };
}
