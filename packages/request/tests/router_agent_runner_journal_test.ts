/**
 * @module RouterAgentRunnerJournalTest
 * @path packages/request/tests/router_agent_runner_journal_test.ts
 * @description Verifies RequestRouter's routeToAgent/routeToDefaultAgent wrap agentRunner.run()
 *   with Activity Journal execution-start/complete/error logging tagged
 *   runnerKind: RunnerKind.AGENT_RUNNER — the request/routing pipeline emitted no such events
 *   before Phase 180 Step 5.
 * @architectural-layer Services
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  AGENT_EVENT_EXECUTION_COMPLETED,
  AGENT_EVENT_EXECUTION_FAILED,
  AGENT_EVENT_EXECUTION_STARTED,
  AGENT_RUNNER_ID,
  RunnerKind,
} from "@exaix/core";
import type { ILogEvent } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { IAgentExecutionResult, IAgentRunner, IBlueprint, IParsedRequest } from "@exaix/execution";
import {
  createMockFlowRunner,
  createMockFlowValidator,
  createTestRequestRouter,
  sampleRouterRequest,
} from "@exaix/testing";

function createCapturingLogger(events: ILogEvent[]): IEventLogger {
  const log = (e: ILogEvent): Promise<void> => {
    events.push(e);
    return Promise.resolve();
  };
  return {
    log,
    info: (action, target, payload, traceId) => log({ action, target: target ?? "", payload, traceId }),
    warn: (action, target, payload, traceId) => log({ action, target: target ?? "", payload, traceId }),
    error: (action, target, payload, traceId) => log({ action, target: target ?? "", payload, traceId }),
    fatal: (action, target, payload, traceId) => log({ action, target: target ?? "", payload, traceId }),
    debug: (action, target, payload, traceId) => log({ action, target: target ?? "", payload, traceId }),
    child: () => createCapturingLogger(events),
  };
}

function createSucceedingAgentRunner(): IAgentRunner {
  return {
    run(blueprint: IBlueprint): Promise<IAgentExecutionResult> {
      return Promise.resolve({ thought: "thought", content: `Agent ${blueprint.agentRole} executed`, raw: "raw" });
    },
  };
}

function createThrowingAgentRunner(error: Error): IAgentRunner {
  return {
    run(_blueprint: IBlueprint, _request: IParsedRequest): Promise<IAgentExecutionResult> {
      return Promise.reject(error);
    },
  };
}

Deno.test("[new] RequestRouter.routeToAgent logs runnerKind: RunnerKind.AGENT_RUNNER on successful agentRunner.run() completion", async () => {
  const events: ILogEvent[] = [];
  const router = createTestRequestRouter({
    flowRunner: createMockFlowRunner(),
    agentRunner: createSucceedingAgentRunner(),
    flowValidator: createMockFlowValidator(),
    logger: createCapturingLogger(events),
  });

  const request = sampleRouterRequest({ frontmatter: { agent_role: "senior-coder" } });
  await router.routeToAgent("senior-coder", request);

  const started = events.find((e) => e.action === AGENT_EVENT_EXECUTION_STARTED);
  const completed = events.find((e) => e.action === AGENT_EVENT_EXECUTION_COMPLETED);
  assertExists(started, "AGENT_EVENT_EXECUTION_STARTED must be logged");
  assertExists(completed, "AGENT_EVENT_EXECUTION_COMPLETED must be logged");
  assertEquals(started.runnerId, AGENT_RUNNER_ID);
  assertEquals(started.runnerKind, RunnerKind.AGENT_RUNNER);
  assertEquals(completed.runnerId, AGENT_RUNNER_ID);
  assertEquals(completed.runnerKind, RunnerKind.AGENT_RUNNER);
});

Deno.test("[new] RequestRouter.routeToAgent logs runnerKind: RunnerKind.AGENT_RUNNER with AGENT_EVENT_EXECUTION_FAILED on a thrown error from agentRunner.run()", async () => {
  const events: ILogEvent[] = [];
  const failure = new Error("provider unavailable");
  const router = createTestRequestRouter({
    flowRunner: createMockFlowRunner(),
    agentRunner: createThrowingAgentRunner(failure),
    flowValidator: createMockFlowValidator(),
    logger: createCapturingLogger(events),
  });

  const request = sampleRouterRequest({ frontmatter: { agent_role: "senior-coder" } });
  await assertRejects(() => router.routeToAgent("senior-coder", request), Error, "provider unavailable");

  const started = events.find((e) => e.action === AGENT_EVENT_EXECUTION_STARTED);
  const failed = events.find((e) => e.action === AGENT_EVENT_EXECUTION_FAILED);
  assertExists(started, "AGENT_EVENT_EXECUTION_STARTED must be logged even though the run later fails");
  assertExists(failed, "AGENT_EVENT_EXECUTION_FAILED must be logged");
  assertEquals(failed.runnerId, AGENT_RUNNER_ID);
  assertEquals(failed.runnerKind, RunnerKind.AGENT_RUNNER);
  const completed = events.find((e) => e.action === AGENT_EVENT_EXECUTION_COMPLETED);
  assertEquals(completed, undefined, "no completion event should be logged when the run throws");
});

Deno.test("[new] RequestRouter.routeToDefaultAgent logs runnerKind: RunnerKind.AGENT_RUNNER on successful agentRunner.run() completion", async () => {
  const events: ILogEvent[] = [];
  const router = createTestRequestRouter({
    flowRunner: createMockFlowRunner(),
    agentRunner: createSucceedingAgentRunner(),
    flowValidator: createMockFlowValidator(),
    logger: createCapturingLogger(events),
  });

  const request = sampleRouterRequest({ frontmatter: {} });
  await router.routeToDefaultAgent(request);

  const started = events.find((e) => e.action === AGENT_EVENT_EXECUTION_STARTED);
  const completed = events.find((e) => e.action === AGENT_EVENT_EXECUTION_COMPLETED);
  assertExists(started, "AGENT_EVENT_EXECUTION_STARTED must be logged");
  assertExists(completed, "AGENT_EVENT_EXECUTION_COMPLETED must be logged");
  assertEquals(started.runnerKind, RunnerKind.AGENT_RUNNER);
  assertEquals(completed.runnerKind, RunnerKind.AGENT_RUNNER);
});
