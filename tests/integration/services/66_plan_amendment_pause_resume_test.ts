/**
 * @module PlanAmendmentPauseResumeTest
 * @path tests/integration/services/66_plan_amendment_pause_resume_test.ts
 * @description Functional tests for plan amendment pause/resume lifecycle using checkpoint-then-halt semantics.
 * @related-files [src/services/plan/plan_executor.ts, src/services/plan/errors.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { PlanExecutor } from "../../../src/services/plan/plan_executor.ts";
import { PlanAmendmentService } from "../../../src/services/plan/plan_amendment_service.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { createStubDb } from "../../helpers/test_helpers.ts";
import type { IGenerateResult, IModelProvider } from "../../../src/ai/types.ts";
import type { IPlanAmendmentPatch } from "@exaix/schemas/plan_amendment.ts";
import type { ConfidenceScorer } from "../../../src/services/utils/confidence_scorer.ts";
import { PlanAmendmentPendingError } from "../../../src/services/plan/errors.ts";

/**
 * Helper to bypass strict casting rules in tests without using double casting.
 */
function castTo<T>(val: unknown): T {
  return val as T;
}

function makeResult(content: string): IGenerateResult {
  return {
    content,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: "m",
    provider: "p",
    cost_usd: 0,
  };
}

Deno.test("PlanExecutor pauses execution when amendment is proposed", async () => {
  const root = await Deno.makeTempDir();
  const traceId = "550e8400-e29b-41d4-a716-446655440010";
  const requestId = "550e8400-e29b-41d4-a716-446655440011";

  try {
    const config = createMockConfig(root, {
      amendment: { enabled: true, threshold: 80, expiryMs: 5000 },
    });

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

    const mockDb = createStubDb();

    const executor = new PlanExecutor(
      config,
      mockLLM,
      mockDb,
      root,
      {
        confidenceScorer: mockScorer,
        enableGit: false,
      },
    );

    const context = {
      trace_id: traceId,
      request_id: requestId,
      identity: "user-1",
      frontmatter: { portal: "workspace" },
      steps: [
        { number: 1, title: "Step 1", content: "First step executed" },
        { number: 2, title: "Step 2", content: "Second step" },
        { number: 3, title: "Step 3", content: "Third step" },
      ],
    };

    const agentExecutor = {
      executeStep: () => Promise.resolve({ description: "Step result" }),
      dispose: () => {},
    };

    castTo<{ createAgentExecutor: unknown }>(executor).createAgentExecutor = () => agentExecutor;

    // Execution should throw PlanAmendmentPendingError when trigger fires
    await assertRejects(
      async () => {
        await executor.execute("plan.md", context);
      },
      PlanAmendmentPendingError,
    );

    // Verify amendment artifact was persisted
    const executionRoot = config.paths.memoryExecution;
    const amendmentsDir = `${root}/${config.paths.memory}/${executionRoot}/${traceId}/amendments`;
    const entries = await Array.fromAsync(Deno.readDir(amendmentsDir));
    assertEquals(entries.length, 1, "Expected exactly one amendment artifact");

    // Read and verify the amendment artifact
    const amendmentFile = entries[0];
    const amendmentPath = `${amendmentsDir}/${amendmentFile.name}`;
    const amendmentContent = await Deno.readTextFile(amendmentPath);
    const amendment = JSON.parse(amendmentContent);

    assertEquals(amendment.planId, requestId);
    assertEquals(typeof amendment.amendmentId, "string");
    assertEquals(amendment.summary.length > 0, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Amendment artifact is stored in correct directory structure", async () => {
  const root = await Deno.makeTempDir();
  const traceId = "550e8400-e29b-41d4-a716-446655440012";
  const requestId = "550e8400-e29b-41d4-a716-446655440013";

  try {
    const config = createMockConfig(root, {
      amendment: { enabled: true, threshold: 90, expiryMs: 10000 },
    });

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

    const mockDb = createStubDb();

    const executor = new PlanExecutor(
      config,
      mockLLM,
      mockDb,
      root,
      {
        confidenceScorer: mockScorer,
        enableGit: false,
      },
    );

    const context = {
      trace_id: traceId,
      request_id: requestId,
      identity: "user-1",
      frontmatter: { portal: "workspace" },
      steps: [
        { number: 1, title: "Step 1", content: "Done" },
        { number: 2, title: "Step 2", content: "Pending" },
      ],
    };

    const agentExecutor = {
      executeStep: () => Promise.resolve({ description: "Result" }),
      dispose: () => {},
    };

    castTo<{ createAgentExecutor: unknown }>(executor).createAgentExecutor = () => agentExecutor;

    await assertRejects(
      async () => {
        await executor.execute("plan.md", context);
      },
      PlanAmendmentPendingError,
    );

    // Verify directory structure: Memory/Execution/{traceId}/amendments/
    const memoryPath = `${root}/${config.paths.memory}`;
    const executionPath = `${memoryPath}/${config.paths.memoryExecution}`;
    const tracePath = `${executionPath}/${traceId}`;
    const amendmentsPath = `${tracePath}/amendments`;

    // Verify directories exist
    const memoryStat = await Deno.stat(memoryPath);
    assertEquals(memoryStat.isDirectory, true);

    const executionStat = await Deno.stat(executionPath);
    assertEquals(executionStat.isDirectory, true);

    const traceStat = await Deno.stat(tracePath);
    assertEquals(traceStat.isDirectory, true);

    const amendmentsStat = await Deno.stat(amendmentsPath);
    assertEquals(amendmentsStat.isDirectory, true);

    // Verify amendment file exists
    const entries = await Array.fromAsync(Deno.readDir(amendmentsPath));
    const amendmentFiles = entries.filter((e) => e.name.endsWith(".json"));
    assertEquals(amendmentFiles.length, 1, "Expected one amendment JSON file");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("applyApprovedAmendment updates plan status to approved", async () => {
  const { tempDir, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir, {
      amendment: { enabled: true, threshold: 60, expiryMs: 86_400_000 },
    });

    const mockLlm = castTo<IModelProvider>({});
    const service = new PlanAmendmentService(config, mockLlm);

    const planContent = `---
trace_id: "trace-1"
request_id: "req-1"
status: amendment_pending
---

# Plan

## Execution Steps

## Step 1: First
Content 1

## Step 2: Second
Content 2
`;

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
    const config = createMockConfig(root, {
      amendment: { enabled: false, threshold: 60, expiryMs: 86_400_000 },
    });

    const mockLLM = castTo<IModelProvider>({
      generate: () => Promise.resolve(makeResult("Step completed")),
    });

    const mockScorer = castTo<ConfidenceScorer>({
      assessQuick: () => ({ score: 20, reasoning: "Very low - should trigger but disabled" }),
    });

    const mockDb = createStubDb();

    const executor = new PlanExecutor(
      config,
      mockLLM,
      mockDb,
      root,
      {
        confidenceScorer: mockScorer,
        enableGit: false,
      },
    );

    const context = {
      trace_id: traceId,
      request_id: requestId,
      identity: "user-1",
      frontmatter: { portal: "workspace" },
      steps: [
        { number: 1, title: "Step 1", content: "Step 1" },
        { number: 2, title: "Step 2", content: "Step 2" },
      ],
    };

    let stepCount = 0;
    const agentExecutor = {
      executeStep: () => {
        stepCount++;
        return Promise.resolve({ description: `Step ${stepCount} result` });
      },
      dispose: () => {},
    };

    castTo<{ createAgentExecutor: unknown }>(executor).createAgentExecutor = () => agentExecutor;

    // Should NOT throw PlanAmendmentPendingError since amendment is disabled
    const result = await executor.execute("plan.md", context);

    // Execution should complete without amendment interruption
    assertEquals(result !== undefined, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
