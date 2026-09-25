/**
 * @module RequestProcessorRejectionStatusTest
 * @path packages/request/tests/request_processor_rejection_status_test.ts
 * @description Phase-197 Step 14 (GAP-7): a request file whose effort/thinking declaration
 *   is rejected at the parse boundary must fail VISIBLY — the file's status becomes
 *   RequestStatus.FAILED through the status manager, and a RequestFailed event naming the
 *   field is logged through a trace-scoped child logger, joinable to the request's own
 *   trace_id.
 * @architectural-layer Services
 * @related-files [packages/request/src/processor.ts, packages/request/src/processing/parser.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { type IRequestProcessorConfig, RequestProcessor } from "@exaix/request";
import { EventLogger } from "@exaix/core/logger";
import type { IApplicationContext } from "@exaix/core/types";
import {
  createStubConfig,
  createStubDisplay,
  createStubGit,
  createStubProvider,
  getBlueprintsAgentsDir,
  getWorkspaceDir,
  getWorkspaceRequestsDir,
  initTestDbService,
} from "@exaix/testing";

Deno.test("[process] an injected effort in a request file sets status failed and logs RequestFailed with the trace id", async () => {
  const { db, config, cleanup, tempDir } = await initTestDbService();
  try {
    await Deno.mkdir(getWorkspaceRequestsDir(tempDir), { recursive: true });
    await Deno.mkdir(join(tempDir, "Workspace", "Plans"), { recursive: true });
    await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, "Blueprints", "Agents", "default.md"),
      "---\nagent_role: default\n---\n\nYou are a helpful assistant.\n",
    );

    const traceId = crypto.randomUUID();
    const requestPath = join(getWorkspaceRequestsDir(tempDir), `request-${traceId.slice(0, 8)}.md`);
    await Deno.writeTextFile(
      requestPath,
      `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: default
source: cli
created_by: "test@example.com"
subject: "Rejected Request"
effort: turbo
---

# Request

Do the thing.
`,
    );

    const provider = createStubProvider("<thought>ok</thought><content>done</content>");
    const logger = new EventLogger({ db });
    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      provider,
      git: createStubGit(),
      display: createStubDisplay(db),
    };
    const processor = new RequestProcessor(
      {
        workspacePath: getWorkspaceDir(tempDir),
        requestsDir: getWorkspaceRequestsDir(tempDir),
        blueprintsPath: getBlueprintsAgentsDir(tempDir),
        includeReasoning: true,
        context,
        testProvider: provider,
        logger,
      } satisfies IRequestProcessorConfig,
    );

    const result = await processor.process(requestPath);
    assertEquals(result, null, "a rejected file must produce no plan path");
    await db.waitForFlush();

    const fileContent = await Deno.readTextFile(requestPath);
    assertEquals(
      fileContent.includes("status: failed"),
      true,
      "the request file must be visibly failed, not left pending",
    );

    const failedRows = await db.queryActivity({ traceId, actionType: "request.failed" });
    assertEquals(failedRows.length, 1, "one RequestFailed event must be logged for the trace");
    const payload = JSON.parse(failedRows[0].payload) as { error?: string; field?: string };
    assertEquals(payload.field, "effort");
    assertEquals(payload.error !== undefined && payload.error.includes("effort"), true);
  } finally {
    await cleanup();
  }
});
