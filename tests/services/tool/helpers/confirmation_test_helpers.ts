/**
 * @module ConfirmationTestHelpers
 * @path tests/services/tool/helpers/confirmation_test_helpers.ts
 * @description Shared test helpers for tool confirmation interceptor tests.
 */

import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import type { IActivityJournal, JournalEntry } from "../../../../src/flows/dynamic_step_executor.ts";

export class MockActivityJournal implements IActivityJournal {
  private entries: JournalEntry[] = [];

  getEntries(): JournalEntry[] {
    return [...this.entries];
  }

  log(entry: JournalEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

export function createToolConfirmationRequest(
  overrides: Partial<ToolConfirmationRequest> = {},
): ToolConfirmationRequest {
  return {
    id: crypto.randomUUID(),
    toolName: "exaix_create_request",
    args: { title: "Create request" },
    stepId: "step-1",
    traceId: "trace-1",
    requestedAt: "2026-05-18T10:00:00.000Z",
    expiresAt: "2026-05-18T10:02:00.000Z",
    ...overrides,
  };
}
