// deno-lint-ignore-file no-explicit-any
/**
 * @module PlanAmendmentTriggerTest
 * @path tests/integration/services/plan_amendment_trigger_test.ts
 * @description Integration tests for verifying plan amendment triggers and artifact persistence.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { PlanExecutor } from "../../../src/services/plan/plan_executor.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { PlanAmendmentPendingError } from "../../../src/services/plan/errors.ts";
import type { IGenerateResult } from "@exaix/ai/providers/common.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IDatabaseService } from "@exaix/core/types";
import type { ConfidenceScorer } from "../../../src/services/utils/confidence_scorer.ts";

/**
 * Helper to bypass strict casting rules in tests without using double casting.
 */
function castTo<T>(val: any): T {
  return val as T;
}

Deno.test("PlanExecutor triggers amendment on low confidence result", async () => {
  const root = await Deno.makeTempDir();
  const traceId = "550e8400-e29b-41d4-a716-446655440000";
  const requestId = "550e8400-e29b-41d4-a716-446655440001";

  try {
    const config = createMockConfig(root, {
      amendment: { enabled: true, threshold: 80, expiryMs: 1000 },
    });

    // Mock LLM provider
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

    // Mock ConfidenceScorer
    const mockScorer = {
      assessQuick: () => ({ score: 40, reasoning: "Too short" }),
    };

    const executor = new PlanExecutor(
      config,
      mockLLM,
      castTo<IDatabaseService>({}),
      root,
      {
        confidenceScorer: castTo<ConfidenceScorer>(mockScorer),
        enableGit: false,
      },
    );

    const context = {
      trace_id: traceId,
      request_id: requestId,
      identity: "user-1",
      frontmatter: { portal: "workspace" },
      steps: [
        { number: 1, title: "Step 1", content: "Do something" },
        { number: 2, title: "Step 2", content: "Do more" },
      ],
    };

    const agentExecutor = {
      executeStep: () => Promise.resolve({ description: "Result" }),
      dispose: () => {},
    };

    castTo<{ createAgentExecutor: any }>(executor).createAgentExecutor = () => agentExecutor;

    // Should throw PlanAmendmentPendingError
    await assertRejects(
      () => executor.execute("plan.md", context),
      PlanAmendmentPendingError,
    );

    // Check if amendment artifact was created
    const executionRoot = config.paths.memoryExecution;
    const amendmentsDir = `${root}/${config.paths.memory}/${executionRoot}/${traceId}/amendments`;
    const entries = await Array.fromAsync(Deno.readDir(amendmentsDir));
    assertEquals(entries.length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("PlanExecutor triggers amendment on tool error result", async () => {
  const root = await Deno.makeTempDir();
  const traceId = "550e8400-e29b-41d4-a716-446655440020";
  const requestId = "550e8400-e29b-41d4-a716-446655440021";

  try {
    const config = createMockConfig(root, {
      amendment: { enabled: true, threshold: 80, expiryMs: 1000 },
    });

    // Mock LLM provider for amendment proposal
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

    // No confidence scorer needed - tool error triggers without it
    const executor = new PlanExecutor(
      config,
      mockLLM,
      castTo<IDatabaseService>({}),
      root,
      {
        enableGit: false,
      },
    );

    const context = {
      trace_id: traceId,
      request_id: requestId,
      identity: "user-1",
      frontmatter: { portal: "workspace" },
      steps: [
        { number: 1, title: "Step 1", content: "Do something" },
        { number: 2, title: "Step 2", content: "Do more" },
      ],
    };

    // Mock agent executor to throw error on first step
    const agentExecutor = {
      executeStep: () => {
        throw new Error("Tool execution failed: API timeout");
      },
      dispose: () => {},
    };

    castTo<{ createAgentExecutor: any }>(executor).createAgentExecutor = () => agentExecutor;

    // Should throw PlanAmendmentPendingError (amendment proposed, execution paused)
    await assertRejects(
      () => executor.execute("plan.md", context),
      PlanAmendmentPendingError,
    );

    // Verify amendment artifact was still created before re-throwing
    const executionRoot = config.paths.memoryExecution;
    const amendmentsDir = `${root}/${config.paths.memory}/${executionRoot}/${traceId}/amendments`;
    const entries = await Array.fromAsync(Deno.readDir(amendmentsDir));
    assertEquals(entries.length, 1, "Amendment artifact should be created for tool errors");

    // Verify artifact content
    const amendmentFile = entries[0];
    const amendmentContent = await Deno.readTextFile(`${amendmentsDir}/${amendmentFile.name}`);
    const amendment = JSON.parse(amendmentContent);
    assertEquals(amendment.planId, requestId);
    assertEquals(amendment.summary.includes("Tool failed"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
