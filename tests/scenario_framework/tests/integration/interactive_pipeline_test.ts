/**
 * @module InteractivePipelineTest
 * @path tests/scenario_framework/tests/integration/interactive_pipeline_test.ts
 * @description Phase 145 Step 5 — the CI guard: the interactive pack's mechanics run
 *   end-to-end **token-free**. A `UserSimulator` (seeded `MockLLMProvider`, zero real tokens)
 *   drives `driveInteractiveClarification()` through several rounds, then resolves a real
 *   on-disk wait state through the real `WaitStateCommands.approve()` — the exact production
 *   surface Step 2 added `resolvedBy` to. `checkRunAdherence` reads that real resolved wait
 *   state back from disk, not a hand-typed fixture. The real computed rounds/converged/adherent
 *   values are seeded into eval-history, and `computeInteractiveRows`/`EvalCommands.report()`
 *   render the per-persona table from that real chain. The live multi-persona run and founding
 *   tables are operator-triggered and tracked on the Reachability Ledger
 *   (`LEDGER:step2-interactive-live-run`).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/interactive_clarification.ts, tests/scenario_framework/runner/policy_adherence.ts, apps/exactl/src/commands/wait_state_commands.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ClarifyResultStatus, EvalScoringMode } from "@exaix/core";
import type { IWaitState } from "@exaix/flow";
import { EvalSqliteStore } from "@exaix/eval-history";
import { MockLLMProvider } from "@exaix/ai/providers";
import { MockStrategy } from "@exaix/core";
import { EvalCommands } from "../../../../apps/exactl/src/commands/eval_commands.ts";
import { WaitStateCommands } from "../../../../apps/exactl/src/commands/wait_state_commands.ts";
import { createCliTestContext } from "../../../../apps/exactl/tests/helpers/test_setup.ts";
import type { IClarificationEngineForCLI } from "../../../../apps/exactl/src/handlers/request_clarify_handler.ts";
import { UserSimulator } from "../../runner/user_simulator.ts";
import {
  computeRoundsToConverge,
  driveInteractiveClarification,
  type IClarifyStepResult,
  type IDriveInteractiveClarificationOptions,
} from "../../runner/interactive_clarification.ts";
import { checkRunAdherence } from "../../runner/policy_adherence.ts";

interface IConsoleArgs extends Array<string | number | boolean | object | undefined | null> {}

function withCapturedOutput<T>(fn: () => T): Promise<{ output: string[]; result: T }> {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: IConsoleArgs) => output.push(args.join(" "));
  const result = fn();
  return Promise.resolve(result)
    .then((resolved) => ({ output, result: resolved }))
    .finally(() => {
      console.log = originalLog;
    });
}

const PERSONA = "cooperative";
const ACTOR = `user-simulator:${PERSONA}`;
const TEST_TRACE = "trace-interactive-pipeline";
const TEST_WAIT_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_TOKEN = "550e8400-e29b-41d4-a716-446655440001";

function makeStubEngine(): IClarificationEngineForCLI {
  return {
    processAnswers: (session) => Promise.resolve(session),
    isComplete: () => false,
    cancel: (session) => session,
  };
}

async function writeWaitState(waitStatesDir: string, waitState: IWaitState): Promise<string> {
  const traceDir = join(waitStatesDir, waitState.traceId);
  await Deno.mkdir(traceDir, { recursive: true });
  const filePath = join(traceDir, `${waitState.waitStateId}.json`);
  await Deno.writeTextFile(filePath, JSON.stringify(waitState, null, 2));
  return filePath;
}

Deno.test("[InteractivePipeline] drives the real simulator/clarification/wait-state chain token-free and renders the interactive view", async () => {
  const { context, tempDir, db, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");

  // 1. A seeded (token-free) simulator answers three rounds, then the loop completes.
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["Answer one.", "Answer two.", "Answer three."],
  });
  const simulator = new UserSimulator({
    provider,
    persona: PERSONA,
    groundTruthIntent: "Add a due-date filter to the todo list without changing storage.",
  });

  let callCount = 0;
  const results: IClarifyStepResult[] = [
    { status: ClarifyResultStatus.QUESTIONS, round: 1 },
    { status: ClarifyResultStatus.QUESTIONS, round: 2 },
    { status: ClarifyResultStatus.COMPLETE, round: 3 },
  ];
  const clarify: IDriveInteractiveClarificationOptions["clarify"] = (_requestId, options) => {
    const result = results[callCount];
    callCount++;
    return options.promptFn(`Question ${callCount}?`, `q${callCount}`).then(() => result);
  };

  const run = await driveInteractiveClarification({
    requestId: "req-pipeline-1",
    clarify,
    engine: makeStubEngine(),
    simulator,
  });
  assertEquals(callCount, 3, "the simulator must have answered all three real rounds");
  assertEquals(simulator.getTranscript().length, 3, "every round's answer must be journaled");
  const { rounds, converged } = computeRoundsToConverge(run.results);
  assertEquals(rounds, 3);
  assertEquals(converged, true);

  // 2. The simulator resolves a real on-disk wait state through the real WaitStateCommands —
  //    the production surface that carries the resolvedBy actor attribution.
  const config = context.config.getAll();
  const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
  await writeWaitState(waitStatesDir, {
    waitStateId: TEST_WAIT_ID,
    traceId: TEST_TRACE,
    kind: "plan_approval",
    status: "pending",
    artifactPath: "Workspace/Active/interactive-pipeline",
    resumeToken: TEST_TOKEN,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  });
  const waitStateCommands = new WaitStateCommands(context);
  const resolved = await waitStateCommands.approve(TEST_TOKEN, "Plan looks good", ACTOR);
  assertEquals(resolved.status, "fulfilled");

  // 3. checkRunAdherence reads the REAL resolved wait state back from disk, not a hand-typed one.
  const adherenceResult = checkRunAdherence([resolved], ACTOR);
  assertEquals(adherenceResult.adherent, true);
  assertEquals(adherenceResult.breaches, []);

  // 4. Seed eval-history with the real computed rounds/converged/adherent values.
  const store = new EvalSqliteStore(dbPath);
  try {
    store.writeRun({
      run_id: "interactive-pipeline-run",
      scenario_id: "interactive-cooperative-pipeline",
      pack: "interactive",
      tags: [
        "interactive",
        `persona:${PERSONA}`,
        `rounds:${rounds}`,
        `converged:${converged}`,
        `adherent:${adherenceResult.adherent}`,
      ],
      outcome: "success",
      mode: "auto",
      scoring_mode: EvalScoringMode.ADDITIVE,
      suite_score: 1.0,
      passed: true,
      timestamp: new Date().toISOString(),
      pass_pow_k: 1.0,
    }, []);
  } finally {
    store.close();
  }
  await db.waitForFlush();

  // 5. The interactive view renders the per-persona table computed from this real chain.
  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "interactive", dbPath }));
  const text = output.join("\n");
  assert(text.length > 0 && !text.includes("Error"), "interactive view must render without error");
  assertStringIncludes(text, PERSONA);
  assertStringIncludes(text, "3.000");

  await cleanup();
});
