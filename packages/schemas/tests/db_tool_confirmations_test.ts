/**
 * @module DatabaseToolConfirmationsTest
 * @path packages/schemas/tests/db_tool_confirmations_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Round-trip tests for pending tool confirmation persistence.
 */

import { assertEquals } from "@std/assert";
import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { initTestDbService } from "@exaix/testing";

function createRequest(id: string): ToolConfirmationRequest {
  return {
    id,
    toolName: "exaix_create_request",
    args: { title: "Create request" },
    stepId: "step-1",
    traceId: "trace-1",
    requestedAt: "2026-05-18T10:00:00.000Z",
    expiresAt: "2026-05-18T10:02:00.000Z",
  };
}

Deno.test("DatabaseService tool confirmations: insert + list pending round-trips request", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const request = createRequest(crypto.randomUUID());

    await db.insertToolConfirmationRequest(request);

    const pending = await db.listPendingToolConfirmations();
    assertEquals(pending, [request]);
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService tool confirmations: write decision + get decision round-trips decision", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const request = createRequest(crypto.randomUUID());
    await db.insertToolConfirmationRequest(request);

    await db.writeToolConfirmationDecision(request.id, {
      approved: false,
      reason: "Not now",
      decidedAt: "2026-05-18T10:01:00.000Z",
      decidedBy: "senior-coder",
    });

    const decision = await db.getToolConfirmationDecision(request.id);
    assertEquals(decision, {
      id: request.id,
      approved: false,
      reason: "Not now",
      decidedAt: "2026-05-18T10:01:00.000Z",
      decidedBy: "senior-coder",
    });
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService tool confirmations: get decision returns null for missing id", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const decision = await db.getToolConfirmationDecision(crypto.randomUUID());
    assertEquals(decision, null);
  } finally {
    await cleanup();
  }
});
