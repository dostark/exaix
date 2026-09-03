/**
 * @module PlanExecutorSessionCoordinatorTest
 * @path tests/integration/plan_executor_session_coordinator_test.ts
 * @description Phase 174 Step 1 integration test proving PlanExecutor's live
 *   code-change callback uses the typed coordinator compatibility adapter.
 * @architectural-layer Integration
 * @related-files [packages/core/src/planning/plan_executor.ts, apps/daemon/src/session_delegation_coordinator.ts]
 */

import { assertEquals } from "@std/assert";
import { PlanExecutor } from "@exaix/core/planning";
import { createMockConfig } from "@exaix/testing";
import {
  type ISessionDelegationCoordinator,
  type ISessionDelegationRequest,
  SessionDelegationOutcomeSchema,
} from "@exaix/session/session_delegation.ts";
import { createCodeChangesDelegateAdapter } from "../../apps/daemon/src/session_delegation_coordinator.ts";

class RecordingCoordinator implements ISessionDelegationCoordinator {
  readonly requests: ISessionDelegationRequest[] = [];

  delegate(input: ISessionDelegationRequest) {
    this.requests.push(input);
    return Promise.resolve(SessionDelegationOutcomeSchema.parse({
      delegationTraceId: crypto.randomUUID(),
      parentTraceId: input.parentTraceId,
      parentStepId: input.parentStepId,
      sequence: input.sequence,
      status: input.sequence === 1 ? "completed" : "abandoned",
      decision: input.sequence === 1 ? "changes_made" : "abandoned",
      summary: input.sequence === 1 ? "implemented" : "stopped",
      pathsTouched: input.sequence === 1 ? ["packages/session/mod.ts"] : [],
      tokenStats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }));
  }
}

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

Deno.test("[integration] PlanExecutor preserves changes_made/abandoned through the coordinator adapter", async () => {
  const coordinator = new RecordingCoordinator();
  const callback = createCodeChangesDelegateAdapter({
    coordinator,
    logger: { warn: () => Promise.resolve() },
  });
  const executor = new PlanExecutor(
    createMockConfig("/tmp/phase-174"),
    stubProvider as never,
    stubDb as never,
    "/tmp/phase-174",
    undefined,
    { enableGit: false, onCodeChangesDelegate: callback },
  );

  await executor.execute("phase-174.md", {
    trace_id: "00000000-0000-4000-8000-000000000173",
    request_id: "phase-174",
    agent_role: "test",
    frontmatter: {},
    steps: [
      {
        number: 1,
        title: "Extract coordinator",
        content: "Extract the live coordinator.",
        successCriteria: ["Typed outcome delivered"],
      },
      {
        number: 2,
        title: "Stop",
        content: "Delegate chooses to abandon.",
      },
    ],
  });

  assertEquals(coordinator.requests.length, 2);
  assertEquals(coordinator.requests[0].parentTraceId, "00000000-0000-4000-8000-000000000173");
  assertEquals(coordinator.requests[0].parentStepId, "1");
  assertEquals(coordinator.requests[0].acceptanceCriteria, ["Typed outcome delivered"]);
  assertEquals(coordinator.requests[1].sequence, 2);
});
