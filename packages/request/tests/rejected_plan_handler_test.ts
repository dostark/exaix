/**
 * @module RejectedPlanHandlerTest
 * @path packages/request/tests/rejected_plan_handler_test.ts
 * @architectural-layer Services
 * @description Verifies RejectedPlanHandler persists a rejected-plan artifact
 * to Workspace/Rejected/ and marks the request FAILED with a rejected_path
 * reference on PlanValidationError, and marks FAILED without artifact
 * persistence for other errors. Direct unit coverage for the extracted
 * handler (god-object decomposition of RequestProcessor).
 * @related-files [packages/request/src/rejected_plan_handler.ts, packages/request/src/processor.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { RejectedPlanHandler, StatusManager } from "@exaix/request";
import { createMockConfig, createMockEventLogger } from "@exaix/testing";
import { PlanValidationError } from "@exaix/core/planning";
import { RequestStatus } from "@exaix/core/status";
import { PlanStatus } from "@exaix/core/status";
import type { IRequestFrontmatter } from "@exaix/core/request";
import { RequestSource } from "@exaix/core";

async function makeHandlerTestSetup() {
  const testDir = await Deno.makeTempDir({ prefix: "exa_rejected_plan_handler_test_" });
  const config = createMockConfig(testDir);
  const filePath = join(testDir, "req-1.md");
  await Deno.writeTextFile(
    filePath,
    ["---", `status: "${RequestStatus.PENDING}"`, "---", "Do the thing."].join("\n"),
  );
  const statusManager = new StatusManager(createMockEventLogger());
  const handler = new RejectedPlanHandler({ config, statusManager });
  return { testDir, config, filePath, handler };
}

function makeFrontmatter(overrides: Partial<IRequestFrontmatter> = {}): IRequestFrontmatter {
  return {
    trace_id: "trace-1",
    created: new Date().toISOString(),
    status: RequestStatus.PENDING,
    priority: "normal",
    source: RequestSource.CLI,
    created_by: "user",
    ...overrides,
  };
}

Deno.test("[RejectedPlanHandler.handleError] PlanValidationError persists a rejected artifact and marks FAILED", async () => {
  const { testDir, config, filePath, handler } = await makeHandlerTestSetup();
  try {
    const error = new PlanValidationError("Invalid plan JSON", { rawContent: "{ broken json" });
    await handler.handleError(error, filePath, "req-1", createMockEventLogger(), makeFrontmatter());

    const requestContent = await Deno.readTextFile(filePath);
    assertStringIncludes(requestContent, `status: ${RequestStatus.FAILED}`);
    assertStringIncludes(requestContent, "rejected_path:");

    const rejectedDir = join(config.system.root, config.paths.workspace, config.paths.rejected);
    const rejectedPath = join(rejectedDir, "req-1_rejected.md");
    const rejectedContent = await Deno.readTextFile(rejectedPath);
    assertStringIncludes(rejectedContent, `status: ${PlanStatus.REJECTED}`);
    assertStringIncludes(rejectedContent, "Invalid plan JSON");
    assertStringIncludes(rejectedContent, "{ broken json");
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[RejectedPlanHandler.handleError] PlanValidationError includes identity_id when frontmatter has identity", async () => {
  const { testDir, config, filePath, handler } = await makeHandlerTestSetup();
  try {
    const error = new PlanValidationError("Invalid plan JSON", { rawContent: "bad" });
    await handler.handleError(
      error,
      filePath,
      "req-1",
      createMockEventLogger(),
      makeFrontmatter({ identity: "coder-agent" }),
    );

    const rejectedDir = join(config.system.root, config.paths.workspace, config.paths.rejected);
    const rejectedContent = await Deno.readTextFile(join(rejectedDir, "req-1_rejected.md"));
    assertStringIncludes(rejectedContent, "identity_id: coder-agent");
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[RejectedPlanHandler.handleError] non-validation error marks FAILED without a rejected artifact", async () => {
  const { testDir, config, filePath, handler } = await makeHandlerTestSetup();
  try {
    await handler.handleError(
      new Error("network timeout"),
      filePath,
      "req-1",
      createMockEventLogger(),
      makeFrontmatter(),
    );

    const requestContent = await Deno.readTextFile(filePath);
    assertStringIncludes(requestContent, `status: ${RequestStatus.FAILED}`);
    assertEquals(requestContent.includes("rejected_path:"), false);

    const rejectedDir = join(config.system.root, config.paths.workspace, config.paths.rejected);
    let rejectedExists = true;
    try {
      await Deno.stat(join(rejectedDir, "req-1_rejected.md"));
    } catch {
      rejectedExists = false;
    }
    assertEquals(rejectedExists, false);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});
