/**
 * @module RequestCancelWatcherTest
 * @path tests/integration/request_cancel_watcher_test.ts
 * @description Verifies that a request cancel is seen by the real daemon file watcher as one change of the request file, and that the temporary file of the cancel never reaches the watcher callback.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/path, @exaix/request, @exaix/testing, tests/helpers/watcher_test_helper.ts]
 * @related-files [packages/request/src/service.ts, apps/daemon/src/watcher.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { RequestService } from "@exaix/request";
import { createMockConfig, createStubDisplay } from "@exaix/testing";
import { createWatcherTestContext } from "../helpers/watcher_test_helper.ts";

/** A safety net only: a watcher that never reports the change fails the test instead of hanging it. */
const WATCHER_GUARD_MS = 15_000;
const CANCELLED_STATUS_LINE = "status: cancelled";

Deno.test("a request cancel reaches the daemon watcher as one change of the request file and never shows its temporary file", async () => {
  const { helper, cleanup } = await createWatcherTestContext("request-cancel-watcher-");
  try {
    await helper.createWorkspaceStructure();
    const service = new RequestService({
      config: createMockConfig(helper.tempDir),
      display: createStubDisplay(),
      userIdentityGetter: () => Promise.resolve("tester"),
    });

    const paths: string[] = [];
    let cancelledSeen!: (content: string) => void;
    const cancelled = new Promise<string>((resolve) => cancelledSeen = resolve);
    const watcher = helper.createWatcher((event) => {
      paths.push(event.path);
      if (event.content.includes(CANCELLED_STATUS_LINE)) cancelledSeen(event.content);
    });
    await helper.startWatcher(watcher);

    const created = await service.create("Cancel under a running watcher");
    await service.cancelRequest(created.trace_id, undefined);

    const guard = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("the watcher did not report the cancelled request")), WATCHER_GUARD_MS);
    });
    const content = await Promise.race([cancelled, guard]);
    await helper.stopWatcher(watcher);

    assertStringIncludes(content, CANCELLED_STATUS_LINE);
    assertEquals([...new Set(paths)], [join(helper.requestDir, created.filename)]);
  } finally {
    await cleanup();
  }
});
