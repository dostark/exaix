/**
 * @module StatusManagerTest
 * @path tests/services/status/status_manager_test.ts
 * @description Verifies the logic for atomic status updates in file frontmatter, ensuring
 * correct state transitions for agents, plans, and requests without corrupting files.
 */

import { assertEquals } from "@std/assert";
import { StatusManager } from "../../../src/services/request_processing/status_manager.ts";
import { RequestStatus } from "@exaix/core";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import { createStubDb } from "../../helpers/test_helpers.ts";

Deno.test("StatusManager.updateStatus: rewrites status in frontmatter", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = `${tempDir}/request.md`;
  const original = "---\nstatus: pending\n---\nBody\n";
  await Deno.writeTextFile(filePath, original);

  try {
    const db = createStubDb();
    const logger = new EventLogger({ db });
    const mgr = new StatusManager(logger);

    await mgr.updateStatus(filePath, RequestStatus.FAILED);

    const updatedContent = await Deno.readTextFile(filePath);
    assertEquals(updatedContent.includes("status: failed"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("StatusManager.updateStatus: logs on write failure", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = `${tempDir}/request.md`;
  // We'll make it fail by making it a directory or removing permissions if possible,
  // but a simpler way is to just mock the logger and ensure it handles errors if we were to mock Deno.
  // Actually, to test "logs on write failure", we still need to trigger a failure.
  // If we can't easily trigger a real failure, we might have to mock Deno, but we should do it at least with proper typing.

  const original = "---\nstatus: pending\n---\n";
  await Deno.writeTextFile(filePath, original);

  type TestPayload = Record<string, string | number | boolean | null | undefined>;
  const calls: Array<
    {
      actor: string;
      actionType: string;
      target: string | null;
      payload: TestPayload;
      traceId?: string;
      identityId?: string | null;
    }
  > = [];
  const db = createStubDb({
    logActivity: (
      actor: string,
      actionType: string,
      target: string | null,
      payload: TestPayload,
      traceId?: string,
      identityId?: string | null,
    ) => {
      calls.push({ actor, actionType, target, payload, traceId, identityId });
    },
  });
  const logger = new EventLogger({ db });

  // In this specific case, to test failure, we can make the file read-only or similar.
  // Or, if we REALLY must mock Deno, we use a type-safe way.
  const mgr = new StatusManager(logger);

  // Trigger error by giving a non-existent path OR a directory path
  await mgr.updateStatus(tempDir, RequestStatus.FAILED);

  assertEquals(calls.length > 0, true);
  const errorEvent = calls.find((c) => c.actionType === "request.status_update_failed");
  assertEquals(!!errorEvent, true);

  await Deno.remove(tempDir, { recursive: true });
});
