/**
 * @module CliConfirmationInterceptorTest
 * @path packages/tool-runtime/tests/cli_confirmation_interceptor_test.ts
 * @description Focused tests for the synchronous Phase 79 CLI confirmation adapter.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT,
  TOOL_CONFIRMATION_EVENT_APPROVED,
  TOOL_CONFIRMATION_EVENT_DENIED,
} from "@exaix/core";
import { CliConfirmationInterceptor } from "@exaix/tool-runtime";
import { createToolConfirmationRequest, MockActivityJournal } from "./helpers/confirmation_test_helpers.ts";

Deno.test("CliConfirmationInterceptor: 'y' input approves the request", async () => {
  const journal = new MockActivityJournal();
  const interceptor = new CliConfirmationInterceptor(
    journal,
    1000,
    () => Promise.resolve("y"),
  );

  const decision = await interceptor.requestApproval(createToolConfirmationRequest());

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

  const decision = await interceptor.requestApproval(createToolConfirmationRequest());

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

  const decision = await interceptor.requestApproval(createToolConfirmationRequest());

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

  const decision = await interceptor.requestApproval(createToolConfirmationRequest());

  assertEquals(decision.approved, false);
  assertEquals(decision.reason, "TIMEOUT");
  assertEquals(decision.decidedBy, TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT);
  assertEquals(journal.getEntries()[0].event, TOOL_CONFIRMATION_EVENT_DENIED);
  assertEquals(journal.getEntries()[0].decidedBy, TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT);
  assertStringIncludes(String(journal.getEntries()[0].tool), "exaix_create_request");
});
