/**
 * @module InteractiveConvergenceTest
 * @path tests/scenario_framework/tests/unit/interactive_convergence_test.ts
 * @description `driveInteractiveClarification`/`computeRoundsToConverge`: the round-driving
 *   loop calls a stubbed `clarify()` repeatedly until a terminal `ClarifyResultStatus`, and
 *   rounds-to-converge is computed exactly from the resulting sequence. Phase 145 Step 2.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/interactive_clarification.ts]
 */

import { assertEquals } from "@std/assert";
import { ClarifyResultStatus } from "@exaix/core";
import type { IClarificationEngineForCLI } from "../../../../apps/exactl/src/handlers/request_clarify_handler.ts";
import {
  computeRoundsToConverge,
  driveInteractiveClarification,
  type IClarificationSimulator,
  type IDriveInteractiveClarificationOptions,
} from "../../runner/interactive_clarification.ts";

function makeStubSimulator(): IClarificationSimulator {
  return { answer: (_questionText, questionId) => Promise.resolve(`answer-for-${questionId}`) };
}

/** Never invoked by these tests — `driveInteractiveClarification` only threads `engine` through
 *  to the `clarify` stub, which ignores it here. */
function makeStubEngine(): IClarificationEngineForCLI {
  return {
    processAnswers: (session) => Promise.resolve(session),
    isComplete: () => false,
    cancel: (session) => session,
  };
}

Deno.test("[InteractiveConvergence] computeRoundsToConverge: COMPLETE is converged", () => {
  const result = computeRoundsToConverge([
    { status: ClarifyResultStatus.QUESTIONS },
    { status: ClarifyResultStatus.QUESTIONS },
    { status: ClarifyResultStatus.COMPLETE },
  ]);
  assertEquals(result, { rounds: 3, converged: true });
});

Deno.test("[InteractiveConvergence] computeRoundsToConverge: CANCELLED is not converged", () => {
  const result = computeRoundsToConverge([
    { status: ClarifyResultStatus.QUESTIONS },
    { status: ClarifyResultStatus.CANCELLED },
  ]);
  assertEquals(result, { rounds: 2, converged: false });
});

Deno.test("[InteractiveConvergence] computeRoundsToConverge: empty sequence is not converged", () => {
  const result = computeRoundsToConverge([]);
  assertEquals(result, { rounds: 0, converged: false });
});

Deno.test("[InteractiveConvergence] driveInteractiveClarification calls clarify() once per round until terminal", async () => {
  let callCount = 0;
  const clarify: IDriveInteractiveClarificationOptions["clarify"] = (_requestId, _options) => {
    callCount++;
    if (callCount < 3) {
      return Promise.resolve({ status: ClarifyResultStatus.QUESTIONS, round: callCount });
    }
    return Promise.resolve({ status: ClarifyResultStatus.COMPLETE, round: callCount });
  };

  const run = await driveInteractiveClarification({
    requestId: "req-1",
    clarify,
    engine: makeStubEngine(),
    simulator: makeStubSimulator(),
  });

  assertEquals(callCount, 3);
  assertEquals(run.rounds, 3);
  assertEquals(run.converged, true);
  assertEquals(run.results.map((result) => result.status), [
    ClarifyResultStatus.QUESTIONS,
    ClarifyResultStatus.QUESTIONS,
    ClarifyResultStatus.COMPLETE,
  ]);
});

Deno.test("[InteractiveConvergence] driveInteractiveClarification stops at the safety cap without hanging", async () => {
  const clarify: IDriveInteractiveClarificationOptions["clarify"] = () =>
    Promise.resolve({ status: ClarifyResultStatus.QUESTIONS, round: 1 });

  const run = await driveInteractiveClarification({
    requestId: "req-1",
    clarify,
    engine: makeStubEngine(),
    simulator: makeStubSimulator(),
    maxRounds: 4,
  });

  assertEquals(run.rounds, 4);
  assertEquals(run.converged, false);
});
