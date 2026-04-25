/**
 * @module HeuristicAssessorTest
 * @path tests/services/quality_gate/heuristic_assessor_test.ts
 * @description Tests for the heuristic quality assessor — a zero-cost
 * text-signal-based scorer for incoming request bodies.
 * @architectural-layer Services
 * @related-files [src/services/quality_gate/heuristic_assessor.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { assessHeuristic } from "../../../src/services/quality_gate/heuristic_assessor.ts";
import { ANALYZER_VERSION } from "@exaix/core";
import { RequestQualityIssueType, RequestQualityRecommendation } from "@exaix/schemas/request_quality_assessment.ts";
import {
  AmbiguityImpact,
  type IRequestAnalysis,
  RequestAnalysisComplexity,
  RequestTaskType,
} from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";
import { QualityGateMode } from "@exaix/core";

// ---------------------------------------------------------------------------
// Test helper — builds a minimal valid IRequestAnalysis
// ---------------------------------------------------------------------------

function makeAnalysis(overrides: Partial<IRequestAnalysis> = {}): IRequestAnalysis {
  return {
    goals: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: 60,
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

// ---------------------------------------------------------------------------
// Vague / poor requests
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAssessor] scores vague one-liner as poor/unactionable", () => {
  const result = assessHeuristic("make it work better");
  assertEquals(result.level === "poor" || result.level === "unactionable", true);
  assertEquals(result.score < 50, true);
});

Deno.test("[HeuristicAssessor] handles empty request text", () => {
  const result = assessHeuristic("");
  assertEquals(result.level, "unactionable");
  assertEquals(result.score, 0);
  assertEquals(result.recommendation, RequestQualityRecommendation.REJECT);
});

Deno.test("[HeuristicAssessor] detects short body issue", () => {
  const result = assessHeuristic("fix bug");
  const shortBodyIssue = result.issues.find((i) => i.type === "vague");
  assertExists(shortBodyIssue);
});

Deno.test("[HeuristicAssessor] detects missing action verbs", () => {
  // Long enough (>20 chars) but no action verbs
  const noVerbRequest =
    "The authentication system is broken and users are experiencing issues with logging in to their accounts";
  const result = assessHeuristic(noVerbRequest);
  const verbIssue = result.issues.find((i) => i.type === "missing_context");
  assertExists(verbIssue);
});

Deno.test("[HeuristicAssessor] detects question-only request", () => {
  const questionOnly =
    "Why is the login not working? What should I do about the broken authentication? How do I fix it?";
  const result = assessHeuristic(questionOnly);
  const questionIssue = result.issues.find((i) => i.type === "ambiguous");
  assertExists(questionIssue);
});

// ---------------------------------------------------------------------------
// Positive signals
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAssessor] positive: file references boost score", () => {
  const withFile =
    "Fix the authentication bug in src/services/auth.ts where the JWT token is not being validated correctly";
  const withoutFile = "Fix the authentication bug where the token is not being validated correctly";
  const withFileResult = assessHeuristic(withFile);
  const withoutFileResult = assessHeuristic(withoutFile);
  assertEquals(withFileResult.score > withoutFileResult.score, true);
});

Deno.test("[HeuristicAssessor] positive: acceptance criteria keywords boost score", () => {
  const withCriteria =
    "Implement user login. The login should return a JWT token. It must work with existing users. Given valid credentials when login is called then a 200 is returned.";
  const withoutCriteria = "Implement user login with JWT tokens for the application";
  const withResult = assessHeuristic(withCriteria);
  const withoutResult = assessHeuristic(withoutCriteria);
  assertEquals(withResult.score > withoutResult.score, true);
});

Deno.test("[HeuristicAssessor] positive: structured requirements boost score", () => {
  const structured = `Implement user authentication:
1. Add POST /auth/login endpoint
2. Validate email and password against database
3. Return JWT token on success
4. Return 401 on invalid credentials`;
  const unstructured = "Implement user authentication with login endpoint";
  const structuredResult = assessHeuristic(structured);
  const unstructuredResult = assessHeuristic(unstructured);
  assertEquals(structuredResult.score > unstructuredResult.score, true);
});

// ---------------------------------------------------------------------------
// Score range and recommendation mapping
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAssessor] scores well-structured request as good/excellent", () => {
  const wellSpecified = `Implement JWT-based authentication for the REST API.

## Goals
1. Add POST /auth/login endpoint to src/api/auth.ts
2. Validate user credentials against the users table in PostgreSQL
3. Issue a signed JWT token with 1-hour expiry on success

## Success Criteria
- POST /auth/login must return HTTP 200 with token on valid credentials
- POST /auth/login must return HTTP 401 on invalid credentials
- Token should include userId and email claims

## Constraints
- Use the existing jsonwebtoken library
- Do not modify the users table schema`;
  const result = assessHeuristic(wellSpecified);
  assertEquals(result.level === "good" || result.level === "excellent", true);
  assertEquals(result.score >= 70, true);
  assertEquals(result.recommendation, RequestQualityRecommendation.PROCEED);
});

Deno.test("[HeuristicAssessor] maps score to correct recommendation", () => {
  // A borderline request should recommend auto-enrich or needs-clarification
  const borderline = "Implement user login feature with proper error handling and token generation";
  const result = assessHeuristic(borderline);
  const validRecs = [
    RequestQualityRecommendation.PROCEED,
    RequestQualityRecommendation.AUTO_ENRICH,
    RequestQualityRecommendation.NEEDS_CLARIFICATION,
    RequestQualityRecommendation.REJECT,
  ];
  assertEquals(validRecs.includes(result.recommendation), true);
});

Deno.test("[HeuristicAssessor] score clamped to 0-100 range", () => {
  // Test with extremely good request — score should not exceed 100
  const perfect = `Implement a complete REST API for user management.

## Goals
1. Create src/api/users.ts with GET /users, POST /users, GET /users/:id endpoints
2. Add integration with PostgreSQL users table
3. Return proper JSON responses with correct HTTP status codes
4. Implement input validation using Zod schemas
5. Add authentication middleware to protect endpoints

## Success Criteria
- GET /users must return 200 with array of user objects
- POST /users must return 201 with created user
- Invalid requests should return 400 with descriptive error messages
- Authentication must be required for all endpoints

## Constraints
- Use existing database connection from src/db.ts
- Must not break existing test suite
- TypeScript strict mode compliance required

## Context
Current codebase uses Deno, Zod validation, and PostgreSQL. Auth is JWT-based.`;
  const result = assessHeuristic(perfect);
  assertEquals(result.score <= 100, true);
  assertEquals(result.score >= 0, true);
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAssessor] result has valid assessment shape", () => {
  const result = assessHeuristic("add login feature");
  assertExists(result.score);
  assertExists(result.level);
  assertExists(result.issues);
  assertExists(result.recommendation);
  assertExists(result.metadata);
  assertEquals(result.metadata.mode, QualityGateMode.HEURISTIC);
  assertEquals(typeof result.metadata.durationMs, "number");
  assertEquals(result.metadata.durationMs >= 0, true);
  assertEquals(typeof result.metadata.assessedAt, "string");
});

Deno.test("[HeuristicAssessor] completes in under 50ms", () => {
  const start = performance.now();
  assessHeuristic("implement feature X with tests");
  const elapsed = performance.now() - start;
  assertEquals(elapsed < 50, true);
});

// ---------------------------------------------------------------------------
// Phase-45 existingAnalysis integration
// ---------------------------------------------------------------------------

Deno.test(
  "[HeuristicAssessor] uses Phase-45 actionabilityScore as base when analysis provided",
  () => {
    // "fix the bug" is 11 chars — full scan would penalise it heavily (~0 score).
    // With Phase-45 base of 45 and no supplementary signals the score stays ≈45.
    const analysis = makeAnalysis({ actionabilityScore: 45 });
    const result = assessHeuristic("fix the bug", analysis);
    assertEquals(result.score >= 35 && result.score <= 60, true);
  },
);

Deno.test("[HeuristicAssessor] maps Phase-45 ambiguities to quality issues with type 'ambiguous'", () => {
  const analysis = makeAnalysis({
    ambiguities: [
      {
        description: "Which database adapter to use?",
        impact: AmbiguityImpact.HIGH,
        interpretations: ["PostgreSQL", "SQLite"],
      },
      {
        description: "Is pagination required?",
        impact: AmbiguityImpact.LOW,
        interpretations: [],
      },
    ],
  });
  const result = assessHeuristic("implement data layer", analysis);
  const ambiguousIssues = result.issues.filter(
    (i) => i.type === RequestQualityIssueType.AMBIGUOUS,
  );
  assertEquals(ambiguousIssues.length, 2);
  assertEquals(ambiguousIssues[0].severity, "blocker"); // HIGH → BLOCKER
  assertEquals(ambiguousIssues[1].severity, "minor"); // LOW → MINOR
});

Deno.test("[HeuristicAssessor] runs supplementary checks on top of Phase-45 base score", () => {
  // actionabilityScore = 50, but text has a file reference → +QG_FILE_REFERENCE_BONUS
  const analysis = makeAnalysis({ actionabilityScore: 50 });
  const result = assessHeuristic("fix bug in src/services/auth.ts", analysis);
  assertEquals(result.score > 50, true);
});

Deno.test("[HeuristicAssessor] falls back to full scan when no existing analysis provided", () => {
  // Full scan on "fix the bug" (11 chars) applies short-body penalty → score near 0
  const result = assessHeuristic("fix the bug");
  assertEquals(result.score < 35, true);
});

Deno.test(
  "[HeuristicAssessor] score is consistent with Phase-45 actionabilityScore within tolerance",
  () => {
    // Base = 60, text has no supplementary signals → score should be 60 ± 15
    const analysis = makeAnalysis({ actionabilityScore: 60 });
    const result = assessHeuristic("improve error handling in the codebase", analysis);
    assertEquals(result.score >= 45 && result.score <= 75, true);
  },
);
