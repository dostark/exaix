/**
 * @module ActivityJournalTest
 * @path tests/journal/activity_journal_test.ts
 * @description Unit tests for ActivityJournal audit logging.
 */
import { assertEquals } from "@std/assert";
import { ActivityJournal } from "../../src/flows/activity_journal.ts";
import type { IFlowEventLogger, IFlowEventPayloadMap } from "../../src/flows/flow_runner.ts";
import type { JSONValue } from "@exaix/core/types/json.ts";

interface ILoggedEvent {
  action?: string;
  traceId?: string;
  target?: string;
  data?: string;
}

Deno.test("ActivityJournal - logs entries with traceId", async () => {
  let loggedEvent: ILoggedEvent | undefined;
  const mockLogger: IFlowEventLogger = {
    log: (event: string, payload: Record<string, JSONValue | undefined>) => {
      loggedEvent = { action: event, ...payload };
    },
  };

  const journal = new ActivityJournal(mockLogger);
  await journal.log({
    traceId: "test-trace",
    stepId: "step-1",
    event: "test-event",
    data: "some data",
  });

  assertEquals(loggedEvent?.traceId, "test-trace");
  assertEquals(loggedEvent?.action, "test-event");
  assertEquals(loggedEvent?.target, "step-1");
  assertEquals(loggedEvent?.data, "some data");
});

Deno.test("ActivityJournal - exposes typed payloads for known flow events", () => {
  const retryPayload: IFlowEventPayloadMap["flow.step.retry"] = {
    flowRunId: "run-1",
    stepId: "step-1",
    identityId: "senior-coder",
    attempt: 1,
    maxRetries: 2,
    error: "temporary failure",
    traceId: "trace-1",
    requestId: "request-1",
  };

  assertEquals(retryPayload.attempt, 1);
  assertEquals(retryPayload.maxRetries, 2);
});
