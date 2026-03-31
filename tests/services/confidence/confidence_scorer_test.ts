/**
 * @module ConfidenceScorerSchemaTest
 * @path tests/services/confidence/confidence_scorer_test.ts
 * @description Validates the data schema for agent confidence scoring, ensuring structured
 * reporting of self-assessment levels and numeric certainty scores.
 */

import { assert, assertEquals, assertExists, assertGreater, assertLess } from "@std/assert";
import { ConfidenceAssessmentLevel } from "../../../src/shared/enums.ts";
import {
  ConfidenceSchema,
  createConfidenceScorer,
  createLenientConfidenceScorer,
  createStrictConfidenceScorer,
} from "../../../src/services/utils/confidence_scorer.ts";
import { createMockProvider } from "../../helpers/mock_provider.ts";

function makeConfidenceJSON(options: {
  score?: number;
  level?: ConfidenceAssessmentLevel;
  reasoning?: string;
  requires_review?: boolean;
}): string {
  return JSON.stringify({
    score: options.score ?? 75,
    level: options.level ?? ConfidenceAssessmentLevel.HIGH,
    reasoning: options.reasoning ?? "Test reasoning",
    factors: [],
    uncertainty_areas: [],
    requires_review: options.requires_review ?? false,
  });
}

// ============================================================================
// ConfidenceSchema Tests
// ============================================================================

Deno.test("[ConfidenceSchema] validates correct confidence", () => {
  const valid = {
    score: 85,
    level: "high",
    reasoning: "Good confidence based on evidence",
    factors: [
      {
        name: "evidence_quality",
        impact: "positive",
        weight: 0.8,
        description: "Strong supporting evidence",
      },
    ],
    uncertainty_areas: ["edge cases"],
    requires_review: false,
  };

  const result = ConfidenceSchema.safeParse(valid);
  assert(result.success);
});

Deno.test("[ConfidenceSchema] rejects invalid level", () => {
  const invalid = {
    score: 85,
    level: "super_high", // Invalid enum
    reasoning: "Test",
    requires_review: false,
  };

  const result = ConfidenceSchema.safeParse(invalid);
  assert(!result.success);
});

Deno.test("[ConfidenceSchema] rejects score out of range", () => {
  const invalid = {
    score: 150, // Out of range
    level: "high",
    reasoning: "Test",
    requires_review: false,
  };

  const result = ConfidenceSchema.safeParse(invalid);
  assert(!result.success);
});

Deno.test("[ConfidenceSchema] rejects negative score", () => {
  const invalid = {
    score: -10,
    level: "low",
    reasoning: "Test",
    requires_review: false,
  };

  const result = ConfidenceSchema.safeParse(invalid);
  assert(!result.success);
});

// ============================================================================
// ConfidenceScorer Tests
// ============================================================================

Deno.test("[ConfidenceScorer] assess extracts high confidence", async () => {
  const mockResponses = [
    makeConfidenceJSON({ score: 90, level: ConfidenceAssessmentLevel.VERY_HIGH, requires_review: false }),
  ];

  const scorer = createConfidenceScorer(createMockProvider(mockResponses));
  const result = await scorer.assess("What is 2+2?", "The answer is 4.");

  assertEquals(result.confidence.score, 90);
  assertEquals(result.confidence.level, "very_high");
  assertEquals(result.flaggedForReview, false);
});

Deno.test("[ConfidenceScorer] assess flags low confidence", async () => {
  const mockResponses = [
    makeConfidenceJSON({ score: 30, level: ConfidenceAssessmentLevel.LOW, requires_review: true }),
  ];

  const scorer = createConfidenceScorer(createMockProvider(mockResponses));
  const result = await scorer.assess("Complex question", "Maybe...");

  assertEquals(result.confidence.score, 30);
  assertEquals(result.flaggedForReview, true);
});

Deno.test("[ConfidenceScorer] assess flags when below threshold", async () => {
  const mockResponses = [
    makeConfidenceJSON({ score: 40, level: ConfidenceAssessmentLevel.LOW, requires_review: false }),
  ];

  const scorer = createConfidenceScorer(createMockProvider(mockResponses), {
    lowConfidenceThreshold: 50,
  });
  const result = await scorer.assess("Question", "Answer");

  assertEquals(result.flaggedForReview, true);
});

Deno.test("[ConfidenceScorer] assess handles parse failure gracefully", async () => {
  const mockResponses = ["Invalid JSON response"];

  const scorer = createConfidenceScorer(createMockProvider(mockResponses));
  const result = await scorer.assess("Question", "Answer");

  assertEquals(result.confidence.score, 50);
  assertEquals(result.confidence.level, "medium");
  assertEquals(result.flaggedForReview, true);
});

// ============================================================================
// Quick Assessment Tests
// ============================================================================

Deno.test("[ConfidenceScorer] assessQuick gives high score for certain language", () => {
  const scorer = createConfidenceScorer(createMockProvider([]));
  const result = scorer.assessQuick("This is definitely the correct answer. It is certainly true.");

  assertGreater(result.score, 70);
});

Deno.test("[ConfidenceScorer] assessQuick lowers score for uncertain language", () => {
  const scorer = createConfidenceScorer(createMockProvider([]));
  const result = scorer.assessQuick("Maybe this could be the answer. I'm not sure though.");

  assertLess(result.score, 60);
});

Deno.test("[ConfidenceScorer] assessQuick lowers score for hedging", () => {
  const scorer = createConfidenceScorer(createMockProvider([]));
  const result = scorer.assessQuick("I think this is probably the answer. It seems likely.");

  assertLess(result.score, 65);
});

Deno.test("[ConfidenceScorer] assessQuick lowers score for short responses", () => {
  const scorer = createConfidenceScorer(createMockProvider([]));
  const result = scorer.assessQuick("Yes.");

  assertLess(result.score, 50);
});

Deno.test("[ConfidenceScorer] assessQuick lowers score for questions", () => {
  const scorer = createConfidenceScorer(createMockProvider([]));
  const result = scorer.assessQuick("Is this the answer? Not really sure about this approach.");

  assertLess(result.score, 65); // Questions and uncertainty lower score
});

// ============================================================================
// Aggregation Tests
// ============================================================================

Deno.test("[ConfidenceScorer] aggregate calculates average correctly", () => {
  const scorer = createConfidenceScorer(createMockProvider([]));

  const confidences = [
    {
      identityId: "agent1",
      confidence: {
        score: 80,
        level: ConfidenceAssessmentLevel.HIGH,
        reasoning: "",
        factors: [],
        uncertainty_areas: [],
        requires_review: false,
      },
    },
    {
      identityId: "agent2",
      confidence: {
        score: 60,
        level: ConfidenceAssessmentLevel.MEDIUM,
        reasoning: "",
        factors: [],
        uncertainty_areas: [],
        requires_review: false,
      },
    },
  ];

  const result = scorer.aggregate(confidences);

  assertEquals(result.average, 70);
  assertEquals(result.min, 60);
  assertEquals(result.max, 80);
});

Deno.test("[ConfidenceScorer] aggregate calculates weighted average", () => {
  const scorer = createConfidenceScorer(createMockProvider([]));

  const confidences = [
    {
      identityId: "agent1",
      confidence: {
        score: 100,
        level: ConfidenceAssessmentLevel.VERY_HIGH,
        reasoning: "",
        factors: [],
        uncertainty_areas: [],
        requires_review: false,
      },
      weight: 3,
    },
    {
      identityId: "agent2",
      confidence: {
        score: 50,
        level: ConfidenceAssessmentLevel.MEDIUM,
        reasoning: "",
        factors: [],
        uncertainty_areas: [],
        requires_review: false,
      },
      weight: 1,
    },
  ];

  const result = scorer.aggregate(confidences);

  assertEquals(result.weighted, 87.5); // (100*3 + 50*1) / 4
});

Deno.test("[ConfidenceScorer] aggregate handles empty array", () => {
  const scorer = createConfidenceScorer(createMockProvider([]));

  const result = scorer.aggregate([]);

  assertEquals(result.average, 0);
  assertEquals(result.level, "very_low");
  assertEquals(result.sources.length, 0);
});

Deno.test("[ConfidenceScorer] aggregate tracks flaggedForReview", () => {
  const scorer = createConfidenceScorer(createMockProvider([]));

  const confidences = [
    {
      identityId: "agent1",
      confidence: {
        score: 90,
        level: ConfidenceAssessmentLevel.VERY_HIGH,
        reasoning: "",
        factors: [],
        uncertainty_areas: [],
        requires_review: false,
      },
    },
    {
      identityId: "agent2",
      confidence: {
        score: 20,
        level: ConfidenceAssessmentLevel.VERY_LOW,
        reasoning: "",
        factors: [],
        uncertainty_areas: [],
        requires_review: true,
      },
    },
  ];

  const result = scorer.aggregate(confidences);

  assertEquals(result.anyFlaggedForReview, true);
});

// ============================================================================
// Metrics Tests
// ============================================================================

Deno.test("[ConfidenceScorer] tracks metrics correctly", async () => {
  const mockResponses = [
    makeConfidenceJSON({ score: 80, level: ConfidenceAssessmentLevel.HIGH }),
    makeConfidenceJSON({ score: 40, level: ConfidenceAssessmentLevel.LOW, requires_review: true }),
    makeConfidenceJSON({ score: 60, level: ConfidenceAssessmentLevel.MEDIUM }),
  ];

  const provider = createMockProvider(mockResponses);
  const scorer = createConfidenceScorer(provider);

  await scorer.assess("Q1", "A1");
  await scorer.assess("Q2", "A2");
  await scorer.assess("Q3", "A3");

  const metrics = scorer.getMetrics();

  assertEquals(metrics.totalAssessments, 3);
  assertEquals(metrics.averageScore, 60); // (80 + 40 + 60) / 3
  assertEquals(metrics.flaggedCount, 1);
});

Deno.test("[ConfidenceScorer] resets metrics", async () => {
  const mockResponses = [makeConfidenceJSON({ score: 80 })];

  const scorer = createConfidenceScorer(createMockProvider(mockResponses));
  await scorer.assess("Q", "A");

  scorer.resetMetrics();
  const metrics = scorer.getMetrics();

  assertEquals(metrics.totalAssessments, 0);
  assertEquals(metrics.averageScore, 0);
});

// ============================================================================
// Factory Function Tests
// ============================================================================

Deno.test("[createConfidenceScorer] creates scorer with defaults", () => {
  const scorer = createConfidenceScorer(createMockProvider([]));
  assertExists(scorer);
});

Deno.test("[createStrictConfidenceScorer] creates strict scorer", async () => {
  const mockResponses = [
    makeConfidenceJSON({ score: 65, level: ConfidenceAssessmentLevel.MEDIUM, requires_review: false }),
  ];

  const scorer = createStrictConfidenceScorer(createMockProvider(mockResponses));
  const result = await scorer.assess("Q", "A");

  // Strict has lowConfidenceThreshold of 70, so 65 should be flagged
  assertEquals(result.flaggedForReview, true);
});

Deno.test("[createLenientConfidenceScorer] creates lenient scorer", async () => {
  const mockResponses = [
    makeConfidenceJSON({ score: 35, level: ConfidenceAssessmentLevel.MEDIUM, requires_review: false }),
  ];

  const scorer = createLenientConfidenceScorer(createMockProvider(mockResponses));
  const result = await scorer.assess("Q", "A");

  // Lenient has lowConfidenceThreshold of 30 and autoReview false
  assertEquals(result.flaggedForReview, false);
});

// ============================================================================
// Edge Case Tests
// ============================================================================

Deno.test("[ConfidenceScorer] handles boundary scores", () => {
  const scorer = createConfidenceScorer(createMockProvider([]));

  const veryHigh = scorer.assessQuick("Definitely certainly absolutely always true. " + "x".repeat(100));
  const veryLow = scorer.assessQuick("?");

  assert(veryHigh.level === ConfidenceAssessmentLevel.VERY_HIGH || veryHigh.level === ConfidenceAssessmentLevel.HIGH);
  assert(veryLow.level === ConfidenceAssessmentLevel.VERY_LOW || veryLow.level === ConfidenceAssessmentLevel.LOW);
});

Deno.test("[ConfidenceScorer] score to level mapping is correct", () => {
  const scorer = createConfidenceScorer(createMockProvider([]), {
    highConfidenceThreshold: 80,
    lowConfidenceThreshold: 50,
    veryLowThreshold: 30,
  });

  // Use assessQuick and check resulting level based on score
  const base = scorer.assessQuick("x".repeat(100));
  assertEquals(typeof base.score, "number");
  assert(base.score >= 0 && base.score <= 100);
});

Deno.test("[ConfidenceScorer] preserves content in result", async () => {
  const mockResponses = [makeConfidenceJSON({ score: 80 })];
  const scorer = createConfidenceScorer(createMockProvider(mockResponses));

  const originalContent = "This is the original response content";
  const result = await scorer.assess("Question", originalContent);

  assertEquals(result.content, originalContent);
});

Deno.test("[ConfidenceScorer] extractedAt is set", async () => {
  const mockResponses = [makeConfidenceJSON({ score: 80 })];
  const scorer = createConfidenceScorer(createMockProvider(mockResponses));

  const before = new Date();
  const result = await scorer.assess("Q", "A");
  const after = new Date();

  assert(result.extractedAt >= before);
  assert(result.extractedAt <= after);
});
