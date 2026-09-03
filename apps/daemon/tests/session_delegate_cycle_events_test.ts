/**
 * @module SessionDelegateCycleEventsTest
 * @path apps/daemon/tests/session_delegate_cycle_events_test.ts
 * @description Phase 174 Step 3 [Tier A] test: the cycle lifecycle events
 *   (cycle_started/cycle_step_completed/cycle_completed) fire through a real EventLogger,
 *   land in the activity journal keyed by the parent trace, and carry the delegation
 *   trace and sequence fields required for trace-correlated auditing.
 * @architectural-layer Tests
 * @related-files [packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts, apps/daemon/src/flow_event_logger_adapter.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { FlowGateAction, FlowInputSource, FlowOutputFormat, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import type { IGateConfig, IGateEvaluator, IGateResult } from "@exaix/core/types";
import { initTestDbService } from "@exaix/testing";
import { FlowRunner, PlanContextResolver } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type {
  ISessionDelegationCoordinator,
  ISessionDelegationOutcome,
  ISessionDelegationRequest,
} from "@exaix/session/session_delegation.ts";
import { createFlowEventLogger } from "../src/flow_event_logger_adapter.ts";

class RecordingCoordinator implements ISessionDelegationCoordinator {
  delegate(input: ISessionDelegationRequest): Promise<ISessionDelegationOutcome> {
    return Promise.resolve({
      delegationTraceId: crypto.randomUUID(),
      parentTraceId: input.parentTraceId,
      parentStepId: input.parentStepId,
      sequence: input.sequence,
      status: "completed",
      decision: "changes_made",
      summary: `implemented step ${input.sequence}`,
      pathsTouched: [`packages/flow/src/step_${input.sequence}.ts`],
    });
  }
}

class AlwaysPassGateEvaluator implements IGateEvaluator {
  evaluate(_config: IGateConfig): Promise<IGateResult> {
    return Promise.resolve({
      passed: true,
      score: 1,
      evaluation: { score: 1, passed: true, feedback: "ok", criteriaScores: {} } as never,
      attempts: 1,
      action: FlowGateAction.PASSED,
      evaluationDurationMs: 0,
    });
  }
}

async function makeTwoStepWorktree(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "cycle-events-" });
  const dir = join(root, ".exa", "PlanContext");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "phase-174.md"),
    [
      "## Step 1\n\n**Actions:**\n- Do the first thing\n\n```yaml\n# step-manifest\nstep: 1\ntitle: First\n```\n",
      "## Step 2\n\n**Actions:**\n- Do the second thing\n\n```yaml\n# step-manifest\nstep: 2\ntitle: Second\n```\n",
    ].join("\n"),
  );
  return root;
}

function makeCycleFlow(): IFlow {
  return {
    id: "cycle-flow",
    name: "Cycle Flow",
    description: "test",
    version: "1.0",
    steps: [{
      id: "next-steps",
      name: "Next Steps",
      type: FlowStepType.SESSION_DELEGATE_CYCLE,
      agent_role: "senior-coder",
      execution_mode: FlowStepExecutionMode.DECLARED,
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
      delegateCycle: {
        requireChangedPaths: true,
        review: {
          agent_role: "senior-reviewer",
          criteria: ["correctness"],
          threshold: 0.8,
          onFail: "halt",
          maxRetries: 3,
          includeRequestCriteria: false,
        },
      },
    }],
    output: { from: "next-steps", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
  } as IFlow;
}

Deno.test("[Tier A] cycle lifecycle events carry parent and delegation trace fields through a real EventLogger", async () => {
  const { db, cleanup } = await initTestDbService();
  const root = await makeTwoStepWorktree();
  try {
    const logger = new EventLogger({ db });
    const flowRunner = new FlowRunner({
      agentExecutor: { run: () => Promise.resolve({ thought: "", content: "", raw: "" } as IAgentExecutionResult) },
      eventLogger: createFlowEventLogger(logger),
      gateEvaluator: new AlwaysPassGateEvaluator(),
      sessionDelegationCoordinator: new RecordingCoordinator(),
      planContextResolver: new PlanContextResolver(),
    });

    const traceId = crypto.randomUUID();
    await flowRunner.execute(makeCycleFlow(), {
      userPrompt: "run",
      traceId,
      requestId: "req-events",
      executionRoot: root,
      planContextRef: ".exa/PlanContext/phase-174.md",
    });

    await db.waitForFlush();
    const events = await db.getActivitiesByTraceSafe(traceId);

    const started = events.find((e) => e.action_type === DomainEventType.SessionDelegateCycleStarted);
    const completedSteps = events.filter((e) => e.action_type === DomainEventType.SessionDelegateCycleStepCompleted);
    const completed = events.find((e) => e.action_type === DomainEventType.SessionDelegateCycleCompleted);

    if (!started) throw new Error("cycle_started event was not journaled");
    assertEquals(started.trace_id, traceId);
    const startedPayload = JSON.parse(started.payload ?? "{}");
    assertEquals(startedPayload.planStepCount, 2);

    assertEquals(completedSteps.length, 2, "one cycle_step_completed event per delegated step");
    for (const event of completedSteps) {
      assertEquals(event.trace_id, traceId);
      const payload = JSON.parse(event.payload ?? "{}");
      assertEquals(typeof payload.delegationTraceId, "string");
      assertEquals(typeof payload.sequence, "number");
    }
    assertEquals(
      completedSteps.map((e) => JSON.parse(e.payload ?? "{}").sequence).sort(),
      [1, 2],
    );

    if (!completed) throw new Error("cycle_completed event was not journaled");
    assertEquals(completed.trace_id, traceId);
    assertEquals(JSON.parse(completed.payload ?? "{}").stepCount, 2);
  } finally {
    await Deno.remove(root, { recursive: true });
    await cleanup();
  }
});
