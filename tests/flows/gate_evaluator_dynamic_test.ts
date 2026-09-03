/**
 * @module GateEvaluatorDynamicTest
 * @path tests/flows/gate_evaluator_dynamic_test.ts
 * @description Verifies GateEvaluator dynamic criteria merging: generating
 * EvaluationCriteria from IRequestAnalysis and merging with static criteria.
 */

import { assertEquals } from "@std/assert";
import { type GateConfig, GateEvaluator } from "@exaix/flow";
import type { IJudgeInvoker } from "@exaix/core/types";
import { CriteriaGenerator } from "@exaix/core/skills";
import { type IRequestAnalysis, RequestAnalysisComplexity, RequestTaskType } from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "@exaix/core/types";
import { ANALYZER_VERSION, FlowGateOnFail } from "@exaix/core";
import type { EvaluationCriterion, EvaluationResult } from "@exaix/core/evaluation";

const BASE_CONFIG: GateConfig = {
  agent_role: "judge-agent",
  criteria: ["CODE_CORRECTNESS"],
  threshold: 0.05,
  onFail: FlowGateOnFail.HALT,
  maxRetries: 3,
  includeRequestCriteria: false,
};

const SAMPLE_ANALYSIS: IRequestAnalysis = {
  goals: [
    {
      description: "Implement user authentication",
      explicit: true,
      priority: 1,
    },
    {
      description: "Add rate limiting",
      explicit: true,
      priority: 2,
    },
  ],
  requirements: [],
  constraints: [],
  acceptanceCriteria: [
    "Login form must validate email format",
    "Password must be minimum 8 characters",
  ],
  ambiguities: [],
  actionabilityScore: 80,
  taskType: RequestTaskType.FEATURE,
  complexity: RequestAnalysisComplexity.MEDIUM,
  tags: [],
  referencedFiles: [],
  metadata: {
    analyzedAt: "2025-01-01T00:00:00.000Z",
    durationMs: 100,
    mode: AnalysisMode.HEURISTIC,
    analyzerVersion: ANALYZER_VERSION,
  },
};

/**
 * A JudgeInvoker that records the criteria it is called with.
 */
class CapturingJudgeInvoker implements IJudgeInvoker {
  lastCriteria: EvaluationCriterion[] = [];

  evaluate(
    _identityId: string,
    _content: string,
    criteria: EvaluationCriterion[],
    _context?: string,
  ): Promise<EvaluationResult> {
    this.lastCriteria = [...criteria];
    const criteriaScores: EvaluationResult["criteriaScores"] = {};
    for (const c of criteria) {
      criteriaScores[c.name] = {
        name: c.name,
        score: 0.9,
        reasoning: "mock",
        issues: [],
        passed: true,
      };
    }
    return Promise.resolve({
      overallScore: 0.9,
      criteriaScores,
      pass: true,
      feedback: "mock",
      suggestions: [],
      metadata: { evaluatedAt: new Date().toISOString() },
    });
  }
}

Deno.test("[GateEvaluator] includes dynamic criteria when enabled and analysis available", async () => {
  const capturer = new CapturingJudgeInvoker();
  const evaluator = new GateEvaluator(capturer);

  const config: GateConfig = { ...BASE_CONFIG, includeRequestCriteria: true };

  await evaluator.evaluate(config, "test content", undefined, 0, SAMPLE_ANALYSIS);

  const names = capturer.lastCriteria.map((c) => c.name);
  // Dynamic criteria from analysis should be included
  const hasDynamic = names.some((n) => n.startsWith("goal_") || n.startsWith("ac_"));
  assertEquals(hasDynamic, true);
  // Static criterion should still be present (resolved name is lowercase)
  const hasStatic = names.some((n) => n === "code_correctness");
  assertEquals(hasStatic, true);
});

Deno.test("[GateEvaluator] skips dynamic criteria when disabled", async () => {
  const capturer = new CapturingJudgeInvoker();
  const evaluator = new GateEvaluator(capturer);

  const config: GateConfig = { ...BASE_CONFIG, includeRequestCriteria: false };

  await evaluator.evaluate(config, "test content", undefined, 0, SAMPLE_ANALYSIS);

  const names = capturer.lastCriteria.map((c) => c.name);
  const hasDynamic = names.some((n) => n.startsWith("goal_") || n.startsWith("ac_"));
  assertEquals(hasDynamic, false);
});

Deno.test("[GateEvaluator] skips dynamic criteria when analysis unavailable", async () => {
  const capturer = new CapturingJudgeInvoker();
  const evaluator = new GateEvaluator(capturer);

  const config: GateConfig = { ...BASE_CONFIG, includeRequestCriteria: true };

  await evaluator.evaluate(config, "test content", undefined, 0, undefined);

  const names = capturer.lastCriteria.map((c) => c.name);
  const hasDynamic = names.some((n) => n.startsWith("goal_") || n.startsWith("ac_"));
  assertEquals(hasDynamic, false);
  // Only static criteria present (resolved lowercase name)
  assertEquals(names.includes("code_correctness"), true);
});

Deno.test("[GateEvaluator] deduplicates criteria by name", async () => {
  const capturer = new CapturingJudgeInvoker();
  const evaluator = new GateEvaluator(capturer);

  const analysisWithKnownCriteria: IRequestAnalysis = {
    ...SAMPLE_ANALYSIS,
    goals: [
      { description: "CodeCorrectness check", explicit: true, priority: 1 },
    ],
    acceptanceCriteria: [],
  };

  const config: GateConfig = { ...BASE_CONFIG, includeRequestCriteria: true };
  await evaluator.evaluate(config, "test content", undefined, 0, analysisWithKnownCriteria);

  const names = capturer.lastCriteria.map((c) => c.name);
  // No duplicate names
  const uniqueNames = new Set(names);
  assertEquals(uniqueNames.size, names.length);
});

Deno.test("[GateEvaluator] static criteria take precedence over dynamic", async () => {
  const capturer = new CapturingJudgeInvoker();
  const evaluator = new GateEvaluator(capturer);

  const config: GateConfig = {
    ...BASE_CONFIG,
    includeRequestCriteria: true,
    criteria: ["CODE_CORRECTNESS"],
  };

  await evaluator.evaluate(config, "test content", undefined, 0, SAMPLE_ANALYSIS);

  // Static CODE_CORRECTNESS criterion should appear first (before dynamic ones)
  const names = capturer.lastCriteria.map((c) => c.name);
  assertEquals(names[0], "code_correctness");
  // Dynamic criteria should follow
  const hasDynamic = names.slice(1).some((n) => n.startsWith("goal_") || n.startsWith("ac_"));
  assertEquals(hasDynamic, true);
});

Deno.test("[GateEvaluator] existing flows unaffected when requestAnalysis not passed", async () => {
  const capturer = new CapturingJudgeInvoker();
  const evaluator = new GateEvaluator(capturer);

  // Old 4-argument call style (no requestAnalysis)
  await evaluator.evaluate(BASE_CONFIG, "test content", "context", 0);

  const names = capturer.lastCriteria.map((c) => c.name);
  // Only static code_correctness should be present
  assertEquals(names.length, 1);
  assertEquals(names[0], "code_correctness");
});

Deno.test("[GateEvaluator] falls back to static when dynamic generation returns empty", async () => {
  const capturer = new CapturingJudgeInvoker();

  // Analysis with no goals or acceptance criteria (empty dynamic generation)
  const emptyAnalysis: IRequestAnalysis = {
    ...SAMPLE_ANALYSIS,
    goals: [],
    acceptanceCriteria: [],
  };

  const evaluator = new GateEvaluator(capturer);
  const config: GateConfig = { ...BASE_CONFIG, includeRequestCriteria: true };

  await evaluator.evaluate(config, "test content", undefined, 0, emptyAnalysis);

  const names = capturer.lastCriteria.map((c) => c.name);
  // Static criteria still present
  assertEquals(names.includes("code_correctness"), true);
});

Deno.test("[GateEvaluator] catches CriteriaGenerator errors and continues with static criteria", async () => {
  const capturer = new CapturingJudgeInvoker();

  // Create a broken CriteriaGenerator
  class BrokenCriteriaGenerator extends CriteriaGenerator {
    override fromAnalysis(_analysis: IRequestAnalysis): EvaluationCriterion[] {
      throw new Error("Criteria generation failed");
    }
  }

  const evaluator = new GateEvaluator(capturer, new BrokenCriteriaGenerator());
  const config: GateConfig = { ...BASE_CONFIG, includeRequestCriteria: true };

  // Should NOT throw, should fall back to static only
  await evaluator.evaluate(config, "test content", undefined, 0, SAMPLE_ANALYSIS);

  const names = capturer.lastCriteria.map((c) => c.name);
  assertEquals(names.includes("code_correctness"), true);
  const hasDynamic = names.some((n) => n.startsWith("goal_") || n.startsWith("ac_"));
  assertEquals(hasDynamic, false);
});
