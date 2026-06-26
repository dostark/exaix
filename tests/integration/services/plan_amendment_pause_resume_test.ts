/**
 * @module PlanAmendmentPauseResumeTest
 * @path tests/integration/services/plan_amendment_pause_resume_test.ts
 * @description Functional tests for plan amendment pause/resume lifecycle using checkpoint-then-halt semantics.
 * @related-files [@exaix/core/planning, @exaix/core/planning]
 */

import { assertEquals } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IPlanAmendmentPatch } from "@exaix/schemas/plan_amendment.ts";
import type { ConfidenceScorer } from "@exaix/execution";
import { readFixtureTextSync } from "@exaix/testing";
import { castAny as castTo, makeGenerateResult as makeResult } from "@exaix/testing";
import {
  attachPlanAgentExecutor,
  createPlanAmendmentExecutor,
  createPlanAmendmentServiceForTest,
  createPlanExecutionContext,
  readDirEntries,
  withPlanAmendmentPendingScenario,
} from "./plan_amendment_test_helper.ts";

Deno.test("PlanExecutor pauses execution when amendment is proposed", async () => {
  const traceId = "550e8400-e29b-41d4-a716-446655440010";
  const requestId = "550e8400-e29b-41d4-a716-446655440011";

  const mockLLM = castTo<IModelProvider>({
    generate: () =>
      Promise.resolve(
        makeResult(
          JSON.stringify({
            summary: "Amendment required due to tool failure",
            affectedRemainingStepIds: ["2", "3"],
            adds: [],
            updates: [{ number: 2, title: "Updated Step", content: "Updated content" }],
            removes: ["3"],
          }),
        ),
      ),
  });
  const mockScorer = castTo<ConfidenceScorer>({
    assessQuick: () => ({ score: 30, reasoning: "Very low confidence after tool failure" }),
  });
  const steps = [
    { number: 1, title: "Step 1", content: "First step executed" },
    { number: 2, title: "Step 2", content: "Second step" },
    { number: 3, title: "Step 3", content: "Third step" },
  ];

  await withPlanAmendmentPendingScenario(
    {
      llm: mockLLM,
      traceId,
      requestId,
      steps,
      threshold: 80,
      expiryMs: 5000,
      scorer: mockScorer,
      agentExecutor: {
        executeStep: () => Promise.resolve({ description: "Step result" }),
        dispose: () => {},
      },
    },
    ({ amendmentContent, entries }) => {
      assertEquals(entries.length, 1, "Expected exactly one amendment artifact");

      const amendment = JSON.parse(amendmentContent);

      assertEquals(amendment.planId, requestId);
      assertEquals(typeof amendment.amendmentId, "string");
      assertEquals(amendment.summary.length > 0, true);
    },
  );
});

Deno.test("Amendment artifact is stored in correct directory structure", async () => {
  const traceId = "550e8400-e29b-41d4-a716-446655440012";
  const requestId = "550e8400-e29b-41d4-a716-446655440013";

  const mockLLM = castTo<IModelProvider>({
    generate: () =>
      Promise.resolve(
        makeResult(
          JSON.stringify({
            summary: "Test amendment",
            affectedRemainingStepIds: ["2"],
            adds: [],
            updates: [],
            removes: [],
          }),
        ),
      ),
  });
  const mockScorer = castTo<ConfidenceScorer>({
    assessQuick: () => ({ score: 50, reasoning: "Below threshold" }),
  });
  const steps = [
    { number: 1, title: "Step 1", content: "Done" },
    { number: 2, title: "Step 2", content: "Pending" },
  ];

  await withPlanAmendmentPendingScenario(
    {
      llm: mockLLM,
      traceId,
      requestId,
      steps,
      threshold: 90,
      expiryMs: 10000,
      scorer: mockScorer,
    },
    async ({ config, root }) => {
      const memoryPath = `${root}/${config.paths.memory}`;
      const executionPath = `${memoryPath}/${config.paths.memoryExecution}`;
      const tracePath = `${executionPath}/${traceId}`;
      const amendmentsPath = `${tracePath}/amendments`;

      const memoryStat = await Deno.stat(memoryPath);
      assertEquals(memoryStat.isDirectory, true);

      const executionStat = await Deno.stat(executionPath);
      assertEquals(executionStat.isDirectory, true);

      const traceStat = await Deno.stat(tracePath);
      assertEquals(traceStat.isDirectory, true);

      const amendmentsStat = await Deno.stat(amendmentsPath);
      assertEquals(amendmentsStat.isDirectory, true);

      const entries = await readDirEntries(amendmentsPath);
      const amendmentFiles = entries.filter((entry) => entry.name.endsWith(".json"));
      assertEquals(amendmentFiles.length, 1, "Expected one amendment JSON file");
    },
  );
});

Deno.test("applyApprovedAmendment updates plan status to approved", async () => {
  const { tempDir, cleanup } = await initTestDbService();

  try {
    const mockLlm = castTo<IModelProvider>({});
    const { service } = createPlanAmendmentServiceForTest({ root: tempDir, llm: mockLlm });

    const planContent = readFixtureTextSync(
      import.meta.url,
      "integration",
      "services",
      "plan_amendment_pause_resume_test",
      "planContent.md",
    );
    const patch: IPlanAmendmentPatch = {
      amendmentId: crypto.randomUUID(),
      planId: "req-1",
      affectedRemainingStepIds: ["2"],
      summary: "Update step 2",
      adds: [],
      updates: [{ number: 2, title: "Second Updated", content: "Updated content 2" }],
      removes: [],
      createdAt: new Date().toISOString(),
    };

    const updated = service.applyApprovedAmendment(planContent, patch);

    // Verify status changed to approved
    assertEquals(updated.includes("status: approved"), true);
    assertEquals(updated.includes("status: amendment_pending"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("PlanExecutor does not trigger amendment when disabled", async () => {
  const root = await Deno.makeTempDir();
  const traceId = "550e8400-e29b-41d4-a716-446655440014";
  const requestId = "550e8400-e29b-41d4-a716-446655440015";

  try {
    const mockLLM = castTo<IModelProvider>({
      generate: () => Promise.resolve(makeResult("Step completed")),
    });

    const mockScorer = castTo<ConfidenceScorer>({
      assessQuick: () => ({ score: 20, reasoning: "Very low - should trigger but disabled" }),
    });

    const { executor } = createPlanAmendmentExecutor({
      root,
      llm: mockLLM,
      enabled: false,
      threshold: 60,
      expiryMs: 86_400_000,
      scorer: mockScorer,
    });

    const context = createPlanExecutionContext(traceId, requestId, [
      { number: 1, title: "Step 1", content: "Step 1" },
      { number: 2, title: "Step 2", content: "Step 2" },
    ]);

    let stepCount = 0;
    const agentExecutor = {
      executeStep: () => {
        stepCount++;
        return Promise.resolve({ description: `Step ${stepCount} result` });
      },
      dispose: () => {},
    };

    attachPlanAgentExecutor(executor, agentExecutor);

    // Should NOT throw PlanAmendmentPendingError since amendment is disabled
    const result = await executor.execute("plan.md", context);

    // Execution should complete without amendment interruption
    assertEquals(result !== undefined, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
