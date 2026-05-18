/**
 * @module CliConfirmationInterceptorTest
 * @path tests/services/tool/cli_confirmation_interceptor_test.ts
 * @description Focused tests for the synchronous Phase 79 CLI confirmation adapter.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT,
  TOOL_CONFIRMATION_EVENT_APPROVED,
  TOOL_CONFIRMATION_EVENT_DENIED,
} from "@exaix/core";
import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import type { IActivityJournal, JournalEntry } from "../../../src/flows/dynamic_step_executor.ts";
import { CliConfirmationInterceptor } from "../../../src/services/tool/cli_confirmation_interceptor.ts";

class MockActivityJournal implements IActivityJournal {
  private entries: JournalEntry[] = [];

  getEntries(): JournalEntry[] {
    return [...this.entries];
  }

  log(entry: JournalEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

function createRequest(): ToolConfirmationRequest {
  const requestedAt = new Date();
  return {
    id: crypto.randomUUID(),
    toolName: "exaix_create_request",
    args: { title: "Create request" },
    stepId: "step-1",
    traceId: "trace-1",
    requestedAt: requestedAt.toISOString(),
    expiresAt: new Date(requestedAt.getTime() + 120000).toISOString(),
  };
}

Deno.test("CliConfirmationInterceptor: 'y' input approves the request", async () => {
  const journal = new MockActivityJournal();
  const interceptor = new CliConfirmationInterceptor(
    journal,
    1000,
    () => Promise.resolve("y"),
  );

  const decision = await interceptor.requestApproval(createRequest());

  assertEquals(decision.approved, true);
  assertEquals(decision.reason, undefined);
  assertEquals(journal.getEntries()[0].event, TOOL_CONFIRMATION_EVENT_APPROVED);
});

Deno.test("CliConfirmationInterceptor: 'n' input denies with user-declined reason", async () => {
  const journal = new MockActivityJournal();
  const interceptor = new CliConfirmationInterceptor(
    journal,
    1000,
    () => Promise.resolve("n"),
  );

  const decision = await interceptor.requestApproval(createRequest());

  assertEquals(decision.approved, false);
  assertEquals(decision.reason, "User declined");
  assertEquals(journal.getEntries()[0].event, TOOL_CONFIRMATION_EVENT_DENIED);
  assertEquals(journal.getEntries()[0].reason, "User declined");
});

Deno.test("CliConfirmationInterceptor: empty input denies with user-declined reason", async () => {
  const journal = new MockActivityJournal();
  const interceptor = new CliConfirmationInterceptor(
    journal,
    1000,
    () => Promise.resolve(""),
  );

  const decision = await interceptor.requestApproval(createRequest());

  assertEquals(decision.approved, false);
  assertEquals(decision.reason, "User declined");
  assertEquals(journal.getEntries()[0].event, TOOL_CONFIRMATION_EVENT_DENIED);
});

Deno.test("CliConfirmationInterceptor: timeout auto-denies and records timeout sentinel", async () => {
  const journal = new MockActivityJournal();
  const interceptor = new CliConfirmationInterceptor(
    journal,
    1,
    () => new Promise<string | null>(() => undefined),
  );

  const decision = await interceptor.requestApproval(createRequest());

  assertEquals(decision.approved, false);
  assertEquals(decision.reason, "TIMEOUT");
  assertEquals(decision.decidedBy, TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT);
  assertEquals(journal.getEntries()[0].event, TOOL_CONFIRMATION_EVENT_DENIED);
  assertEquals(journal.getEntries()[0].decidedBy, TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT);
  assertStringIncludes(String(journal.getEntries()[0].tool), "exaix_create_request");
});
