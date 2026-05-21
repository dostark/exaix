/**
 * @module PlanAmendmentTriggerTest
 * @path tests/integration/services/plan_amendment_trigger_test.ts
 * @description Integration tests for verifying plan amendment triggers and artifact persistence.
 */

import { assertEquals } from "@std/assert";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { ConfidenceScorer } from "../../../src/services/utils/confidence_scorer.ts";
import { castAny as castTo } from "../../helpers/test_helpers.ts";
import { withPlanAmendmentPendingScenario } from "./plan_amendment_test_helper.ts";

Deno.test("PlanExecutor triggers amendment on low confidence result", async () => {
  const traceId = "550e8400-e29b-41d4-a716-446655440000";
  const requestId = "550e8400-e29b-41d4-a716-446655440001";

  const mockLLM = {
    id: "mock-llm",
    generate: (): Promise<IGenerateResult> =>
      Promise.resolve({
        content: JSON.stringify({
          summary: "Proposing changes",
          affectedRemainingStepIds: ["2"],
          adds: [],
          updates: [],
          removes: [],
        }),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      }),
  } as IModelProvider;
  const mockScorer = {
    assessQuick: () => ({ score: 40, reasoning: "Too short" }),
  };
  const steps = [
    { number: 1, title: "Step 1", content: "Do something" },
    { number: 2, title: "Step 2", content: "Do more" },
  ];

  await withPlanAmendmentPendingScenario(
    {
      llm: mockLLM,
      traceId,
      requestId,
      steps,
      threshold: 80,
      expiryMs: 1000,
      scorer: castTo<ConfidenceScorer>(mockScorer),
    },
    ({ entries }) => {
      assertEquals(entries.length, 1);
    },
  );
});

Deno.test("PlanExecutor triggers amendment on tool error result", async () => {
  const traceId = "550e8400-e29b-41d4-a716-446655440020";
  const requestId = "550e8400-e29b-41d4-a716-446655440021";

  const mockLLM = {
    id: "mock-llm",
    generate: (): Promise<IGenerateResult> =>
      Promise.resolve({
        content: JSON.stringify({
          summary: "Tool failed, proposing alternative approach",
          affectedRemainingStepIds: ["2"],
          adds: [],
          updates: [{ number: 2, title: "Alternative approach", content: "Use different method" }],
          removes: [],
        }),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      }),
  } as IModelProvider;
  const steps = [
    { number: 1, title: "Step 1", content: "Do something" },
    { number: 2, title: "Step 2", content: "Do more" },
  ];

  await withPlanAmendmentPendingScenario(
    {
      llm: mockLLM,
      traceId,
      requestId,
      steps,
      threshold: 80,
      expiryMs: 1000,
      agentExecutor: {
        executeStep: () => {
          throw new Error("Tool execution failed: API timeout");
        },
        dispose: () => {},
      },
    },
    ({ amendmentContent, entries }) => {
      assertEquals(entries.length, 1, "Amendment artifact should be created for tool errors");

      const amendment = JSON.parse(amendmentContent);
      assertEquals(amendment.planId, requestId);
      assertEquals(amendment.summary.includes("Tool failed"), true);
    },
  );
});
