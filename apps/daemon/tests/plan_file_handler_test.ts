/**
 * @module PlanFileHandlerTest
 * @path apps/daemon/tests/plan_file_handler_test.ts
 * @description In-process tests for the Active-plans watcher handler. They cover the plan filter,
 *   the detection row, each execution outcome, and error propagation to the watcher.
 * @architectural-layer Tests
 * @related-files [apps/daemon/src/plan_file_handler.ts, apps/daemon/main.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import { createMockEventLogger } from "@exaix/testing";
import type { IExecutionResult } from "@exaix/execution";
import { type IPlanExecutor, PlanFileHandler } from "../src/plan_file_handler.ts";

const ACTIVE_DIR = "/workspace/Active";
const PLAN_PATH = `${ACTIVE_DIR}/request-1234_plan.md`;
const PLAN_CONTENT = "---\nstatus: approved\n---\n# Plan\n";
const TRACE_ID = "11111111-1111-4111-8111-111111111111";
const FAILURE_REASON = "Invalid plan frontmatter";
const EXECUTOR_CRASH = "executor crashed";

class RecordingExecutor implements IPlanExecutor {
  readonly planPaths: string[] = [];

  constructor(private readonly outcome: () => Promise<IExecutionResult>) {}

  processTask(planPath: string): Promise<IExecutionResult> {
    this.planPaths.push(planPath);
    return this.outcome();
  }
}

function succeeding(): RecordingExecutor {
  return new RecordingExecutor(() => Promise.resolve({ success: true, traceId: TRACE_ID }));
}

Deno.test("[plan_file_handler] ignores files that are not plan files", async () => {
  const executor = succeeding();
  const logger = createMockEventLogger();
  const handler = new PlanFileHandler(executor, logger);

  await handler.handle({ path: `${ACTIVE_DIR}/README.md`, content: PLAN_CONTENT });
  await handler.handle({ path: `${ACTIVE_DIR}/request-notes_planning.md`, content: PLAN_CONTENT });

  assertEquals(executor.planPaths, []);
  assertEquals(logger.events, []);
});

Deno.test("[plan_file_handler] journals detection with the content length, then the successful outcome", async () => {
  const executor = succeeding();
  const logger = createMockEventLogger();

  await new PlanFileHandler(executor, logger).handle({ path: PLAN_PATH, content: PLAN_CONTENT });

  assertEquals(executor.planPaths, [PLAN_PATH]);
  const [detected, outcome] = logger.events;
  assertEquals(detected.action, DomainEventType.PlanDetected);
  assertEquals(detected.target, PLAN_PATH);
  assertEquals(detected.payload, { size: PLAN_CONTENT.length });
  assertEquals(outcome.action, DomainEventType.PlanExecutionManaged);
  assertEquals(outcome.target, PLAN_PATH);
  assertEquals(outcome.payload, { trace_id: TRACE_ID, status: "completed" });
  assertEquals(logger.events.length, 2);
});

Deno.test("[plan_file_handler] journals a failed run with its trace id and reason", async () => {
  const executor = new RecordingExecutor(() =>
    Promise.resolve({ success: false, traceId: TRACE_ID, error: FAILURE_REASON })
  );
  const logger = createMockEventLogger();

  await new PlanFileHandler(executor, logger).handle({ path: PLAN_PATH, content: PLAN_CONTENT });

  const [, outcome] = logger.events;
  assertEquals(outcome.action, DomainEventType.PlanExecutionManagedFailure);
  assertEquals(outcome.target, PLAN_PATH);
  assertEquals(outcome.payload, { trace_id: TRACE_ID, error: FAILURE_REASON });
  assertEquals(logger.events.length, 2);
});

Deno.test("[plan_file_handler] lets an executor error reach the watcher without an outcome row", async () => {
  const executor = new RecordingExecutor(() => Promise.reject(new Error(EXECUTOR_CRASH)));
  const logger = createMockEventLogger();

  await assertRejects(
    () => new PlanFileHandler(executor, logger).handle({ path: PLAN_PATH, content: PLAN_CONTENT }),
    Error,
    EXECUTOR_CRASH,
  );

  assertEquals(logger.events.map((event) => event.action), [DomainEventType.PlanDetected]);
});
