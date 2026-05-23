/**
 * @module RequestQualityAssessmentSchemaTest
 * @path packages/schemas/tests/request_quality_assessment_test.ts
 * @description Tests for the RequestQualityAssessmentSchema and
 * RequestQualityIssueSchema, verifying validation of quality scores,
 * enum values, and metadata fields.
 * @architectural-layer Shared
 * @related-files [packages/schemas/src/request_quality_assessment.ts]
 */

import { assertEquals } from "@std/assert";
import { RequestQualityAssessmentSchema, RequestQualityIssueSchema } from "@exaix/schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validIssue() {
  return {
    type: "vague",
    description: "Request body is too vague",
    severity: "major",
    suggestion: "Add specific file names and acceptance criteria",
  };
}

function validAssessment() {
  return {
    score: 45,
    level: "acceptable",
    issues: [validIssue()],
    recommendation: "auto-enrich",
    metadata: {
      assessedAt: "2026-03-14T10:00:00.000Z",
      mode: "heuristic",
      durationMs: 3,
    },
  };
}

// ---------------------------------------------------------------------------
// RequestQualityIssueSchema
// ---------------------------------------------------------------------------

Deno.test("[RequestQualityIssueSchema] validates individual issue", () => {
  const result = RequestQualityIssueSchema.safeParse(validIssue());
  assertEquals(result.success, true);
});

Deno.test("[RequestQualityIssueSchema] rejects unknown type value", () => {
  const result = RequestQualityIssueSchema.safeParse({
    ...validIssue(),
    type: "totally_wrong",
  });
  assertEquals(result.success, false);
});

Deno.test("[RequestQualityIssueSchema] rejects unknown severity value", () => {
  const result = RequestQualityIssueSchema.safeParse({
    ...validIssue(),
    severity: "critical",
  });
  assertEquals(result.success, false);
});

Deno.test("[RequestQualityIssueSchema] validates all issue type enum values", () => {
  const types = [
    "vague",
    "ambiguous",
    "missing_context",
    "conflicting",
    "too_broad",
    "no_acceptance_criteria",
  ];
  for (const type of types) {
    const result = RequestQualityIssueSchema.safeParse({ ...validIssue(), type });
    assertEquals(result.success, true, `type "${type}" should be valid`);
  }
});

Deno.test("[RequestQualityIssueSchema] validates all severity enum values", () => {
  const severities = ["blocker", "major", "minor"];
  for (const severity of severities) {
    const result = RequestQualityIssueSchema.safeParse({ ...validIssue(), severity });
    assertEquals(result.success, true, `severity "${severity}" should be valid`);
  }
});

// ---------------------------------------------------------------------------
// RequestQualityAssessmentSchema
// ---------------------------------------------------------------------------

Deno.test("[RequestQualityAssessmentSchema] validates complete valid assessment", () => {
  const result = RequestQualityAssessmentSchema.safeParse(validAssessment());
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.score, 45);
    assertEquals(result.data.level, "acceptable");
    assertEquals(result.data.issues.length, 1);
    assertEquals(result.data.recommendation, "auto-enrich");
  }
});

Deno.test("[RequestQualityAssessmentSchema] rejects score outside 0-100", () => {
  assertEquals(
    RequestQualityAssessmentSchema.safeParse({ ...validAssessment(), score: -1 }).success,
    false,
  );
  assertEquals(
    RequestQualityAssessmentSchema.safeParse({ ...validAssessment(), score: 101 }).success,
    false,
  );
});

Deno.test("[RequestQualityAssessmentSchema] validates score at boundaries (0, 100)", () => {
  assertEquals(
    RequestQualityAssessmentSchema.safeParse({ ...validAssessment(), score: 0 }).success,
    true,
  );
  assertEquals(
    RequestQualityAssessmentSchema.safeParse({ ...validAssessment(), score: 100 }).success,
    true,
  );
});

Deno.test("[RequestQualityAssessmentSchema] validates all level enum values", () => {
  const levels = ["excellent", "good", "acceptable", "poor", "unactionable"];
  for (const level of levels) {
    const result = RequestQualityAssessmentSchema.safeParse({ ...validAssessment(), level });
    assertEquals(result.success, true, `level "${level}" should be valid`);
  }
});

Deno.test("[RequestQualityAssessmentSchema] rejects unknown level value", () => {
  const result = RequestQualityAssessmentSchema.safeParse({
    ...validAssessment(),
    level: "amazing",
  });
  assertEquals(result.success, false);
});

Deno.test("[RequestQualityAssessmentSchema] validates all recommendation enum values", () => {
  const recommendations = ["proceed", "auto-enrich", "needs-clarification", "reject"];
  for (const recommendation of recommendations) {
    const result = RequestQualityAssessmentSchema.safeParse({
      ...validAssessment(),
      recommendation,
    });
    assertEquals(result.success, true, `recommendation "${recommendation}" should be valid`);
  }
});

Deno.test("[RequestQualityAssessmentSchema] rejects unknown recommendation value", () => {
  const result = RequestQualityAssessmentSchema.safeParse({
    ...validAssessment(),
    recommendation: "maybe",
  });
  assertEquals(result.success, false);
});

Deno.test("[RequestQualityAssessmentSchema] validates metadata fields", () => {
  const result = RequestQualityAssessmentSchema.safeParse(validAssessment());
  assertEquals(result.success, true);
  if (result.success) {
    const { metadata } = result.data;
    assertEquals(metadata.mode, "heuristic");
    assertEquals(metadata.durationMs, 3);
    assertEquals(typeof metadata.assessedAt, "string");
  }
});

Deno.test("[RequestQualityAssessmentSchema] rejects unknown metadata mode value", () => {
  const result = RequestQualityAssessmentSchema.safeParse({
    ...validAssessment(),
    metadata: { ...validAssessment().metadata, mode: "magic" },
  });
  assertEquals(result.success, false);
});

Deno.test("[RequestQualityAssessmentSchema] allows optional enrichedBody", () => {
  const withEnriched = {
    ...validAssessment(),
    enrichedBody: "## Improved Request\nPlease implement feature X with tests.",
  };
  const result = RequestQualityAssessmentSchema.safeParse(withEnriched);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.enrichedBody, "## Improved Request\nPlease implement feature X with tests.");
  }
});

Deno.test("[RequestQualityAssessmentSchema] allows empty issues array", () => {
  const result = RequestQualityAssessmentSchema.safeParse({
    ...validAssessment(),
    issues: [],
  });
  assertEquals(result.success, true);
});

Deno.test("[RequestQualityAssessmentSchema] validates metadata mode: llm and hybrid", () => {
  for (const mode of ["llm", "hybrid"]) {
    const result = RequestQualityAssessmentSchema.safeParse({
      ...validAssessment(),
      metadata: { ...validAssessment().metadata, mode },
    });
    assertEquals(result.success, true, `mode "${mode}" should be valid`);
  }
});
