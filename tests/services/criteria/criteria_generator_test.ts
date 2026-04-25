/**
 * @module CriteriaGeneratorTest
 * @path tests/services/criteria/criteria_generator_test.ts
 * @description Unit tests for the CriteriaGenerator service, which converts
 * RequestAnalysis goals and acceptance criteria into EvaluationCriterion arrays.
 */

import { assertEquals } from "@std/assert";
import { EvaluationCategory } from "@exaix/core";
import { CriteriaGenerator } from "../../../src/services/skills/criteria_generator.ts";
import { ANALYZER_VERSION } from "@exaix/core";
import { type IRequestAnalysis, RequestAnalysisComplexity, RequestTaskType } from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";
import {
  ACCEPTANCE_CRITERION_WEIGHT,
  DEFAULT_GOAL_WEIGHT,
  MAX_DYNAMIC_CRITERIA,
  PRIORITY_1_GOAL_WEIGHT,
} from "@exaix/core";

function makeAnalysis(overrides: Partial<IRequestAnalysis> = {}): IRequestAnalysis {
  return {
    goals: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: 80,
    complexity: RequestAnalysisComplexity.MEDIUM,
    taskType: RequestTaskType.FEATURE,
    tags: [],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 10,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
    ...overrides,
  };
}

const generator = new CriteriaGenerator();

Deno.test("[CriteriaGenerator] generates criteria from explicit goals", () => {
  const analysis = makeAnalysis({
    goals: [
      { description: "Implement feature X", explicit: true, priority: 1 },
      { description: "Write unit tests", explicit: true, priority: 2 },
    ],
  });
  const criteria = generator.fromAnalysis(analysis);
  assertEquals(criteria.length, 2);
  assertEquals(criteria[0].name, "goal_implement_feature_x");
  assertEquals(criteria[0].category, EvaluationCategory.COMPLETENESS);
  assertEquals(criteria[0].required, true);
  assertEquals(criteria[1].name, "goal_write_unit_tests");
  assertEquals(criteria[1].required, true);
});

Deno.test("[CriteriaGenerator] generates criteria from acceptance criteria", () => {
  const analysis = makeAnalysis({
    acceptanceCriteria: ["All tests pass", "Coverage above 80%"],
  });
  const criteria = generator.fromAnalysis(analysis);
  assertEquals(criteria.length, 2);
  assertEquals(criteria[0].name, "ac_all_tests_pass");
  assertEquals(criteria[0].weight, ACCEPTANCE_CRITERION_WEIGHT);
  assertEquals(criteria[0].required, true);
  assertEquals(criteria[0].category, EvaluationCategory.COMPLETENESS);
  assertEquals(criteria[1].name, "ac_coverage_above_80_");
});

Deno.test("[CriteriaGenerator] sanitizes criterion names", () => {
  const analysis = makeAnalysis({
    goals: [{ description: "Add unit tests for auth module", explicit: true, priority: 3 }],
  });
  const criteria = generator.fromAnalysis(analysis);
  assertEquals(criteria[0].name, "goal_add_unit_tests_for_auth_module");
});

Deno.test("[CriteriaGenerator] caps at MAX_DYNAMIC_CRITERIA (10) criteria", () => {
  const analysis = makeAnalysis({
    goals: Array.from({ length: 6 }, (_, i) => ({
      description: `Goal ${i + 1}`,
      explicit: true,
      priority: i + 1,
    })),
    acceptanceCriteria: Array.from({ length: 6 }, (_, i) => `AC ${i + 1}`),
  });
  const criteria = generator.fromAnalysis(analysis);
  assertEquals(criteria.length, MAX_DYNAMIC_CRITERIA);
});

Deno.test("[CriteriaGenerator] sort order: higher weight criteria survive truncation", () => {
  // Priority-1 goal → weight 2.0, 5 ACs → weight 1.5, 5 other goals → weight 1.0
  // Total = 11; priority-7 goal (lowest tiebreak) gets truncated
  const analysis = makeAnalysis({
    goals: [
      { description: "Priority 1 goal", explicit: true, priority: 1 },
      { description: "Priority 3 goal", explicit: true, priority: 3 },
      { description: "Priority 4 goal", explicit: true, priority: 4 },
      { description: "Priority 5 goal", explicit: true, priority: 5 },
      { description: "Priority 6 goal", explicit: true, priority: 6 },
      { description: "Priority 7 goal", explicit: true, priority: 7 },
    ],
    acceptanceCriteria: ["AC 1", "AC 2", "AC 3", "AC 4", "AC 5"],
  });
  const criteria = generator.fromAnalysis(analysis);
  assertEquals(criteria.length, MAX_DYNAMIC_CRITERIA);
  const names = criteria.map((c) => c.name);
  assertEquals(names.includes("goal_priority_1_goal"), true);
  assertEquals(names.includes("goal_priority_7_goal"), false);
});

Deno.test("[CriteriaGenerator] priority-1 goals get higher weight", () => {
  const analysis = makeAnalysis({
    goals: [
      { description: "First goal", explicit: true, priority: 1 },
      { description: "Second goal", explicit: true, priority: 2 },
    ],
  });
  const criteria = generator.fromAnalysis(analysis);
  const p1 = criteria.find((c) => c.name === "goal_first_goal");
  const p2 = criteria.find((c) => c.name === "goal_second_goal");
  assertEquals(p1?.weight, PRIORITY_1_GOAL_WEIGHT);
  assertEquals(p2?.weight, DEFAULT_GOAL_WEIGHT);
});

Deno.test("[CriteriaGenerator] acceptance criteria are required", () => {
  const analysis = makeAnalysis({
    acceptanceCriteria: ["Must support TypeScript", "Must have documentation"],
  });
  const criteria = generator.fromAnalysis(analysis);
  criteria.forEach((c) => {
    assertEquals(c.required, true);
  });
});

Deno.test("[CriteriaGenerator] returns empty for analysis without goals", () => {
  const analysis = makeAnalysis({ goals: [], acceptanceCriteria: [] });
  const criteria = generator.fromAnalysis(analysis);
  assertEquals(criteria.length, 0);
});

Deno.test("[CriteriaGenerator] handles analysis with only inferred goals", () => {
  const analysis = makeAnalysis({
    goals: [
      { description: "Inferred goal", explicit: false, priority: 1 },
      { description: "Another inferred goal", explicit: false, priority: 2 },
    ],
    acceptanceCriteria: [],
  });
  const criteria = generator.fromAnalysis(analysis);
  assertEquals(criteria.length, 0);
});

Deno.test("[CriteriaGenerator] generates from goals only when acceptanceCriteria empty", () => {
  const analysis = makeAnalysis({
    goals: [
      { description: "Goal A", explicit: true, priority: 1 },
      { description: "Goal B", explicit: true, priority: 2 },
      { description: "Goal C", explicit: true, priority: 3 },
    ],
    acceptanceCriteria: [],
  });
  const criteria = generator.fromAnalysis(analysis);
  assertEquals(criteria.length, 3);
  criteria.forEach((c) => {
    assertEquals(c.name.startsWith("goal_"), true);
  });
});

Deno.test("[CriteriaGenerator] generates from acceptanceCriteria only when goals empty", () => {
  const analysis = makeAnalysis({
    goals: [],
    acceptanceCriteria: ["AC Alpha", "AC Beta", "AC Gamma"],
  });
  const criteria = generator.fromAnalysis(analysis);
  assertEquals(criteria.length, 3);
  criteria.forEach((c) => {
    assertEquals(c.name.startsWith("ac_"), true);
  });
});

Deno.test("[CriteriaGenerator] caps at exactly MAX_DYNAMIC_CRITERIA when input produces 11", () => {
  const analysis = makeAnalysis({
    goals: Array.from({ length: 6 }, (_, i) => ({
      description: `Goal item ${i + 1}`,
      explicit: true,
      priority: i + 1,
    })),
    acceptanceCriteria: Array.from({ length: 5 }, (_, i) => `AC item ${i + 1}`),
  });
  const criteria = generator.fromAnalysis(analysis);
  assertEquals(criteria.length, MAX_DYNAMIC_CRITERIA);
});
