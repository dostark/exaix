/**
 * @module ConfidenceScorerAlignmentTest
 * @path tests/services/confidence_scorer_alignment_test.ts
 * @description Tests that ConfidenceScorer factors in goal-alignment data from a
 * ReflexiveAgent critique (Phase 48, Step 9).
 */

import { assertEquals, assertGreater, assertLess } from "@std/assert";
import { ConfidenceAssessmentLevel, CritiqueQuality } from "../../../src/shared/enums.ts";
import { createConfidenceScorer } from "../../../src/services/confidence_scorer.ts";
import type { ICritique } from "../../../src/services/reflexive_agent.ts";
import { EXISTING_SCORE_CONFIDENCE_WEIGHT, GOAL_ALIGNMENT_CONFIDENCE_WEIGHT } from "../../../src/shared/constants.ts";
import { createMockProvider } from "../../helpers/mock_provider.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfidenceJSON(score: number): string {
  const level = score >= 70 ? ConfidenceAssessmentLevel.HIGH : ConfidenceAssessmentLevel.MEDIUM;
  return JSON.stringify({
    score,
    level,
    reasoning: "Test",
    factors: [],
    uncertainty_areas: [],
    requires_review: false,
  });
}

function makeCritique(
  statuses: Array<"MET" | "PARTIAL" | "MISSING">,
): ICritique {
  return {
    quality: CritiqueQuality.GOOD,
    confidence: 80,
    passed: true,
    reasoning: "Test critique",
    issues: [],
    requirementsFulfillment: statuses.map((status, i) => ({
      requirement: `req_${i}`,
      status,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "[ConfidenceScorer] includes goal alignment factor when critique with fulfillment available",
  async () => {
    const RAW_SCORE = 80;
    const scorer = createConfidenceScorer(
      createMockProvider([makeConfidenceJSON(RAW_SCORE)]),
    );

    const allMetCritique = makeCritique(["MET", "MET", "MET"]);
    const result = await scorer.assess("q", "r", undefined, allMetCritique);

    // goalAlignmentScore = 1.0  →  finalScore = 80*0.7 + 1.0*0.3*100 = 56+30 = 86
    const expected = Math.round(
      RAW_SCORE * EXISTING_SCORE_CONFIDENCE_WEIGHT +
        1.0 * GOAL_ALIGNMENT_CONFIDENCE_WEIGHT * 100,
    );
    assertEquals(result.confidence.score, expected);
  },
);

Deno.test(
  "[ConfidenceScorer] higher goalAlignmentScore increases confidence",
  async () => {
    const RAW_SCORE = 70;
    const scorer = createConfidenceScorer(
      createMockProvider([
        makeConfidenceJSON(RAW_SCORE),
        makeConfidenceJSON(RAW_SCORE),
      ]),
    );

    const allMet = makeCritique(["MET", "MET"]);
    const allMissing = makeCritique(["MISSING", "MISSING"]);

    const resultHigh = await scorer.assess("q", "r", undefined, allMet);
    const resultLow = await scorer.assess("q", "r", undefined, allMissing);

    assertGreater(resultHigh.confidence.score, resultLow.confidence.score);
  },
);

Deno.test(
  "[ConfidenceScorer] zero goalAlignmentScore decreases confidence",
  async () => {
    const RAW_SCORE = 80;
    const scorer = createConfidenceScorer(
      createMockProvider([makeConfidenceJSON(RAW_SCORE)]),
    );

    const allMissingCritique = makeCritique(["MISSING", "MISSING", "MISSING"]);
    const result = await scorer.assess("q", "r", undefined, allMissingCritique);

    // goalAlignmentScore = 0  →  finalScore = 80*0.7 + 0*0.3*100 = 56
    const expected = Math.round(
      RAW_SCORE * EXISTING_SCORE_CONFIDENCE_WEIGHT +
        0 * GOAL_ALIGNMENT_CONFIDENCE_WEIGHT * 100,
    );
    assertLess(result.confidence.score, RAW_SCORE);
    assertEquals(result.confidence.score, expected);
  },
);

Deno.test(
  "[ConfidenceScorer] absent critique produces no penalty (score unchanged)",
  async () => {
    const RAW_SCORE = 65;
    const scorer = createConfidenceScorer(
      createMockProvider([makeConfidenceJSON(RAW_SCORE)]),
    );

    const result = await scorer.assess("q", "r");

    assertEquals(result.confidence.score, RAW_SCORE);
  },
);

Deno.test(
  "[ConfidenceScorer] numeric regression: assess without critique matches pre-Phase-48 formula",
  async () => {
    const FIXTURE_SCORE = 72;
    const scorer = createConfidenceScorer(
      createMockProvider([makeConfidenceJSON(FIXTURE_SCORE)]),
    );

    const result = await scorer.assess(
      "What is 2+2?",
      "The answer is 4.",
      "trace-123",
    );

    assertEquals(result.confidence.score, FIXTURE_SCORE);
  },
);

Deno.test(
  "[ConfidenceScorer] respects configurable weight split",
  async () => {
    const RAW_SCORE = 60;
    const CUSTOM_EXISTING = 0.5;
    const CUSTOM_GOAL = 0.5;

    const scorer = createConfidenceScorer(
      createMockProvider([makeConfidenceJSON(RAW_SCORE)]),
      {
        existingScoreWeight: CUSTOM_EXISTING,
        goalAlignmentWeight: CUSTOM_GOAL,
      },
    );

    const allMetCritique = makeCritique(["MET", "MET"]);
    const result = await scorer.assess("q", "r", undefined, allMetCritique);

    // goalAlignmentScore = 1.0  →  finalScore = 60*0.5 + 1.0*0.5*100 = 30+50 = 80
    const expected = Math.round(
      RAW_SCORE * CUSTOM_EXISTING + 1.0 * CUSTOM_GOAL * 100,
    );
    assertEquals(result.confidence.score, expected);
  },
);
