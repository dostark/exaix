/**
 * @module ProcessorAgentRunnerJournalTest
 * @path packages/request/tests/processor_agent_runner_journal_test.ts
 * @description Verifies RequestProcessor.processAgentRequest wraps agentRunner.run() (both the
 *   initial call and the feedback-retry call) with real Activity Journal execution-start/
 *   complete/error rows tagged runnerKind: "agent-runner" — the request/routing pipeline
 *   persisted no such rows before Phase 180 Step 5. Uses a real EventLogger + real DB (not a
 *   mock) because RequestProcessor's default ctx.display stub path drops IEventLogger.log()
 *   calls (see Architecture Notes in the phase plan, Step 5).
 * @architectural-layer Services
 */

import { assert, assertEquals } from "@std/assert";
import { createStubProvider } from "@exaix/testing";
import { withProcessorWorkspace } from "./helpers/processor_workspace.ts";

Deno.test("[new] RequestProcessor.processAgentRequest logs runner_kind: agent-runner on agentRunner.run() completion", async () => {
  const provider = createStubProvider(
    '<thought>ok</thought><content>{"description": "Mock plan", ' +
      '"steps": [{"step": 1, "title": "Mock step", "description": "Mock step description"}]}</content>',
  );
  await withProcessorWorkspace(provider, async ({ db, traceId, requestPath, processor }) => {
    await processor.process(requestPath);
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    const started = activities.find((a) => a.action_type === "agent.execution_started" && a.runner_kind);
    const completed = activities.find((a) => a.action_type === "agent.execution_completed" && a.runner_kind);
    assert(started, "a queryable Activity Journal row for agent.execution_started must exist");
    assert(completed, "a queryable Activity Journal row for agent.execution_completed must exist");
    assertEquals(started!.runner_kind, "agent-runner");
    assertEquals(completed!.runner_kind, "agent-runner");
  });
});

Deno.test("[new] RequestProcessor.processAgentRequest logs runner_kind: agent-runner on both the initial and feedback-retry agentRunner.run() calls", async () => {
  // The first response is malformed plan content. It triggers PlanValidationError and a retry.
  // The second response is a valid plan, so the retry succeeds.
  let callCount = 0;
  const provider = {
    id: "mock-provider",
    generate: () => {
      callCount++;
      const content = callCount === 1
        ? "not valid plan json at all"
        : '{"description": "Mock plan", "steps": [{"step": 1, "title": "Mock step", "description": "Mock step description"}]}';
      return Promise.resolve({
        content: `<thought>ok</thought><content>${content}</content>`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock-provider",
        cost_usd: 0,
      });
    },
  };
  await withProcessorWorkspace(provider, async ({ db, traceId, requestPath, processor }) => {
    await processor.process(requestPath);
    await db.waitForFlush();

    assert(callCount >= 2, "the malformed first response must have triggered a real retry");

    const activities = db.getActivitiesByTrace(traceId);
    const startedRows = activities.filter((a) => a.action_type === "agent.execution_started" && a.runner_kind);
    const completedRows = activities.filter((a) => a.action_type === "agent.execution_completed" && a.runner_kind);
    assertEquals(startedRows.length, 2, "both the initial and feedback-retry calls must log a start row");
    assertEquals(completedRows.length, 2, "both the initial and feedback-retry calls must log a completion row");
    for (const row of [...startedRows, ...completedRows]) {
      assertEquals(row.runner_kind, "agent-runner");
    }
  });
});
