/**
 * @module StatusManagerTest
 * @path packages/core/tests/status_manager_test.ts
 * @description Verifies the logic for atomic status updates in file frontmatter, ensuring
 * correct state transitions for agents, plans, and requests without corrupting files.
 */

import { assertEquals } from "@std/assert";
import { StatusManager } from "@exaix/request";
import { RequestStatus } from "@exaix/core/status";
import { EventLogger } from "@exaix/core/logger";
import { createStubDb } from "@exaix/testing";

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

  const mgr = new StatusManager(logger);

  // tempDir is a directory, not the request file — triggers the write failure.
  await mgr.updateStatus(tempDir, RequestStatus.FAILED);

  assertEquals(calls.length > 0, true);
  const errorEvent = calls.find((c) => c.actionType === "request.status_update_failed");
  assertEquals(!!errorEvent, true);

  await Deno.remove(tempDir, { recursive: true });
});
