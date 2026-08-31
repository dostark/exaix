/**
 * @module RequestAnalysisSchemaTest
 * @path packages/schemas/tests/request_analysis_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Tests for the IRequestAnalysis Zod schema and inferred types,
 * ensuring robust validation of request intent analysis output.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  AmbiguityImpact,
  AmbiguitySchema,
  RequestAnalysisComplexity,
  RequestAnalysisSchema,
  RequestGoalSchema,
  RequestTaskType,
  RequirementSchema,
} from "@exaix/schemas";

import { AnalysisMode } from "@exaix/core/request";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validGoal = {
  description: "Add unit tests for UserService",
  explicit: true,
  priority: 1,
};

const validRequirement = {
  description: "All existing tests must continue to pass",
  confidence: 0.9,
  type: "functional" as const,
  explicit: true,
};

const validAmbiguity = {
  description: "Unclear which test framework to use",
  impact: AmbiguityImpact.MEDIUM,
  interpretations: [] as string[],
};

const validAnalysis = {
  goals: [validGoal],
  requirements: [validRequirement],
  constraints: ["No new dependencies"],
  acceptanceCriteria: ["100% of new methods are covered"],
  ambiguities: [validAmbiguity],
  actionabilityScore: 75,
  complexity: RequestAnalysisComplexity.MEDIUM,
  taskType: RequestTaskType.TEST,
  tags: ["testing", "unit-test"],
  referencedFiles: ["src/services/user_service.ts"],
  metadata: {
    analyzedAt: new Date().toISOString(),
    durationMs: 42,
    mode: AnalysisMode.HEURISTIC,
  },
};

// ---------------------------------------------------------------------------
// RequestGoalSchema
// ---------------------------------------------------------------------------

Deno.test("[RequestGoalSchema] validates explicit goal", () => {
  const result = RequestGoalSchema.safeParse(validGoal);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.explicit, true);
    assertEquals(result.data.priority, 1);
  }
});

Deno.test("[RequestGoalSchema] validates inferred goal (explicit: false)", () => {
  const result = RequestGoalSchema.safeParse({
    description: "Implied: maintain backward compatibility",
    explicit: false,
    priority: 2,
  });
  assertEquals(result.success, true);
});

Deno.test("[RequestGoalSchema] rejects missing description", () => {
  const result = RequestGoalSchema.safeParse({ explicit: true, priority: 1 });
  assertEquals(result.success, false);
});

Deno.test("[RequestGoalSchema] rejects invalid priority (zero)", () => {
  const result = RequestGoalSchema.safeParse({ ...validGoal, priority: 0 });
  assertEquals(result.success, false);
});

// ---------------------------------------------------------------------------
// RequirementSchema
// ---------------------------------------------------------------------------

Deno.test("[RequirementSchema] validates confidence range 0.0–1.0", () => {
  const low = RequirementSchema.safeParse({ ...validRequirement, confidence: 0.0 });
  const high = RequirementSchema.safeParse({ ...validRequirement, confidence: 1.0 });
  assertEquals(low.success, true);
  assertEquals(high.success, true);
});

Deno.test("[RequirementSchema] rejects confidence above 1.0", () => {
  const result = RequirementSchema.safeParse({ ...validRequirement, confidence: 1.1 });
  assertEquals(result.success, false);
});

Deno.test("[RequirementSchema] rejects confidence below 0.0", () => {
  const result = RequirementSchema.safeParse({ ...validRequirement, confidence: -0.1 });
  assertEquals(result.success, false);
});

Deno.test("[RequirementSchema] rejects missing description", () => {
  const result = RequirementSchema.safeParse({ confidence: 0.5 });
  assertEquals(result.success, false);
});

// ---------------------------------------------------------------------------
// AmbiguitySchema
// ---------------------------------------------------------------------------

Deno.test("[AmbiguitySchema] validates all impact enum values", () => {
  for (const impact of Object.values(AmbiguityImpact)) {
    const result = AmbiguitySchema.safeParse({ description: "some ambiguity", impact });
    assertEquals(result.success, true, `impact=${impact} should be valid`);
  }
});

Deno.test("[AmbiguitySchema] rejects invalid impact value", () => {
  const result = AmbiguitySchema.safeParse({ description: "x", impact: "catastrophic" });
  assertEquals(result.success, false);
});

Deno.test("[AmbiguitySchema] rejects missing impact", () => {
  const result = AmbiguitySchema.safeParse({ description: "x" });
  assertEquals(result.success, false);
});

// ---------------------------------------------------------------------------
// RequestAnalysisSchema — full object
// ---------------------------------------------------------------------------

Deno.test("[RequestAnalysisSchema] validates complete valid analysis", () => {
  const result = RequestAnalysisSchema.safeParse(validAnalysis);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.actionabilityScore, 75);
    assertEquals(result.data.complexity, RequestAnalysisComplexity.MEDIUM);
    assertEquals(result.data.goals.length, 1);
    assertEquals(result.data.requirements.length, 1);
    assertEquals(result.data.ambiguities.length, 1);
    assertExists(result.data.metadata);
  }
});

Deno.test("[RequestAnalysisSchema] rejects missing required fields", () => {
  // goals is required
  const result = RequestAnalysisSchema.safeParse({ ...validAnalysis, goals: undefined });
  assertEquals(result.success, false);
});

Deno.test("[RequestAnalysisSchema] validates actionabilityScore range 0–100", () => {
  const zero = RequestAnalysisSchema.safeParse({ ...validAnalysis, actionabilityScore: 0 });
  const hundred = RequestAnalysisSchema.safeParse({ ...validAnalysis, actionabilityScore: 100 });
  assertEquals(zero.success, true);
  assertEquals(hundred.success, true);
});

Deno.test("[RequestAnalysisSchema] rejects actionabilityScore out of range", () => {
  const neg = RequestAnalysisSchema.safeParse({ ...validAnalysis, actionabilityScore: -1 });
  const over = RequestAnalysisSchema.safeParse({ ...validAnalysis, actionabilityScore: 101 });
  assertEquals(neg.success, false);
  assertEquals(over.success, false);
});

Deno.test("[RequestAnalysisSchema] validates all complexity enum values", () => {
  for (const complexity of Object.values(RequestAnalysisComplexity)) {
    const result = RequestAnalysisSchema.safeParse({ ...validAnalysis, complexity });
    assertEquals(result.success, true, `complexity=${complexity} should be valid`);
  }
});

Deno.test("[RequestAnalysisSchema] rejects invalid complexity value", () => {
  const result = RequestAnalysisSchema.safeParse({ ...validAnalysis, complexity: "gigantic" });
  assertEquals(result.success, false);
});

Deno.test("[RequestAnalysisSchema] validates all taskType enum values", () => {
  for (const taskType of Object.values(RequestTaskType)) {
    const result = RequestAnalysisSchema.safeParse({ ...validAnalysis, taskType });
    assertEquals(result.success, true, `taskType=${taskType} should be valid`);
  }
});

// RequirementSchema — type / explicit fields

Deno.test("[RequirementSchema] accepts type: functional / non-functional / constraint", () => {
  for (const type of ["functional", "non-functional", "constraint"] as const) {
    const r = RequirementSchema.safeParse({ description: "x", confidence: 0.9, type, explicit: true });
    assertEquals(r.success, true, `type=${type} should be valid`);
    if (r.success) assertEquals(r.data.type, type);
  }
});

Deno.test("[RequirementSchema] defaults type to functional when absent", () => {
  const r = RequirementSchema.safeParse({ description: "x", confidence: 0.9 });
  assertEquals(r.success, true);
  if (r.success) assertEquals(r.data.type, "functional");
});

Deno.test("[RequirementSchema] defaults explicit to true when absent", () => {
  const r = RequirementSchema.safeParse({ description: "x", confidence: 0.9 });
  assertEquals(r.success, true);
  if (r.success) assertEquals(r.data.explicit, true);
});

Deno.test("[RequirementSchema] rejects invalid type value", () => {
  const r = RequirementSchema.safeParse({ description: "x", confidence: 0.9, type: "optional" });
  assertEquals(r.success, false);
});

// AmbiguitySchema — interpretations / clarificationQuestion fields

Deno.test("[AmbiguitySchema] accepts interpretations array", () => {
  const r = AmbiguitySchema.safeParse({
    description: "x",
    impact: AmbiguityImpact.LOW,
    interpretations: ["option A", "option B"],
  });
  assertEquals(r.success, true);
  if (r.success) assertEquals(r.data.interpretations, ["option A", "option B"]);
});

Deno.test("[AmbiguitySchema] interpretations defaults to empty array when absent", () => {
  const r = AmbiguitySchema.safeParse({ description: "x", impact: AmbiguityImpact.MEDIUM });
  assertEquals(r.success, true);
  if (r.success) assertEquals(r.data.interpretations, []);
});

Deno.test("[AmbiguitySchema] accepts optional clarificationQuestion string", () => {
  const r = AmbiguitySchema.safeParse({
    description: "x",
    impact: AmbiguityImpact.HIGH,
    interpretations: [],
    clarificationQuestion: "What exactly do you mean?",
  });
  assertEquals(r.success, true);
  if (r.success) assertEquals(r.data.clarificationQuestion, "What exactly do you mean?");
});

Deno.test("[AmbiguitySchema] clarificationQuestion absent when not provided", () => {
  const r = AmbiguitySchema.safeParse({ description: "x", impact: AmbiguityImpact.LOW });
  assertEquals(r.success, true);
  if (r.success) assertEquals(r.data.clarificationQuestion, undefined);
});

// RequestTaskType — BUGFIX is canonical, FIX variant removed

Deno.test("[RequestTaskType] does not contain FIX variant — BUGFIX is canonical", () => {
  assertEquals(Object.values(RequestTaskType).includes("fix" as RequestTaskType), false);
  assertEquals(Object.values(RequestTaskType).includes(RequestTaskType.BUGFIX), true);
});

// RequestAnalysisMetadataSchema includes analyzerVersion

Deno.test("[RequestAnalysisMetadataSchema] includes analyzerVersion field with string type", () => {
  const r = RequestAnalysisSchema.safeParse(validAnalysis);
  assertEquals(r.success, true);
  if (r.success) {
    assertExists(r.data.metadata.analyzerVersion);
    assertEquals(typeof r.data.metadata.analyzerVersion, "string");
    assertEquals(r.data.metadata.analyzerVersion.length > 0, true);
  }
});

Deno.test("[RequestAnalysisSchema] allows empty arrays for optional list fields", () => {
  const result = RequestAnalysisSchema.safeParse({
    ...validAnalysis,
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    tags: [],
    referencedFiles: [],
  });
  assertEquals(result.success, true);
});

Deno.test("[RequestAnalysisSchema] validates metadata fields", () => {
  const result = RequestAnalysisSchema.safeParse(validAnalysis);
  assertEquals(result.success, true);
  if (result.success) {
    assertExists(result.data.metadata.analyzedAt);
    assertEquals(typeof result.data.metadata.durationMs, "number");
    assertEquals(result.data.metadata.mode, AnalysisMode.HEURISTIC);
  }
});

Deno.test("[RequestAnalysisSchema] validates all analyzer mode values", () => {
  for (const mode of Object.values(AnalysisMode)) {
    const result = RequestAnalysisSchema.safeParse({
      ...validAnalysis,
      metadata: { ...validAnalysis.metadata, mode },
    });
    assertEquals(result.success, true, `mode=${mode} should be valid`);
  }
});
