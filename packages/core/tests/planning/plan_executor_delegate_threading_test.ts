/**
 * @module PlanExecutorDelegateThreadingTest
 * @path packages/core/tests/planning/plan_executor_delegate_threading_test.ts
 * @description Verifies that PlanExecutor._tryDelegateStep passes step title, content, and
 *   successCriteria through onCodeChangesDelegate (Phase 150 Step 1, S1.1 DELEGATE_THREADING).
 */
import { assertEquals } from "@std/assert";
import { createMockConfig } from "@exaix/testing";
import { PlanExecutor } from "@exaix/core/planning";

const stubProvider = {
  id: "stub",
  generate: () =>
    Promise.resolve({
      content: "",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "",
      provider: "",
    }),
};

const stubDb = {
  prepare: () => {},
  exec: () => {},
  all: () => [],
  close: () => Promise.resolve(),
};

Deno.test("PlanExecutor: onCodeChangesDelegate receives step title, content, and successCriteria", async () => {
  const config = createMockConfig("/tmp/test");
  const received: Array<{ title: string; content: string; successCriteria?: string[] }> = [];

  const executor = new PlanExecutor(
    config,
    stubProvider as never,
    stubDb as never,
    "/tmp/test",
    undefined,
    {
      enableGit: false,
      onCodeChangesDelegate: (_traceId, step, _worktreePath) => {
        received.push(step);
        return Promise.resolve("changes_made");
      },
    },
  );

  await executor.execute("plan.md", {
    trace_id: "test-trace",
    request_id: "test-req",
    agent_role: "test",
    frontmatter: {},
    steps: [
      {
        number: 1,
        title: "Refactor parser",
        content: "Extract parsing logic into a separate module",
        successCriteria: ["Tests pass", "No regressions"],
      },
      { number: 2, title: "Add logging", content: "Add structured logging to the service layer" },
    ],
  });

  assertEquals(received.length, 2);
  assertEquals(received[0].title, "Refactor parser");
  assertEquals(received[0].content, "Extract parsing logic into a separate module");
  assertEquals(received[0].successCriteria, ["Tests pass", "No regressions"]);
  assertEquals(received[1].title, "Add logging");
  assertEquals(received[1].content, "Add structured logging to the service layer");
  assertEquals(received[1].successCriteria, undefined);
});

Deno.test("PlanExecutor: onCodeChangesDelegate sentinel returns unchanged (changes_made / abandoned)", async () => {
  const config = createMockConfig("/tmp/test");

  const executor = new PlanExecutor(
    config,
    stubProvider as never,
    stubDb as never,
    "/tmp/test",
    undefined,
    {
      enableGit: false,
      onCodeChangesDelegate: (_traceId, _step, _worktreePath) => {
        return Promise.resolve("abandoned");
      },
    },
  );

  const result = await executor.execute("plan.md", {
    trace_id: "test-trace",
    request_id: "test-req",
    agent_role: "test",
    frontmatter: {},
    steps: [
      { number: 1, title: "Skip step", content: "This should be skipped" },
    ],
  });

  assertEquals(result.lastCommitSha, null);
});
