/**
 * @module DogfoodSmokeTest
 * @path tests/integration/dogfood_smoke_test.ts
 * @description Verifies the request → plan pipeline using a mock provider,
 * exercising the production RequestProcessor → IAgentRunner → PlanWriter path.
 */

import { assert, assertExists, assertStringIncludes } from "@std/assert";
import { TestEnvironment } from "./helpers/test_environment.ts";

Deno.test("dogfood smoke: request → plan via RequestProcessor.process()", async (t) => {
  const env = await TestEnvironment.create();

  try {
    await env.createBlueprint("senior-coder");

    const { processor } = env.createRequestProcessor();

    let planPath: string;
    await t.step("creates request and generates plan", async () => {
      const requestResult = await env.createRequest(
        "Add a health endpoint to src/api/health.ts returning { status: 'ok' }",
        { identityId: "senior-coder", priority: 5, tags: ["feature"] },
      );

      const processorResult = await processor.process(requestResult.filePath);
      assertExists(processorResult, "RequestProcessor should generate plan");
      planPath = processorResult;

      const planExists = await env.fileExists(planPath.replace(env.tempDir + "/", ""));
      assert(planExists, "Plan file should exist on filesystem");
    });

    await t.step("plan contains expected sections", async () => {
      const planContent = await Deno.readTextFile(planPath!);

      assertStringIncludes(planContent, "## Reasoning", "Plan should contain Reasoning section");
      assertStringIncludes(planContent, "## Execution Steps", "Plan should contain Execution Steps section");
    });

    await t.step("request status updated to planned", async () => {
      const entries = (await env.listFiles("Workspace/Requests")).filter(
        (f) => f.endsWith(".md"),
      );
      assert(entries.length > 0, "Requests directory should contain .md files");

      const requestContent = await env.readFile(`Workspace/Requests/${entries[0]}`);
      assertStringIncludes(requestContent, "status: planned", "Status should update after planning");
    });
  } finally {
    await env.cleanup();
  }
});
