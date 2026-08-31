/**
 * @module EvaluationCriteriaTest
 * @path tests/flows/evaluation_criteria_test.ts
 * @description Verifies the structured evaluation criteria for agent outputs,
 * ensuring correct mapping to quality metrics like correctness and completeness.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  buildEvaluationPrompt,
  calculateWeightedScore,
  checkRequiredCriteria,
  createCriterion,
  CRITERIA,
  CRITERION_SETS,
  type CriterionResult,
  type EvaluationCriterion,
  EvaluationCriterionSchema,
  getCriteriaByNames,
  RequirementFulfillmentSchema,
} from "@exaix/core/evaluation";
import { EvaluationCategory, FulfillmentStatus } from "@exaix/core";

// CRITERIA Constants Tests

Deno.test("CRITERIA: contains CODE_CORRECTNESS", () => {
  assertExists(CRITERIA.CODE_CORRECTNESS);
  assertEquals(CRITERIA.CODE_CORRECTNESS.name, "code_correctness");
  assertEquals(typeof CRITERIA.CODE_CORRECTNESS.description, "string");
  assertEquals(typeof CRITERIA.CODE_CORRECTNESS.weight, "number");
});

Deno.test("CRITERIA: contains HAS_TESTS", () => {
  assertExists(CRITERIA.HAS_TESTS);
  assertEquals(CRITERIA.HAS_TESTS.name, "has_tests");
});

Deno.test("CRITERIA: contains CODE_COMPLETENESS", () => {
  assertExists(CRITERIA.CODE_COMPLETENESS);
  assertEquals(CRITERIA.CODE_COMPLETENESS.name, "code_completeness");
});

Deno.test("CRITERIA: contains NO_SECURITY_ISSUES", () => {
  assertExists(CRITERIA.NO_SECURITY_ISSUES);
  assertEquals(CRITERIA.NO_SECURITY_ISSUES.name, "no_security_issues");
});

Deno.test("CRITERIA: all criteria have valid schema", () => {
  for (const [key, criterion] of Object.entries(CRITERIA)) {
    const parsed = EvaluationCriterionSchema.safeParse(criterion);
    assertEquals(parsed.success, true, `${key} should match schema`);
    assertExists(criterion.name);
    assertExists(criterion.description);
    assertEquals(criterion.weight >= 0 && criterion.weight <= 10, true);
  }
});

// CRITERION_SETS Tests

Deno.test("CRITERION_SETS: contains CODE_REVIEW set", () => {
  assertExists(CRITERION_SETS.CODE_REVIEW);
  assertEquals(Array.isArray(CRITERION_SETS.CODE_REVIEW), true);
  assertEquals(CRITERION_SETS.CODE_REVIEW.length > 0, true);
});

Deno.test("CRITERION_SETS: contains MINIMAL_GATE set", () => {
  assertExists(CRITERION_SETS.MINIMAL_GATE);
  assertEquals(Array.isArray(CRITERION_SETS.MINIMAL_GATE), true);
});

Deno.test("CRITERION_SETS: contains SECURITY_REVIEW set", () => {
  assertExists(CRITERION_SETS.SECURITY_REVIEW);
  assertEquals(Array.isArray(CRITERION_SETS.SECURITY_REVIEW), true);
});

Deno.test("CRITERION_SETS: CODE_REVIEW includes key criteria", () => {
  const criteriaNames = CRITERION_SETS.CODE_REVIEW.map((c) => c.name);
  assertEquals(criteriaNames.includes("code_correctness"), true);
});

// getCriteriaByNames Tests

Deno.test("getCriteriaByNames: retrieves single criterion", () => {
  const criteria = getCriteriaByNames(["CODE_CORRECTNESS"]);
  assertEquals(criteria.length, 1);
  assertEquals(criteria[0].name, "code_correctness");
});

Deno.test("getCriteriaByNames: retrieves multiple criteria", () => {
  const criteria = getCriteriaByNames(["CODE_CORRECTNESS", "HAS_TESTS", "CODE_COMPLETENESS"]);
  assertEquals(criteria.length, 3);

  const names = criteria.map((c) => c.name);
  assertEquals(names.includes("code_correctness"), true);
  assertEquals(names.includes("has_tests"), true);
  assertEquals(names.includes("code_completeness"), true);
});

Deno.test("getCriteriaByNames: handles hyphenated names", () => {
  const criteria = getCriteriaByNames(["CODE-CORRECTNESS"]);
  assertEquals(criteria.length, 1);
  assertEquals(criteria[0].name, "code_correctness");
});

Deno.test("getCriteriaByNames: handles lowercase names", () => {
  const criteria = getCriteriaByNames(["code_correctness"]);
  assertEquals(criteria.length, 1);
  assertEquals(criteria[0].name, "code_correctness");
});

Deno.test("getCriteriaByNames: skips unknown criteria with warning", () => {
  const criteria = getCriteriaByNames(["CODE_CORRECTNESS", "UNKNOWN_CRITERION"]);
  assertEquals(criteria.length, 1);
  assertEquals(criteria[0].name, "code_correctness");
});

Deno.test("getCriteriaByNames: returns empty array for all unknown", () => {
  const criteria = getCriteriaByNames(["FAKE_ONE", "FAKE_TWO"]);
  assertEquals(criteria.length, 0);
});

// calculateWeightedScore Tests

function makeCriterionResult(
  name: string,
  score: number,
  reasoning: string,
  passed: boolean,
  issues: string[] = [],
): CriterionResult {
  return { name, score, reasoning, issues, passed };
}

function makeCorrectnessCompletenessCriteria(
  correctnessWeight: number,
  completenessWeight: number,
): EvaluationCriterion[] {
  return [
    {
      name: "code_correctness",
      description: "Test",
      weight: correctnessWeight,
      required: false,
      category: EvaluationCategory.CORRECTNESS,
    },
    {
      name: "code_completeness",
      description: "Test",
      weight: completenessWeight,
      required: false,
      category: EvaluationCategory.COMPLETENESS,
    },
  ];
}

Deno.test("calculateWeightedScore: calculates simple average", () => {
  const criteriaResults: Record<string, CriterionResult> = {
    code_correctness: makeCriterionResult("code_correctness", 0.8, "Good", true),
    code_completeness: makeCriterionResult("code_completeness", 0.6, "Acceptable", true),
  };

  // Assuming both have weight 1.0
  const criteria = makeCorrectnessCompletenessCriteria(1.0, 1.0);

  const score = calculateWeightedScore(criteriaResults, criteria);
  assertEquals(score, 0.7); // (0.8 + 0.6) / 2
});

Deno.test("calculateWeightedScore: applies weights correctly", () => {
  const criteriaResults: Record<string, CriterionResult> = {
    code_correctness: makeCriterionResult("code_correctness", 1.0, "Perfect", true),
    code_completeness: makeCriterionResult("code_completeness", 0.0, "Missing", false, ["Everything missing"]),
  };

  const criteria = makeCorrectnessCompletenessCriteria(0.8, 0.2);

  const score = calculateWeightedScore(criteriaResults, criteria);
  // (1.0 * 0.8 + 0.0 * 0.2) / (0.8 + 0.2) = 0.8
  assertEquals(score, 0.8);
});

Deno.test("calculateWeightedScore: handles missing results", () => {
  const criteriaResults: Record<string, CriterionResult> = {
    code_correctness: makeCriterionResult("code_correctness", 0.9, "Great", true),
    // code_completeness is missing
  };

  const criteria = makeCorrectnessCompletenessCriteria(1.0, 1.0);

  const score = calculateWeightedScore(criteriaResults, criteria);
  // Only code_correctness counted: 0.9 * 1.0 / 1.0 = 0.9
  assertEquals(score, 0.9);
});

Deno.test("calculateWeightedScore: returns 0 for empty criteria", () => {
  const criteriaResults: Record<string, CriterionResult> = {};
  const criteria: EvaluationCriterion[] = [];

  const score = calculateWeightedScore(criteriaResults, criteria);
  assertEquals(score, 0);
});

// checkRequiredCriteria Tests

const correctnessAndCompletenessCriteria: EvaluationCriterion[] = [
  {
    name: "code_correctness",
    description: "Test",
    weight: 1.0,
    required: true,
    category: EvaluationCategory.CORRECTNESS,
  },
  {
    name: "code_completeness",
    description: "Test",
    weight: 1.0,
    required: false,
    category: EvaluationCategory.COMPLETENESS,
  },
];

Deno.test("checkRequiredCriteria: passes when all required met", () => {
  const criteriaResults: Record<string, CriterionResult> = {
    code_correctness: { name: "code_correctness", score: 0.9, reasoning: "Good", issues: [], passed: true },
    code_completeness: { name: "code_completeness", score: 0.8, reasoning: "OK", issues: [], passed: true },
  };

  const passed = checkRequiredCriteria(criteriaResults, correctnessAndCompletenessCriteria, 0.7);
  assertEquals(passed, true);
});

Deno.test("checkRequiredCriteria: fails when required criterion below threshold", () => {
  const criteriaResults: Record<string, CriterionResult> = {
    code_correctness: {
      name: "code_correctness",
      score: 0.5,
      reasoning: "Bad",
      issues: ["Many errors"],
      passed: false,
    },
    code_completeness: { name: "code_completeness", score: 0.9, reasoning: "Great", issues: [], passed: true },
  };

  const passed = checkRequiredCriteria(criteriaResults, correctnessAndCompletenessCriteria, 0.7);
  assertEquals(passed, false);
});

Deno.test("checkRequiredCriteria: passes when no required criteria", () => {
  const criteriaResults: Record<string, CriterionResult> = {
    code_correctness: { name: "code_correctness", score: 0.4, reasoning: "Poor", issues: ["Errors"], passed: false },
  };

  const criteria: EvaluationCriterion[] = [
    {
      name: "code_correctness",
      description: "Test",
      weight: 1.0,
      required: false,
      category: EvaluationCategory.CORRECTNESS,
    },
  ];

  const passed = checkRequiredCriteria(criteriaResults, criteria, 0.7);
  assertEquals(passed, true);
});

Deno.test("checkRequiredCriteria: uses custom threshold", () => {
  const criteriaResults: Record<string, CriterionResult> = {
    code_correctness: { name: "code_correctness", score: 0.85, reasoning: "Good", issues: [], passed: true },
  };

  const criteria: EvaluationCriterion[] = [
    {
      name: "code_correctness",
      description: "Test",
      weight: 1.0,
      required: true,
      category: EvaluationCategory.CORRECTNESS,
    },
  ];

  // With 0.9 threshold, 0.85 should fail
  const passedHigh = checkRequiredCriteria(criteriaResults, criteria, 0.9);
  assertEquals(passedHigh, false);

  // With 0.8 threshold, 0.85 should pass
  const passedLow = checkRequiredCriteria(criteriaResults, criteria, 0.8);
  assertEquals(passedLow, true);
});

// createCriterion Tests

Deno.test("createCriterion: creates criterion with defaults", () => {
  const criterion = createCriterion("CUSTOM_CHECK", "Custom description");

  assertEquals(criterion.name, "CUSTOM_CHECK");
  assertEquals(criterion.description, "Custom description");
  assertEquals(criterion.weight, 1.0);
  assertEquals(criterion.required, false);
});

Deno.test("createCriterion: creates criterion with custom options", () => {
  const criterion = createCriterion("SECURITY_CHECK", "Security validation", {
    weight: 0.9,
    required: true,
  });

  assertEquals(criterion.name, "SECURITY_CHECK");
  assertEquals(criterion.weight, 0.9);
  assertEquals(criterion.required, true);
});

Deno.test("createCriterion: validates through schema", () => {
  // This should throw if schema validation fails
  const criterion = createCriterion("VALID_NAME", "Valid description");
  assertExists(criterion);
});

// buildEvaluationPrompt Tests

Deno.test("buildEvaluationPrompt: includes content", () => {
  const criteria: EvaluationCriterion[] = [CRITERIA.CODE_CORRECTNESS];
  const prompt = buildEvaluationPrompt("function test() {}", criteria);

  assertEquals(prompt.includes("function test() {}"), true);
});

Deno.test("buildEvaluationPrompt: includes criteria descriptions", () => {
  const criteria: EvaluationCriterion[] = [
    CRITERIA.CODE_CORRECTNESS,
    CRITERIA.HAS_TESTS,
  ];
  const prompt = buildEvaluationPrompt("Test content", criteria);

  assertEquals(prompt.includes("code_correctness"), true);
  assertEquals(prompt.includes("has_tests"), true);
});

Deno.test("buildEvaluationPrompt: includes context when provided", () => {
  const criteria: EvaluationCriterion[] = [CRITERIA.CODE_CORRECTNESS];
  const prompt = buildEvaluationPrompt(
    "Test content",
    criteria,
    "This is a utility function for parsing JSON",
  );

  assertEquals(prompt.includes("Context"), true);
  assertEquals(prompt.includes("utility function for parsing JSON"), true);
});

Deno.test("buildEvaluationPrompt: omits context section when not provided", () => {
  const criteria: EvaluationCriterion[] = [CRITERIA.CODE_CORRECTNESS];
  const prompt = buildEvaluationPrompt("Test content", criteria);

  // Should not have a Context section header without context
  assertEquals(prompt.includes("### Context"), false);
});

Deno.test("buildEvaluationPrompt: marks required criteria", () => {
  const criteria: EvaluationCriterion[] = [
    {
      name: "MUST_PASS",
      description: "Required check",
      weight: 1.0,
      required: true,
      category: EvaluationCategory.CORRECTNESS,
    },
    {
      name: "OPTIONAL",
      description: "Optional check",
      weight: 0.5,
      required: false,
      category: EvaluationCategory.CORRECTNESS,
    },
  ];
  const prompt = buildEvaluationPrompt("Content", criteria);

  assertEquals(prompt.includes("REQUIRED"), true);
});

Deno.test("buildEvaluationPrompt: shows weights", () => {
  const criteria: EvaluationCriterion[] = [
    {
      name: "HIGH_WEIGHT",
      description: "Important",
      weight: 0.9,
      required: false,
      category: EvaluationCategory.CORRECTNESS,
    },
    {
      name: "LOW_WEIGHT",
      description: "Less important",
      weight: 0.3,
      required: false,
      category: EvaluationCategory.CORRECTNESS,
    },
  ];
  const prompt = buildEvaluationPrompt("Content", criteria);

  assertEquals(prompt.includes("weight: 0.9"), true);
  assertEquals(prompt.includes("weight: 0.3"), true);
});

Deno.test("buildEvaluationPrompt: includes JSON format instructions", () => {
  const criteria: EvaluationCriterion[] = [CRITERIA.CODE_CORRECTNESS];
  const prompt = buildEvaluationPrompt("Content", criteria);

  assertEquals(prompt.includes("score"), true);
  assertEquals(prompt.includes("reasoning"), true);
  assertEquals(prompt.includes("JSON"), true);
});

Deno.test("buildEvaluationPrompt: forbids the <thought>/<content> wrapper explicitly", () => {
  // The eval-harness judge path parses the whole response with JSON.parse and injects no
  // identity/skill, so the prompt itself must forbid the <thought>/<content> response
  // contract that reasoning-heavy models emit by default.
  const criteria: EvaluationCriterion[] = [CRITERIA.CODE_CORRECTNESS];
  const prompt = buildEvaluationPrompt("Content", criteria);

  assertEquals(prompt.includes("<thought>"), true, "prompt must name the wrapper it forbids");
  assertEquals(prompt.includes("<content>"), true, "prompt must name the wrapper it forbids");
});

Deno.test("buildEvaluationPrompt (multi): example JSON shows every criterion name, not a fixed 2-criterion sample", () => {
  // Live-observed bug: GOAL_ALIGNED_REVIEW has 5 criteria (goal_alignment, task_fulfillment,
  // request_understanding, code_correctness, code_completeness), but the multi-criteria
  // example JSON only ever showed 2 fixed criteria names (code_correctness,
  // code_completeness) with the required "passed" field. A real judge call, following the
  // example literally, omitted "passed" for the other 3 criteria — CriterionResultSchema
  // requires it (no default) — and the whole response failed schema validation. The example
  // must be built from the ACTUAL criteria list so every real criterion name appears with a
  // "passed" field modeled for it.
  const criteria: EvaluationCriterion[] = [
    CRITERIA.CODE_CORRECTNESS,
    CRITERIA.CODE_COMPLETENESS,
    CRITERIA.HAS_TESTS,
  ];
  const prompt = buildEvaluationPrompt("Content", criteria, undefined, true);

  for (const criterion of criteria) {
    const marker = `"${criterion.name}"`;
    assertEquals(
      prompt.includes(marker),
      true,
      `example JSON must include every real criterion name (missing ${marker})`,
    );
  }
  // Every criterion's example object must itself carry "passed" — not just the first two.
  const passedCount = (prompt.match(/"passed":\s*(?:true|false)/g) ?? []).length;
  assertEquals(
    passedCount >= criteria.length,
    true,
    `expected at least ${criteria.length} "passed" fields in the example (one per real criterion), found ${passedCount}`,
  );
});

// Schema Validation Tests

Deno.test("EvaluationCriterionSchema: validates correct criterion", () => {
  const result = EvaluationCriterionSchema.safeParse({
    name: "TEST_CRITERION",
    description: "A test criterion",
    weight: 0.8,
    required: true,
    category: EvaluationCategory.QUALITY,
    guidelines: ["Guideline 1"],
  });

  assertEquals(result.success, true);
});

Deno.test("EvaluationCriterionSchema: requires name", () => {
  const result = EvaluationCriterionSchema.safeParse({
    description: "Missing name",
    weight: 1.0,
  });

  assertEquals(result.success, false);
});

Deno.test("EvaluationCriterionSchema: requires description", () => {
  const result = EvaluationCriterionSchema.safeParse({
    name: "NO_DESC",
    weight: 1.0,
  });

  assertEquals(result.success, false);
});

Deno.test("EvaluationCriterionSchema: applies default weight", () => {
  const result = EvaluationCriterionSchema.parse({
    name: "DEFAULT_WEIGHT",
    description: "Should get default weight",
    category: EvaluationCategory.QUALITY,
  });

  assertEquals(result.weight, 1.0);
});

// Phase 48 — Step 1: New goal-aligned built-in criteria

Deno.test("[EvaluationCriteria] GOAL_ALIGNMENT has correct weight and category", () => {
  assertExists(CRITERIA.GOAL_ALIGNMENT);
  assertEquals(CRITERIA.GOAL_ALIGNMENT.name, "goal_alignment");
  assertEquals(CRITERIA.GOAL_ALIGNMENT.weight, 2.5);
  assertEquals(CRITERIA.GOAL_ALIGNMENT.required, true);
  assertEquals(CRITERIA.GOAL_ALIGNMENT.category, EvaluationCategory.COMPLETENESS);
});

Deno.test("[EvaluationCriteria] TASK_FULFILLMENT has correct weight and category", () => {
  assertExists(CRITERIA.TASK_FULFILLMENT);
  assertEquals(CRITERIA.TASK_FULFILLMENT.name, "task_fulfillment");
  assertEquals(CRITERIA.TASK_FULFILLMENT.weight, 2.0);
  assertEquals(CRITERIA.TASK_FULFILLMENT.required, true);
  assertEquals(CRITERIA.TASK_FULFILLMENT.category, EvaluationCategory.COMPLETENESS);
});

Deno.test("[EvaluationCriteria] REQUEST_UNDERSTANDING has correct weight and category", () => {
  assertExists(CRITERIA.REQUEST_UNDERSTANDING);
  assertEquals(CRITERIA.REQUEST_UNDERSTANDING.name, "request_understanding");
  assertEquals(CRITERIA.REQUEST_UNDERSTANDING.weight, 1.5);
  assertEquals(CRITERIA.REQUEST_UNDERSTANDING.required, false);
  assertEquals(CRITERIA.REQUEST_UNDERSTANDING.category, EvaluationCategory.CORRECTNESS);
});

Deno.test("[EvaluationCriteria] CRITERION_SETS.GOAL_ALIGNED_REVIEW contains 5 criteria", () => {
  assertExists(CRITERION_SETS.GOAL_ALIGNED_REVIEW);
  assertEquals(CRITERION_SETS.GOAL_ALIGNED_REVIEW.length, 5);
  const names = CRITERION_SETS.GOAL_ALIGNED_REVIEW.map((c) => c.name);
  assertEquals(names.includes("goal_alignment"), true);
  assertEquals(names.includes("task_fulfillment"), true);
  assertEquals(names.includes("request_understanding"), true);
  assertEquals(names.includes("code_correctness"), true);
  assertEquals(names.includes("code_completeness"), true);
});

Deno.test("[EvaluationCriteria] CRITERION_SETS.FULL_QUALITY_GATE contains 7 criteria", () => {
  assertExists(CRITERION_SETS.FULL_QUALITY_GATE);
  assertEquals(CRITERION_SETS.FULL_QUALITY_GATE.length, 7);
  const names = CRITERION_SETS.FULL_QUALITY_GATE.map((c) => c.name);
  assertEquals(names.includes("goal_alignment"), true);
  assertEquals(names.includes("task_fulfillment"), true);
  assertEquals(names.includes("code_correctness"), true);
  assertEquals(names.includes("code_completeness"), true);
  assertEquals(names.includes("no_security_issues"), true);
  assertEquals(names.includes("has_tests"), true);
  assertEquals(names.includes("error_handling"), true);
});

Deno.test("[EvaluationCriteria] existing criteria remain unchanged", () => {
  // Spot-check a handful of pre-Phase-48 criteria to confirm backward compat
  assertEquals(CRITERIA.CODE_CORRECTNESS.weight, 2.0);
  assertEquals(CRITERIA.NO_SECURITY_ISSUES.required, true);
  assertEquals(CRITERIA.ACCURACY.category, EvaluationCategory.CORRECTNESS);
  assertEquals(CRITERION_SETS.CODE_REVIEW.length, 5);
});

// Phase 48 — Step 2: RequirementFulfillmentSchema

Deno.test("[EvaluationCriteria] RequirementFulfillmentSchema validates MET status", () => {
  const result = RequirementFulfillmentSchema.parse({
    requirement: "implement login",
    status: FulfillmentStatus.MET,
  });
  assertEquals(result.requirement, "implement login");
  assertEquals(result.status, FulfillmentStatus.MET);
});

Deno.test("[EvaluationCriteria] RequirementFulfillmentSchema validates PARTIAL status", () => {
  const result = RequirementFulfillmentSchema.parse({
    requirement: "add error handling",
    status: FulfillmentStatus.PARTIAL,
  });
  assertEquals(result.status, "PARTIAL");
});

Deno.test("[EvaluationCriteria] RequirementFulfillmentSchema rejects unknown status", () => {
  const result = RequirementFulfillmentSchema.safeParse({
    requirement: "some req",
    status: "UNKNOWN",
  });
  assertEquals(result.success, false);
});
