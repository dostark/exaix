#!/usr/bin/env -S deno run -A
/**
 * @module RunJudgeCalibrationLiveProbe
 * @path scripts/run_judge_calibration_live_probe.ts
 * @description Phase 146 Step 1 live proof-of-concept: scores a small, hand-authored
 *   set of plan-quality items with the REAL target judge (claude-cli/claude-sonnet-5)
 *   and a REAL cross-provider reference evaluator (codex-cli/gpt-5.6-sol), then
 *   computes real exact/kappa/alpha agreement via packages/eval-history's calibration
 *   metrics. This is a scaled-down (6-item, not the ≥50-item) live demonstration that
 *   the full generate/score pipeline works end to end with real subscription-billed
 *   calls — it does not replace CalibrationRunner, the bwrap-sandboxed isolation
 *   profile, or the ≥50-real-artifact Success Criterion for Step 1.
 *
 * Usage:
 *   deno run -A scripts/run_judge_calibration_live_probe.ts
 */

import {
  alignCalibrationPairs,
  computeCohenKappa,
  computeExactAgreement,
  computeIntervalAlpha,
  deriveCalibrationLabel,
  type ICalibrationAlignedPair,
} from "@exaix/eval-history";
import { CriterionKind, CriterionPhase, ScenarioStepType } from "../tests/scenario_framework/schema/step_schema.ts";
import { evaluateLlmJudgeCriterion } from "../tests/scenario_framework/runner/assertions.ts";
import { evaluateReference } from "../tests/scenario_framework/runner/calibration_reference.ts";

const LABEL_THRESHOLD = 0.7;
const TARGET_PROVIDER = "claude-cli";
const TARGET_MODEL = "claude-cli:claude-sonnet-5";
const REFERENCE_PROVIDER = "codex-cli";
const REFERENCE_MODEL = "codex-cli:gpt-5.6-sol";
const PRESET = "GOAL_ALIGNED_REVIEW";

interface IProbeItem {
  readonly id: string;
  readonly requestContext: string;
  readonly artifact: string;
}

const PROBE_ITEMS: readonly IProbeItem[] = [
  {
    id: "item-1-well-aligned-complete",
    requestContext: "Add server-side email format and password-length validation to the login form's submit handler.",
    artifact: "## Plan\n" +
      "1. In `handleLoginSubmit`, validate `email` against a standard email regex before calling the auth API.\n" +
      "2. Validate `password.length >= 8` in the same handler; reject with a field-level error otherwise.\n" +
      "3. Return early with a rendered inline error for either failure — never call the auth API with invalid input.\n" +
      "4. Add unit tests covering: valid input, malformed email, and a too-short password.",
  },
  {
    id: "item-2-off-topic",
    requestContext: "Add server-side email format and password-length validation to the login form's submit handler.",
    artifact: "## Plan\n" +
      "1. Redesign the login page's color scheme to match the new brand guidelines.\n" +
      "2. Replace the logo asset with the updated SVG.\n" +
      "3. Update the footer copyright year.",
  },
  {
    id: "item-3-partial",
    requestContext:
      "Fix the null-pointer crash in `OrderSummary.render()` when `order.items` is undefined, and add a regression test.",
    artifact: "## Plan\n" +
      "1. Add a guard: `if (!order.items) return null;` at the top of `render()`.",
  },
  {
    id: "item-4-thorough-correct",
    requestContext:
      "Fix the null-pointer crash in `OrderSummary.render()` when `order.items` is undefined, and add a regression test.",
    artifact: "## Plan\n" +
      "1. Add a guard at the top of `OrderSummary.render()`: if `order.items` is null/undefined, " +
      "render an empty-state message instead of crashing.\n" +
      "2. Add a regression test in `order_summary_test.ts` that constructs an `order` with " +
      "`items: undefined` and asserts the component renders the empty state without throwing.\n" +
      "3. Add a second test confirming the existing populated-items rendering path is unaffected.",
  },
  {
    id: "item-5-solves-different-problem",
    requestContext:
      "Fix the null-pointer crash in `OrderSummary.render()` when `order.items` is undefined, and add a regression test.",
    artifact: "## Plan\n" +
      "1. Add pagination to the order list so only 20 orders render per page.\n" +
      "2. Add a loading spinner while orders fetch.",
  },
  {
    id: "item-6-well-aligned-complete",
    requestContext:
      "Add a `retryWithBackoff` helper that retries an async function up to N times with exponential backoff, and use it in the flaky `fetchInventory` call.",
    artifact: "## Plan\n" +
      "1. Implement `retryWithBackoff(fn, { maxAttempts, baseDelayMs })` in `packages/core/src/retry.ts`: " +
      "on failure, wait `baseDelayMs * 2^attempt` before the next attempt, up to `maxAttempts`.\n" +
      "2. Throw the last error once attempts are exhausted, preserving the original stack.\n" +
      "3. Wrap the existing `fetchInventory()` call site with `retryWithBackoff(fetchInventory, { maxAttempts: 3, baseDelayMs: 200 })`.\n" +
      "4. Add unit tests: succeeds on the 2nd attempt, exhausts all attempts and throws, and verifies backoff timing via a fake clock.",
  },
];

interface IProbeResult {
  readonly id: string;
  readonly targetScore: number;
  readonly referenceScore: number;
}

async function scoreTarget(item: IProbeItem): Promise<number> {
  const result = await evaluateLlmJudgeCriterion({
    workspaceRoot: Deno.cwd(),
    phase: CriterionPhase.OUTPUT,
    criterion: {
      id: item.id,
      kind: CriterionKind.LLM_JUDGE,
      preset: PRESET,
      score_threshold: LABEL_THRESHOLD,
      rubric: item.requestContext,
    },
    executionResult: {
      stepId: item.id,
      stepType: ScenarioStepType.SHELL,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
      exitCode: 0,
      stdout: item.artifact,
      stderr: "",
      combinedOutput: item.artifact,
    },
    env: {
      EXA_EVAL_LLM_MOCK: "false",
      EXA_LLM_PROVIDER: TARGET_PROVIDER,
      EXA_LLM_MODEL: TARGET_MODEL,
    },
  });
  if (result.score === undefined) {
    throw new Error(`target judge produced no score for "${item.id}": ${result.status} — ${result.message}`);
  }
  return result.score;
}

async function main(): Promise<void> {
  console.log(`Live judge-calibration probe: ${PROBE_ITEMS.length} items`);
  console.log(`Target:    ${TARGET_PROVIDER} / ${TARGET_MODEL}`);
  console.log(`Reference: ${REFERENCE_PROVIDER} / ${REFERENCE_MODEL}\n`);

  const results: IProbeResult[] = [];
  const skipped: string[] = [];
  for (const item of PROBE_ITEMS) {
    try {
      console.log(`[${item.id}] scoring target (${TARGET_PROVIDER})...`);
      const targetScore = await scoreTarget(item);
      console.log(`[${item.id}] target score: ${targetScore.toFixed(3)}`);

      console.log(`[${item.id}] scoring reference (${REFERENCE_PROVIDER}/${REFERENCE_MODEL})...`);
      const reference = await evaluateReference({
        requestContext: item.requestContext,
        artifact: item.artifact,
        preset: PRESET,
        labelThreshold: LABEL_THRESHOLD,
        referenceProvider: REFERENCE_PROVIDER,
        referenceModel: REFERENCE_MODEL,
      });
      console.log(`[${item.id}] reference score: ${reference.score.toFixed(3)}\n`);

      results.push({ id: item.id, targetScore, referenceScore: reference.score });
    } catch (error) {
      console.error(`[${item.id}] SKIPPED — live call failed: ${(error as Error).message}\n`);
      skipped.push(item.id);
    }
  }
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} item(s) due to a live-call failure: ${skipped.join(", ")}\n`);
  }

  const pairs: ICalibrationAlignedPair[] = alignCalibrationPairs(
    results.map((r) => ({ id: r.id, score: r.targetScore })),
    results.map((r) => ({ id: r.id, score: r.referenceScore })),
  );

  const exact = computeExactAgreement(pairs, LABEL_THRESHOLD);
  const kappa = computeCohenKappa(pairs, LABEL_THRESHOLD);
  const alpha = computeIntervalAlpha(pairs);

  console.log("=== Results ===");
  for (const r of results) {
    const targetLabel = deriveCalibrationLabel(r.targetScore, LABEL_THRESHOLD);
    const referenceLabel = deriveCalibrationLabel(r.referenceScore, LABEL_THRESHOLD);
    console.log(
      `${r.id}: target=${r.targetScore.toFixed(3)} (${targetLabel}) reference=${
        r.referenceScore.toFixed(3)
      } (${referenceLabel}) ${targetLabel === referenceLabel ? "MATCH" : "DISAGREE"}`,
    );
  }

  console.log("\n=== Agreement (n = %d, below Step 1's ≥50 minimum — proof of concept only) ===", pairs.length);
  console.log("exact:", exact);
  console.log("kappa:", kappa);
  console.log("alpha:", alpha);

  const reportPath = new URL("../.exa/judge_calibration_live_probe_report.json", import.meta.url);
  await Deno.writeTextFile(
    reportPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        target: { provider: TARGET_PROVIDER, model: TARGET_MODEL },
        reference: { provider: REFERENCE_PROVIDER, model: REFERENCE_MODEL },
        preset: PRESET,
        label_threshold: LABEL_THRESHOLD,
        sample_count: pairs.length,
        real_execution_marker: true,
        results,
        metrics: { exact, kappa, alpha },
        skipped,
        note: "Proof-of-concept live run — below Step 1's ≥50 real-artifact minimum sample count.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nReport written to ${reportPath.pathname}`);
}

await main();
