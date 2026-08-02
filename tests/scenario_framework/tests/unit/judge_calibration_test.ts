/**
 * @module ScenarioFrameworkJudgeCalibrationTest
 * @path tests/scenario_framework/tests/unit/judge_calibration_test.ts
 * @description Tests for Phase 158 Step 5's judge calibration: the Pearson correlation
 * between a judge identity's scores and the objective test outcome for the same tasks.
 * Distinct from Phase 146's judge-vs-human agreement (Cohen's/Krippendorff's α) — this
 * measures judge-vs-objective-outcome correlation. A shuffled pairing of the same score
 * values must collapse the correlation to (near) zero, proving the statistic actually
 * measures pairing rather than merely reflecting the score distribution.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/judge_calibration.ts]
 */

import { assertEquals } from "@std/assert";
import { computeJudgeCalibration } from "../../runner/judge_calibration.ts";

Deno.test("[JudgeCalibration] judge scores that track the objective outcome exactly correlate at 1", () => {
  const result = computeJudgeCalibration({
    judgeIdentityId: "quality-judge",
    samples: [
      { taskId: "task-1", judgeScore: 0.1, objectiveOutcome: 0.1 },
      { taskId: "task-2", judgeScore: 0.4, objectiveOutcome: 0.4 },
      { taskId: "task-3", judgeScore: 0.6, objectiveOutcome: 0.6 },
      { taskId: "task-4", judgeScore: 0.9, objectiveOutcome: 0.9 },
    ],
  });
  assertEquals(Math.round(result.correlation * 100) / 100, 1);
  assertEquals(result.sampleCount, 4);
});

Deno.test("[JudgeCalibration] a shuffled control pairing of the same score values scores at (near) zero", () => {
  // Same four values on each side, re-paired so they no longer track task-for-task.
  const result = computeJudgeCalibration({
    judgeIdentityId: "quality-judge",
    samples: [
      { taskId: "task-1", judgeScore: 0.1, objectiveOutcome: 0.6 },
      { taskId: "task-2", judgeScore: 0.4, objectiveOutcome: 0.1 },
      { taskId: "task-3", judgeScore: 0.6, objectiveOutcome: 0.9 },
      { taskId: "task-4", judgeScore: 0.9, objectiveOutcome: 0.4 },
    ],
  });
  assertEquals(Math.round(result.correlation * 1000) / 1000, 0);
});

Deno.test("[JudgeCalibration] inversely related scores correlate near -1", () => {
  const result = computeJudgeCalibration({
    judgeIdentityId: "miscalibrated-judge",
    samples: [
      { taskId: "task-1", judgeScore: 0.9, objectiveOutcome: 0.1 },
      { taskId: "task-2", judgeScore: 0.6, objectiveOutcome: 0.4 },
      { taskId: "task-3", judgeScore: 0.4, objectiveOutcome: 0.6 },
      { taskId: "task-4", judgeScore: 0.1, objectiveOutcome: 0.9 },
    ],
  });
  assertEquals(Math.round(result.correlation * 100) / 100, -1);
});

Deno.test("[JudgeCalibration] a constant judge score (zero variance) reports zero correlation, not NaN", () => {
  const result = computeJudgeCalibration({
    judgeIdentityId: "flat-judge",
    samples: [
      { taskId: "task-1", judgeScore: 0.5, objectiveOutcome: 0.1 },
      { taskId: "task-2", judgeScore: 0.5, objectiveOutcome: 0.9 },
    ],
  });
  assertEquals(result.correlation, 0);
});

Deno.test("[JudgeCalibration] the judge identity id is carried through to the result", () => {
  const result = computeJudgeCalibration({
    judgeIdentityId: "quality-judge",
    samples: [{ taskId: "task-1", judgeScore: 0.5, objectiveOutcome: 0.5 }],
  });
  assertEquals(result.judgeIdentityId, "quality-judge");
});
