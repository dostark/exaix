/**
 * @module ClarificationSessionSchemaTest
 * @path packages/schemas/tests/clarification_session_test.ts
 * @description Tests for the ClarificationSessionSchema and sub-schemas,
 * verifying validation of the multi-turn clarification Q&A loop data model.
 * @architectural-layer Shared
 * @related-files [packages/schemas/src/clarification_session.ts]
 */

import { assertEquals } from "@std/assert";
import { ClarificationQuestionSchema, ClarificationRoundSchema, ClarificationSessionSchema } from "@exaix/schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validQuestion() {
  return {
    id: "q1",
    question: "What specific endpoints need to be implemented?",
    rationale: "Needed to scope implementation work accurately",
    category: "scope",
    required: true,
  };
}

function validRound() {
  return {
    round: 1,
    questions: [validQuestion()],
    askedAt: "2026-03-14T10:00:00.000Z",
  };
}

function validRoundWithAnswers() {
  return {
    ...validRound(),
    answers: { q1: "GET /users and POST /users only" },
    answeredAt: "2026-03-14T10:05:00.000Z",
  };
}

function validSession() {
  return {
    requestId: "req-001",
    originalBody: "add users to the app",
    rounds: [validRoundWithAnswers()],
    status: "active",
    qualityHistory: [{ round: 1, score: 30, level: "poor" }],
  };
}

// ---------------------------------------------------------------------------
// ClarificationQuestionSchema
// ---------------------------------------------------------------------------

Deno.test("[ClarificationQuestionSchema] validates a valid question", () => {
  const result = ClarificationQuestionSchema.safeParse(validQuestion());
  assertEquals(result.success, true);
});

Deno.test("[ClarificationQuestionSchema] validates all category values", () => {
  const categories = ["goal", "scope", "constraint", "acceptance", "context", "priority"];
  for (const category of categories) {
    const result = ClarificationQuestionSchema.safeParse({ ...validQuestion(), category });
    assertEquals(result.success, true, `category "${category}" should be valid`);
  }
});

Deno.test("[ClarificationQuestionSchema] rejects unknown category value", () => {
  const result = ClarificationQuestionSchema.safeParse({
    ...validQuestion(),
    category: "timeline",
  });
  assertEquals(result.success, false);
});

// ---------------------------------------------------------------------------
// ClarificationRoundSchema
// ---------------------------------------------------------------------------

Deno.test("[ClarificationRoundSchema] validates round without answers", () => {
  const result = ClarificationRoundSchema.safeParse(validRound());
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.answers, undefined);
    assertEquals(result.data.answeredAt, undefined);
  }
});

Deno.test("[ClarificationRoundSchema] validates round with answers", () => {
  const result = ClarificationRoundSchema.safeParse(validRoundWithAnswers());
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.answers?.["q1"], "GET /users and POST /users only");
  }
});

Deno.test("[ClarificationRoundSchema] rejects round number below 1", () => {
  const result = ClarificationRoundSchema.safeParse({ ...validRound(), round: 0 });
  assertEquals(result.success, false);
});

// ---------------------------------------------------------------------------
// ClarificationSessionSchema
// ---------------------------------------------------------------------------

Deno.test("[ClarificationSessionSchema] validates complete session", () => {
  const result = ClarificationSessionSchema.safeParse(validSession());
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.requestId, "req-001");
    assertEquals(result.data.rounds.length, 1);
    assertEquals(result.data.status, "active");
  }
});

Deno.test("[ClarificationSessionSchema] validates session with multiple rounds", () => {
  const session = {
    ...validSession(),
    rounds: [validRoundWithAnswers(), { ...validRound(), round: 2 }],
    qualityHistory: [
      { round: 1, score: 30, level: "poor" },
      { round: 2, score: 55, level: "acceptable" },
    ],
  };
  const result = ClarificationSessionSchema.safeParse(session);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.rounds.length, 2);
    assertEquals(result.data.qualityHistory.length, 2);
  }
});

Deno.test("[ClarificationSessionSchema] validates all session status values", () => {
  const statuses = [
    "active",
    "user-confirmed",
    "agent-satisfied",
    "max-rounds",
    "user-cancelled",
  ];
  for (const status of statuses) {
    const result = ClarificationSessionSchema.safeParse({ ...validSession(), status });
    assertEquals(result.success, true, `status "${status}" should be valid`);
  }
});

Deno.test("[ClarificationSessionSchema] rejects unknown session status", () => {
  const result = ClarificationSessionSchema.safeParse({
    ...validSession(),
    status: "pending",
  });
  assertEquals(result.success, false);
});

Deno.test("[ClarificationSessionSchema] allows optional refinedBody", () => {
  const withRefined = {
    ...validSession(),
    refinedBody: {
      summary: "Add user CRUD endpoints",
      goals: ["GET /users", "POST /users"],
      successCriteria: ["Returns 200 on success"],
      scope: { includes: ["users table"], excludes: [] },
      constraints: [],
      context: [],
      originalBody: "add users to the app",
    },
  };
  const result = ClarificationSessionSchema.safeParse(withRefined);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.refinedBody?.summary, "Add user CRUD endpoints");
  }
});

Deno.test("[ClarificationSessionSchema] allows empty rounds array", () => {
  const result = ClarificationSessionSchema.safeParse({
    ...validSession(),
    rounds: [],
  });
  assertEquals(result.success, true);
});
