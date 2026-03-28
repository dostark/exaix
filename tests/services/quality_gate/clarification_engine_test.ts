/**
 * @module ClarificationEngineTest
 * @path tests/services/quality_gate/clarification_engine_test.ts
 * @description Tests for ClarificationEngine — the multi-turn Q&A loop that
 * refines underspecified requests through iterative planning-agent questioning.
 * @architectural-layer Services
 * @related-files [src/services/quality_gate/clarification_engine.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { createMockProvider } from "../../helpers/mock_provider.ts";
import { createOutputValidator } from "../../../src/services/output_validator.ts";
import {
  ClarificationQuestionCategory,
  ClarificationSessionStatus,
  type IClarificationSession,
} from "../../../src/shared/schemas/clarification_session.ts";
import type { IRequestSpecification } from "../../../src/shared/schemas/request_specification.ts";
import { ClarificationEngine } from "../../../src/services/quality_gate/clarification_engine.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid IRequestSpecification for test assertions. */
function makeSpec(summary: string = "Implement JWT validation"): IRequestSpecification {
  return {
    summary,
    goals: ["Add JWT token validation"],
    successCriteria: ["Returns 401 on invalid token"],
    scope: { includes: ["src/auth.ts"], excludes: [] },
    constraints: [],
    context: [],
    originalBody: "Fix the authentication bug",
  };
}

/** Builds a mock LLM response with questions (not satisfied). */
function makeQuestionsResponse(questionText = "Which files should be modified?"): string {
  return JSON.stringify({
    satisfied: false,
    questions: [
      {
        id: "r1q1",
        question: questionText,
        rationale: "Knowing the affected files helps scope the work accurately.",
        category: ClarificationQuestionCategory.SCOPE,
        required: true,
      },
    ],
  });
}

/** Builds a mock LLM response with agent satisfaction and a refined body. */
function makeSatisfiedResponse(summary = "Implement JWT validation"): string {
  return JSON.stringify({ satisfied: true, refinedBody: makeSpec(summary) });
}

/**
 * Returns a pre-built active session that already has one round of questions
 * (as if startSession was already called). Used for processAnswers tests.
 */
function makeSessionWithRound1(): IClarificationSession {
  return {
    requestId: "req-10",
    originalBody: "Fix the authentication bug in src/auth.ts",
    rounds: [
      {
        round: 1,
        questions: [
          {
            id: "r1q1",
            question: "Which files should be modified?",
            rationale: "Knowing the affected files helps scope the work.",
            category: ClarificationQuestionCategory.SCOPE,
            required: true,
          },
        ],
        askedAt: new Date().toISOString(),
      },
    ],
    status: ClarificationSessionStatus.ACTIVE,
    qualityHistory: [{ round: 0, score: 50, level: "acceptable" }],
  };
}

// ---------------------------------------------------------------------------
// startSession
// ---------------------------------------------------------------------------

Deno.test("[ClarificationEngine] startSession generates Round 1 questions", async () => {
  const engine = new ClarificationEngine(
    createMockProvider([makeQuestionsResponse()]),
    createOutputValidator({}),
    { maxRounds: 3 },
  );

  const session = await engine.startSession("req-10", "Fix the authentication bug in src/auth.ts");

  assertEquals(session.requestId, "req-10");
  assertEquals(session.status, ClarificationSessionStatus.ACTIVE);
  assertEquals(session.rounds.length, 1);
  assertEquals(session.rounds[0].round, 1);
  assertExists(session.rounds[0].questions);
  assertEquals(session.rounds[0].questions.length >= 1, true);
});

Deno.test("[ClarificationEngine] questions include category and rationale", async () => {
  const engine = new ClarificationEngine(
    createMockProvider([
      JSON.stringify({
        satisfied: false,
        questions: [
          {
            id: "r1q1",
            question: "What is the expected behaviour on token expiry?",
            rationale: "Defining the expiry handling is critical for security.",
            category: ClarificationQuestionCategory.ACCEPTANCE,
            required: true,
          },
        ],
      }),
    ]),
    createOutputValidator({}),
    { maxRounds: 3 },
  );

  const session = await engine.startSession("req-10", "Fix the authentication bug");

  const q = session.rounds[0].questions[0];
  assertExists(q.rationale);
  assertEquals(typeof q.rationale, "string");
  assertEquals(q.category, ClarificationQuestionCategory.ACCEPTANCE);
});

// ---------------------------------------------------------------------------
// processAnswers
// ---------------------------------------------------------------------------

Deno.test("[ClarificationEngine] processAnswers incorporates answers", async () => {
  const engine = new ClarificationEngine(
    createMockProvider([makeQuestionsResponse("Any constraints on libraries?")]),
    createOutputValidator({}),
    { maxRounds: 3 },
  );

  const answers = { "r1q1": "src/auth.ts and src/middleware/jwt.ts" };
  const updated = await engine.processAnswers(makeSessionWithRound1(), answers);

  assertEquals(updated.rounds[0].answers, answers);
  assertExists(updated.rounds[0].answeredAt);
});

Deno.test("[ClarificationEngine] tracks quality score across rounds", async () => {
  const engine = new ClarificationEngine(
    createMockProvider([makeSatisfiedResponse()]),
    createOutputValidator({}),
    { maxRounds: 3 },
  );

  const session = makeSessionWithRound1();
  const updated = await engine.processAnswers(session, { "r1q1": "src/auth.ts" });

  assertEquals(updated.qualityHistory.length >= 2, true);
});

Deno.test("[ClarificationEngine] finalizes when agent satisfied", async () => {
  const engine = new ClarificationEngine(
    createMockProvider([makeSatisfiedResponse("Implement JWT validation in src/auth.ts")]),
    createOutputValidator({}),
    { maxRounds: 3 },
  );

  const finalized = await engine.processAnswers(makeSessionWithRound1(), { "r1q1": "src/auth.ts" });

  assertEquals(finalized.status, ClarificationSessionStatus.AGENT_SATISFIED);
  assertExists(finalized.refinedBody);
  assertEquals(finalized.refinedBody?.summary, "Implement JWT validation in src/auth.ts");
});

Deno.test("[ClarificationEngine] finalizes when max rounds reached", async () => {
  // maxRounds: 1, session already has round 1 → next processAnswers should hit the limit
  const engine = new ClarificationEngine(
    createMockProvider([makeQuestionsResponse()]),
    createOutputValidator({}),
    { maxRounds: 1 },
  );

  const finalized = await engine.processAnswers(makeSessionWithRound1(), { "r1q1": "src/auth.ts" });

  assertEquals(finalized.status, ClarificationSessionStatus.MAX_ROUNDS);
});

Deno.test("[ClarificationEngine] generates IRequestSpecification from Q&A", async () => {
  const spec = makeSpec("Add JWT token validation to authenticate API requests");
  const engine = new ClarificationEngine(
    createMockProvider([JSON.stringify({ satisfied: true, refinedBody: spec })]),
    createOutputValidator({}),
    { maxRounds: 3 },
  );

  const finalized = await engine.processAnswers(makeSessionWithRound1(), { "r1q1": "src/auth.ts" });

  assertExists(finalized.refinedBody);
  assertEquals(finalized.refinedBody?.goals.length >= 1, true);
  assertEquals(finalized.refinedBody?.successCriteria.length >= 1, true);
  assertExists(finalized.refinedBody?.scope);
});

// ---------------------------------------------------------------------------
// cancel / isComplete
// ---------------------------------------------------------------------------

Deno.test("[ClarificationEngine] supports user cancellation", () => {
  const engine = new ClarificationEngine(
    createMockProvider([]),
    createOutputValidator({}),
    { maxRounds: 3 },
  );

  const session = makeSessionWithRound1();
  const cancelled = engine.cancel(session);

  assertEquals(cancelled.status, ClarificationSessionStatus.USER_CANCELLED);
});

// ---------------------------------------------------------------------------
// Error resilience
// ---------------------------------------------------------------------------

Deno.test("[ClarificationEngine] handles LLM failure in question generation", async () => {
  const failingProvider = {
    id: "failing",
    generate: (_prompt: string): Promise<string> => Promise.reject(new Error("LLM unavailable")),
  };

  const engine = new ClarificationEngine(failingProvider, createOutputValidator({}), { maxRounds: 3 });

  // Should not throw — session is created with fallback empty questions
  const session = await engine.startSession("req-10", "Fix the authentication bug in src/auth.ts");

  assertExists(session);
  assertEquals(session.requestId, "req-10");
  assertEquals(session.status, ClarificationSessionStatus.ACTIVE);
});
