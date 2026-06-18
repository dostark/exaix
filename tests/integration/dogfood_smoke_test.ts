/**
 * @module DogfoodSmokeTest
 * @path tests/integration/dogfood_smoke_test.ts
 * @description Verifies the request → plan pipeline using a mock provider,
 * exercising the production RequestProcessor → AgentRunner → PlanWriter path.
 */

import { assert, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { TestEnvironment } from "./helpers/test_environment.ts";

Deno.test("dogfood smoke: request → plan via RequestProcessor.process()", async (t) => {
  const env = await TestEnvironment.create();

  try {
    await env.createBlueprint(
      "senior-coder",
    );

    const { processor } = env.createRequestProcessor();

    // ========================================================================
    // Step: Create and process a request
    // ========================================================================
    let planPath: string;
    await t.step("creates request and generates plan", async () => {
      const requestResult = await env.createRequest(
        "Add a health endpoint to src/api/health.ts returning { status: 'ok' }",
        { identityId: "senior-coder", priority: 5, tags: ["feature"] },
      );

      const processorResult = await processor.process(requestResult.filePath);
      assertExists(processorResult, "RequestProcessor should generate plan");
      planPath = processorResult;

      const planExists = await Deno.stat(planPath).then(() => true).catch(() => false);
      assert(planExists, "Plan file should exist on filesystem");
    });

    // ========================================================================
    // Step: Verify plan content
    // ========================================================================
    await t.step("plan contains expected sections", async () => {
      const planContent = await Deno.readTextFile(planPath!);

      assertStringIncludes(planContent, "## Reasoning", "Plan should contain Reasoning section");
      assertStringIncludes(planContent, "## Execution Steps", "Plan should contain Execution Steps section");
    });

    // ========================================================================
    // Step: Verify request status updated
    // ========================================================================
    await t.step("request status updated to planned", async () => {
      const requestsDir = join(env.tempDir, "Workspace", "Requests");
      const entries: string[] = [];
      for await (const entry of Deno.readDir(requestsDir)) {
        entries.push(entry.name);
      }
      assert(entries.length > 0, "Requests directory should contain files");

      // Read the only request file and verify status
      const requestContent = await Deno.readTextFile(join(requestsDir, entries[0]!));
      assertStringIncludes(requestContent, "status: planned", "Status should update after planning");
    });
  } finally {
    await env.cleanup();
  }
});
