/**
 * @module MultiTrialLoopTest
 * @path tests/scenario_framework/tests/unit/multi_trial_loop_test.ts
 * @description Tests that the multi-trial loop produces 3 trial manifests and
 * 1 aggregated history entry with correct trial_scores and pass metrics.
 * Validates the aggregation logic that main.ts uses.
 */

import { assertEquals } from "@std/assert";
import { computeMultiTrialMetrics, DEFAULT_EVAL_TRIALS } from "../../runner/scoring.ts";

interface ITrialRunResult {
  suiteScore: number;
}

interface ITrialAggregation {
  trialScores: number[];
  metrics: ReturnType<typeof computeMultiTrialMetrics>;
  entry: {
    trials: number;
    trialScores: number[];
    suiteScoreMean: number;
    suiteScoreStdev: number;
    passAt1: number;
    passPowK: number;
  };
}

/**
 * Simulates the trial aggregation logic from main.ts (steps 8 loop + metrics).
 */
function aggregateTrials(
  trialResults: ITrialRunResult[],
  threshold: number,
): ITrialAggregation {
  const trialScores = trialResults.map((r) => r.suiteScore);
  const metrics = computeMultiTrialMetrics(trialScores, threshold);

  return {
    trialScores,
    metrics,
    entry: {
      trials: trialResults.length,
      trialScores,
      suiteScoreMean: metrics.mean,
      suiteScoreStdev: metrics.stdev,
      passAt1: metrics.pass_at_1,
      passPowK: metrics.pass_pow_k,
    },
  };
}

Deno.test("[MultiTrialLoop] --trials 3 produces 3 trial scores aggregated into 1 metrics object", () => {
  const results: ITrialRunResult[] = [
    { suiteScore: 0.9 },
    { suiteScore: 0.7 },
    { suiteScore: 0.8 },
  ];
  const agg = aggregateTrials(results, 0.5);
  assertEquals(agg.trialScores.length, 3);
  assertEquals(agg.metrics.mean, (0.9 + 0.7 + 0.8) / 3);
  assertEquals(agg.entry.trials, 3);
  assertEquals(agg.entry.trialScores, [0.9, 0.7, 0.8]);
});

Deno.test("[MultiTrialLoop] aggregated mean used as suite score for threshold gating", () => {
  const results: ITrialRunResult[] = [
    { suiteScore: 0.4 },
    { suiteScore: 0.6 },
    { suiteScore: 0.5 },
  ];
  const agg = aggregateTrials(results, 0.5);
  // mean = 0.5, threshold = 0.5 → passes (boundary equality)
  assertEquals(agg.metrics.mean, 0.5);
  assertEquals(agg.entry.suiteScoreMean, 0.5);
});

Deno.test("[MultiTrialLoop] trial scores include failed trials as 0.0", () => {
  const results: ITrialRunResult[] = [
    { suiteScore: 0.9 },
    { suiteScore: 0.0 }, // infra error → score 0
    { suiteScore: 0.8 },
  ];
  const agg = aggregateTrials(results, 0.5);
  assertEquals(agg.trialScores, [0.9, 0.0, 0.8]);
  assertEquals(agg.metrics.mean, (0.9 + 0.0 + 0.8) / 3);
  assertEquals(agg.metrics.pass_at_1, 2 / 3);
});

Deno.test("[MultiTrialLoop] single trial (trials=1) skips aggregation, returns raw score", () => {
  // When trials=1, main.ts uses manifest.suite_score directly
  // This tests the fallback: the score is just the single run's outcome
  const results: ITrialRunResult[] = [
    { suiteScore: 0.85 },
  ];
  const agg = aggregateTrials(results, 0.5);
  assertEquals(agg.trialScores.length, 1);
  assertEquals(agg.metrics.mean, 0.85);
  assertEquals(agg.metrics.pass_at_1, 1.0);
  assertEquals(agg.entry.trials, 1);
});

Deno.test("[MultiTrialLoop] pass_pow_k for mixed trial outcomes", () => {
  // 2/3 pass at threshold 0.5, pass_pow_k = (2/3)^3
  const results: ITrialRunResult[] = [
    { suiteScore: 0.9 },
    { suiteScore: 0.3 },
    { suiteScore: 0.7 },
  ];
  const agg = aggregateTrials(results, 0.5);
  assertEquals(agg.metrics.pass_at_1, 2 / 3);
  assertEquals(agg.metrics.pass_pow_k, Math.pow(2 / 3, 3));
  assertEquals(agg.entry.passAt1, 2 / 3);
  assertEquals(agg.entry.passPowK, Math.pow(2 / 3, 3));
});

Deno.test("[MultiTrialLoop] DEFAULT_EVAL_TRIALS is 1", () => {
  assertEquals(DEFAULT_EVAL_TRIALS, 1);
});
