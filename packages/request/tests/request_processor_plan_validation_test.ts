/**
 * @module PlanValidationRequestTest
 * @path packages/request/tests/request_processor_plan_validation_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description Verifies the RequestProcessor's resilience when handling invalid plans,
 * ensuring rejected content is captured for debugging without breaking the execution loop.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse } from "@std/yaml";

import type { IApplicationContext } from "@exaix/core/types";
import { RequestProcessor } from "@exaix/request";
import type { IRequestProcessingContext } from "@exaix/request";
import { CostTracker } from "@exaix/core/cost";
import { PlanValidationError } from "@exaix/core/planning";
import { PlanStatus } from "@exaix/core/status";
import type { JSONObject } from "@exaix/core/types";
import { MiddlewarePipeline } from "@exaix/core/func";
import { makeRequestProcessorEnv } from "./request_test_helpers.ts";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "@exaix/testing";

function parseFrontmatter(content: string): JSONObject {
  const parts = content.split("---");
  if (parts.length < 3) {
    throw new Error("Invalid markdown content: missing YAML frontmatter delimiters.");
  }
  return parse(parts[1]) as JSONObject;
}

// Core Error Handling Tests

async function setupPlanValidationEnv(requestContentTemplate: string) {
  const { db, config, tempDir, cleanup, requestsDir, blueprintsPath } = await makeRequestProcessorEnv();
  const costTracker = new CostTracker(db, config);

  const traceId = crypto.randomUUID();
  const requestId = `request-${traceId.slice(0, 8)}`;
  const requestPath = join(requestsDir, `${requestId}.md`);

  const requestContent = requestContentTemplate.replace("{traceId}", traceId);
  await Deno.writeTextFile(requestPath, requestContent);
  let testPipelineFactory: (() => MiddlewarePipeline<IRequestProcessingContext>) | undefined;

  const context: IApplicationContext = {
    config: createStubConfig(config),
    db,
    provider: createStubProvider(),
    git: createStubGit(),
    display: createStubDisplay(db),
  };

  const processor = new RequestProcessor({
    workspacePath: join(tempDir, config.paths.workspace),
    requestsDir,
    blueprintsPath,
    includeReasoning: false,
    context,
    costTracker,
    testPipelineFactory: () => {
      if (!testPipelineFactory) {
        throw new Error("testPipelineFactory not configured");
      }
      return testPipelineFactory();
    },
  });

  return {
    tempDir,
    processor,
    requestPath,
    requestId,
    traceId,
    db,
    config,
    setTestPipelineFactory(factory: () => MiddlewarePipeline<IRequestProcessingContext>): void {
      testPipelineFactory = factory;
    },
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

    env.setTestPipelineFactory(() => {
      const pipeline = new MiddlewarePipeline<IRequestProcessingContext>();
      pipeline.use(() => {
        throw error;
      });
      return pipeline;
    });

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

Deno.test("RequestProcessor: rejected draft carries.agent_role for attribution (parity with accepted plans)", async () => {
  const env = await setupPlanValidationEnv(
    `---
trace_id: "{traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: security-expert
source: cli
created_by: "test@example.com"
---

Audit this code.
`,
  );

  try {
    env.setTestPipelineFactory(() => {
      const pipeline = new MiddlewarePipeline<IRequestProcessingContext>();
      pipeline.use(() => {
        throw new PlanValidationError("Plan structure is invalid", {
          rawContent: "I am operating as the security expert. (not valid JSON)",
          fullRawResponse: "raw",
        });
      });
      return pipeline;
    });

    await env.processor.process(env.requestPath);

    const rejectedPath = join(
      env.tempDir,
      env.config.paths.workspace,
      env.config.paths.rejected,
      `${env.requestId}_rejected.md`,
    );
    const content = await Deno.readTextFile(rejectedPath);
    const frontmatter = parseFrontmatter(content);
    // The identity that produced the rejected output must be recorded, so the
    // identity e2e (and any reviewer) can attribute the draft to its persona.
    assertEquals(frontmatter.agent_role, "security-expert");
  } finally {
    await env.cleanup();
  }
});
