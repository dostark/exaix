/**
 * @module ContentlessBriefGuardTest
 * @path packages/core/tests/planning/contentless_brief_guard_test.ts
 * @description Verifies the contentless-brief guard: isContentlessBrief detects
 *   empty/placeholder objectives, and the guard in onCodeChangesDelegate rejects
 *   contentless steps (Phase 150 Step 2).
 */
import { assertEquals } from "@std/assert";
import { createMockConfig } from "@exaix/testing";
import { isContentlessBrief, PlanExecutor } from "@exaix/core/planning";

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

Deno.test("isContentlessBrief: detects empty objective", () => {
  assertEquals(isContentlessBrief(""), true);
  assertEquals(isContentlessBrief("   "), true);
  assertEquals(isContentlessBrief("\n\t"), true);
});

Deno.test("isContentlessBrief: detects placeholder 'Execute step N' pattern", () => {
  assertEquals(isContentlessBrief("Execute step 1"), true);
  assertEquals(isContentlessBrief("execute step 5"), true);
  assertEquals(isContentlessBrief("Execute step 10 with something to verify"), true);
});

Deno.test("isContentlessBrief: allows real objective content", () => {
  assertEquals(isContentlessBrief("Build the login page"), false);
  assertEquals(isContentlessBrief("Refactor the parser into a separate module"), false);
});

Deno.test("onCodeChangesDelegate: guard-equipped callback rejects contentless brief (returns abandoned)", async () => {
  const config = createMockConfig("/tmp/test");
  const journaled: string[] = [];

  const executor = new PlanExecutor(
    config,
    stubProvider as never,
    stubDb as never,
    "/tmp/test",
    undefined,
    {
      enableGit: false,
      onCodeChangesDelegate: (_traceId, step, _worktreePath) => {
        if (isContentlessBrief(step.content)) {
          journaled.push("contentless_brief_guard_triggered");
          return Promise.resolve("abandoned");
        }
        journaled.push("brief_passed");
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
      { number: 1, title: "Empty step", content: "" },
      { number: 2, title: "Placeholder step", content: "Execute step 2 with more" },
      { number: 3, title: "Real step", content: "Implement the login feature" },
    ],
  });

  assertEquals(journaled, [
    "contentless_brief_guard_triggered",
    "contentless_brief_guard_triggered",
    "brief_passed",
  ]);
});
