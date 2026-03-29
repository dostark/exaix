/**
 * @module ActivityJournalTest
 * @path tests/journal/activity_journal_test.ts
 * @description Unit tests for ActivityJournal audit logging.
 */
import { assertEquals } from "@std/assert";
import { ActivityJournal } from "../../src/journal/activity_journal.ts";
import { IFlowEventLogger } from "../../src/flows/flow_runner.ts";
import { JSONValue } from "../../src/shared/types/json.ts";

Deno.test("ActivityJournal - logs entries with traceId", async () => {
  let loggedEvent: any;
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

  assertEquals(loggedEvent.traceId, "test-trace");
  assertEquals(loggedEvent.action, "test-event");
  assertEquals(loggedEvent.target, "step-1");
  assertEquals(loggedEvent.data, "some data");
});
