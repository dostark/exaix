/**
 * @module LlmQualityAssessorTest
 * @path tests/services/quality_gate/llm_assessor_test.ts
 * @description Tests for the LLM-based quality assessor, verifying prompt
 * construction, schema validation, fallback behaviour, and integration with
 * the OutputValidator.
 * @architectural-layer Services
 * @related-files [src/services/quality_gate/llm_assessor.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { createMockProvider } from "../../helpers/mock_provider.ts";
import { createOutputValidator } from "../../../src/services/output_validator.ts";
import {
  RequestQualityLevel,
  RequestQualityRecommendation,
} from "../../../src/shared/schemas/request_quality_assessment.ts";
import { QualityGateMode } from "../../../src/shared/enums.ts";
import { LlmQualityAssessor } from "../../../src/services/quality_gate/llm_assessor.ts";
import type { IModelProvider } from "../../../src/ai/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidLlmResponse(): string {
  return JSON.stringify({
    score: 75,
    level: "good",
    issues: [],
    recommendation: "proceed",
  });
}

function makeValidLlmResponseWithIssues(): string {
  return JSON.stringify({
    score: 35,
    level: "poor",
    issues: [
      {
        type: "vague",
        description: "The request body is too vague",
        severity: "major",
        suggestion: "Please provide more specific requirements",
      },
    ],
    recommendation: "needs-clarification",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("[LlmQualityAssessor] parses valid LLM response", async () => {
  const assessor = new LlmQualityAssessor(
    createMockProvider([makeValidLlmResponse()]),
    createOutputValidator({}),
  );

  const result = await assessor.assess("Implement user login with JWT tokens");

  assertEquals(result.score, 75);
  assertEquals(result.level, RequestQualityLevel.GOOD);
  assertEquals(result.recommendation, RequestQualityRecommendation.PROCEED);
  assertExists(result.metadata);
  assertEquals(result.metadata.mode, QualityGateMode.LLM);
  assertExists(result.metadata.assessedAt);
});

Deno.test("[LlmQualityAssessor] handles invalid LLM JSON gracefully", async () => {
  const assessor = new LlmQualityAssessor(
    createMockProvider(["this is not valid json {{{broken"]),
    createOutputValidator({}),
  );

  // Should not throw — falls back to heuristic
  const result = await assessor.assess("Implement user login with JWT tokens");

  assertExists(result.score);
  assertExists(result.level);
  assertExists(result.recommendation);
  assertExists(result.metadata);
});

Deno.test("[LlmQualityAssessor] passes request text in prompt", async () => {
  const requestText = "Fix SQL injection in auth handler — unique marker 7c9f3b";
  let capturedPrompt = "";
  const capturingProvider: IModelProvider = {
    id: "capturing",
    generate: (prompt: string): Promise<string> => {
      capturedPrompt = prompt;
      return Promise.resolve(makeValidLlmResponse());
    },
  };

  const assessor = new LlmQualityAssessor(
    capturingProvider,
    createOutputValidator({}),
  );
  await assessor.assess(requestText);

  assertEquals(capturedPrompt.includes("7c9f3b"), true);
});

Deno.test("[LlmQualityAssessor] uses OutputValidator for parsing", async () => {
  // Provde a response that diverges from heuristic expectation —
  // if the value lands in the result it came from LLM validation, not fallback.
  const assessor = new LlmQualityAssessor(
    createMockProvider([makeValidLlmResponseWithIssues()]),
    createOutputValidator({}),
  );

  const result = await assessor.assess("make it work");

  assertEquals(result.score, 35);
  assertEquals(result.level, RequestQualityLevel.POOR);
  assertEquals(result.issues.length, 1);
  assertEquals(result.issues[0].type, "vague");
});

Deno.test("[LlmQualityAssessor] returns fallback on validation failure", async () => {
  // Return JSON that does not satisfy RequestQualityAssessmentSchema
  // (score out of range, missing fields)
  const badResponse = JSON.stringify({ score: 9999, level: "unknown_level" });

  const assessor = new LlmQualityAssessor(
    createMockProvider([badResponse]),
    createOutputValidator({}),
  );

  // Should not throw — falls back to heuristic
  const result = await assessor.assess("Implement user login");

  assertExists(result.score);
  assertEquals(result.score >= 0 && result.score <= 100, true);
  assertExists(result.metadata);
});
