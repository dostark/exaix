/**
 * @module ScenarioFrameworkJudgeCalibration
 * @path tests/scenario_framework/runner/judge_calibration.ts
 * @description Phase 158 Step 5's judge calibration: the Pearson correlation between a
 * judge identity's scores and the objective test outcome for the same tasks. Distinct
 * from Phase 146's judge-vs-human agreement (Cohen's/Krippendorff's α) — this measures
 * judge-vs-objective-outcome correlation, complementary rather than redundant. Pure
 * computation only, matching arm_comparison.ts's pattern — collecting paired judge
 * scores and objective outcomes is the caller's concern.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/judge_calibration_test.ts]
 */

export interface IJudgeCalibrationSample {
  taskId: string;
  judgeScore: number;
  objectiveOutcome: number;
}

export interface IJudgeCalibrationInput {
  judgeIdentityId: string;
  samples: IJudgeCalibrationSample[];
}

export interface IJudgeCalibrationResult {
  judgeIdentityId: string;
  correlation: number;
  sampleCount: number;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Pearson correlation between judge scores and objective outcomes; fewer than 2 samples or zero variance on either side reports 0 rather than NaN — undefined either way, and 0 reads as "no measurable calibration signal". */
export function computeJudgeCalibration(input: IJudgeCalibrationInput): IJudgeCalibrationResult {
  const { samples } = input;
  if (samples.length < 2) {
    return { judgeIdentityId: input.judgeIdentityId, correlation: 0, sampleCount: samples.length };
  }

  const judgeScores = samples.map((s) => s.judgeScore);
  const outcomes = samples.map((s) => s.objectiveOutcome);
  const meanJudge = mean(judgeScores);
  const meanOutcome = mean(outcomes);

  let covariance = 0;
  let judgeVariance = 0;
  let outcomeVariance = 0;
  for (let i = 0; i < samples.length; i++) {
    const dJudge = judgeScores[i] - meanJudge;
    const dOutcome = outcomes[i] - meanOutcome;
    covariance += dJudge * dOutcome;
    judgeVariance += dJudge ** 2;
    outcomeVariance += dOutcome ** 2;
  }

  const denominator = Math.sqrt(judgeVariance * outcomeVariance);
  const correlation = denominator === 0 ? 0 : covariance / denominator;

  return { judgeIdentityId: input.judgeIdentityId, correlation, sampleCount: samples.length };
}
