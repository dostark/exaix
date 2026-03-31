/**
 * @module PlanValidationRequestTest
 * @path tests/services/request/request_processor_plan_validation_test.ts
 * @description Verifies the RequestProcessor's resilience when handling invalid plans,
 * ensuring rejected content is captured for debugging without breaking the execution loop.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse } from "@std/yaml";

import { IApplicationContext } from "../../../src/shared/interfaces/i_application_context.ts";
import { RequestProcessor } from "../../../src/services/request/request_processor.ts";
import { CostTracker } from "../../../src/services/cost/cost_tracker.ts";
import { PlanValidationError } from "../../../src/services/plan/plan_adapter.ts";
import { PlanStatus } from "../../../src/shared/status/plan_status.ts";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import type { JSONObject } from "../../../src/shared/types/json.ts";
import { makeRequestProcessorEnv } from "./request_test_helpers.ts";

function parseFrontmatter(content: string): JSONObject {
  const parts = content.split("---");
  if (parts.length < 3) {
    throw new Error("Invalid markdown content: missing YAML frontmatter delimiters.");
  }
  return parse(parts[1]) as JSONObject;
}

// ============================================================================
// Core Error Handling Tests
// ============================================================================

async function setupPlanValidationEnv(requestContentTemplate: string) {
  const { db, config, tempDir, cleanup, requestsDir, blueprintsPath } = await makeRequestProcessorEnv();
  const costTracker = new CostTracker(db, config);

  const traceId = crypto.randomUUID();
  const requestId = `request-${traceId.slice(0, 8)}`;
  const requestPath = join(requestsDir, `${requestId}.md`);

  const requestContent = requestContentTemplate.replace("{traceId}", traceId);
  await Deno.writeTextFile(requestPath, requestContent);

  const context: IApplicationContext = {
    config: { get: () => config, getChecksum: () => "test" } as any,
    db,
    provider: null as any,
    git: {} as any,
    display: new EventLogger({ db, defaultActor: "test" }),
  };

  const processor = new RequestProcessor({
    workspacePath: join(tempDir, config.paths.workspace),
    requestsDir,
    blueprintsPath,
    includeReasoning: false,
    context,
    costTracker,
  });

  return {
    tempDir,
    processor,
    requestPath,
    requestId,
    traceId,
    db,
    config,
    cleanup: async () => {
      await costTracker.flush();
      await cleanup();
    },
  };
}

Deno.test("RequestProcessor: PlanValidationError saves rejected raw content and marks request failed", async () => {
  const env = await setupPlanValidationEnv(
    `---
trace_id: "{traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
flow: code-review
source: cli
created_by: "test@example.com"
---

Do flow work.
`,
  );

  try {
    const error = new PlanValidationError("Plan structure is invalid", {
      rawContent: "# Invalid Plan Body\nMissing required sections.",
      fullRawResponse: "Complete LLM response here",
    });

    // Mock createRequestProcessingPipeline to inject a failing middleware
    const originalCreate = (env.processor as any).createRequestProcessingPipeline;
    (env.processor as any).createRequestProcessingPipeline = function () {
      const pipeline = originalCreate.apply(this);
      pipeline.use(() => {
        throw error;
      });
      return pipeline;
    };

    await env.processor.process(env.requestPath);

    const rejectedPath = join(
      env.tempDir,
      env.config.paths.workspace,
      env.config.paths.rejected,
      `${env.requestId}_rejected.md`,
    );
    const rejectedStat = await Deno.stat(rejectedPath).catch(() => null);
    assertEquals(!!rejectedStat, true, "Rejected plan file should be created");

    const content = await Deno.readTextFile(rejectedPath);
    const frontmatter = parseFrontmatter(content);
    assertEquals(frontmatter.status, PlanStatus.REJECTED);
    assertEquals(frontmatter.request_id, env.requestId);
    assertStringIncludes(content, "# Invalid Plan Body");
  } finally {
    await env.cleanup();
  }
});
