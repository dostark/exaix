/**
 * @module RequestEnricherLlmTest
 * @path tests/services/quality_gate/request_enricher_llm_test.ts
 * @description Tests for the LLM-based request enricher that rewrites
 * underspecified request bodies while preserving original intent.
 * @architectural-layer Services
 * @related-files [src/services/quality_gate/request_enricher_llm.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { createMockProvider } from "../../helpers/mock_provider.ts";
import type { IModelProvider } from "../../../src/ai/types.ts";
import {
  type IRequestQualityIssue,
  RequestQualityIssueSeverity,
  RequestQualityIssueType,
} from "../../../src/shared/schemas/request_quality_assessment.ts";
import { enrichRequest } from "../../../src/services/quality_gate/request_enricher_llm.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_ISSUES: IRequestQualityIssue[] = [
  {
    type: RequestQualityIssueType.VAGUE,
    description: "Request is too vague to act on",
    severity: RequestQualityIssueSeverity.MAJOR,
    suggestion: "Specify which component to fix and what the expected behaviour is",
  },
  {
    type: RequestQualityIssueType.NO_ACCEPTANCE_CRITERIA,
    description: "No acceptance criteria provided",
    severity: RequestQualityIssueSeverity.MINOR,
    suggestion: "Add given-when-then style criteria",
  },
];

const ORIGINAL_BODY = "make the login work better";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("[RequestEnricherLlm] returns enriched body from LLM", async () => {
  const enrichedText = "Improve the login flow by:\n1. Fixing JWT validation\n2. Returning 401 on failure";
  const result = await enrichRequest(
    createMockProvider([enrichedText]),
    ORIGINAL_BODY,
    SAMPLE_ISSUES,
  );

  assertEquals(result, enrichedText);
});

Deno.test("[RequestEnricherLlm] includes issues in prompt", async () => {
  let capturedPrompt = "";
  const capturingProvider: IModelProvider = {
    id: "capturing",
    generate: (prompt: string): Promise<string> => {
      capturedPrompt = prompt;
      return Promise.resolve("Improved: implement proper JWT login flow");
    },
  };

  await enrichRequest(capturingProvider, ORIGINAL_BODY, SAMPLE_ISSUES);

  // Issue descriptions must appear in the prompt
  assertEquals(capturedPrompt.includes("Request is too vague"), true);
  assertEquals(capturedPrompt.includes("No acceptance criteria"), true);
});

Deno.test("[RequestEnricherLlm] falls back to original on LLM failure", async () => {
  const failingProvider: IModelProvider = {
    id: "failing",
    generate: (_prompt: string): Promise<string> => {
      return Promise.reject(new Error("LLM unavailable"));
    },
  };

  const result = await enrichRequest(failingProvider, ORIGINAL_BODY, SAMPLE_ISSUES);

  // Must return the original body unchanged
  assertEquals(result, ORIGINAL_BODY);
});

Deno.test("[RequestEnricherLlm] includes original body in prompt", async () => {
  const uniqueMarker = "unique-marker-4f8e2a";
  let capturedPrompt = "";
  const capturingProvider: IModelProvider = {
    id: "capturing",
    generate: (prompt: string): Promise<string> => {
      capturedPrompt = prompt;
      return Promise.resolve("Implement proper authentication");
    },
  };

  await enrichRequest(capturingProvider, uniqueMarker, SAMPLE_ISSUES);

  assertEquals(capturedPrompt.includes(uniqueMarker), true);
});

Deno.test("[RequestEnricherLlm] returns non-empty string on success", async () => {
  const result = await enrichRequest(
    createMockProvider(["## Goals\n- Implement login\n- Return JWT token"]),
    ORIGINAL_BODY,
    SAMPLE_ISSUES,
  );

  assertExists(result);
  assertEquals(result.length > 0, true);
});
