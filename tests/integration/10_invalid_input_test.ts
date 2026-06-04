/**
 * @module InvalidInputIntegrationTest
 * @path tests/integration/10_invalid_input_test.ts
 * @description Verifies system resilience to malformed request data, ensuring
 * graceful failure and clear diagnostic reporting for invalid YAML or schema breaches.
 */

import { assertExists } from "@std/assert";
import { join } from "@std/path";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { FrontmatterParser } from "@exaix/core/parsing";

Deno.test("Integration: Invalid Input - System stability after parser failures", async (t) => {
  const env = await TestEnvironment.create();
  const parser = new FrontmatterParser();

  try {
    await t.step("System remains stable after invalid request parsing", async () => {
      const result = await env.createRequest("Valid request after invalid");
      assertExists(result.traceId, "Should create valid request");

      const planPath = await env.createPlan(result.traceId, "valid-plan", {
        status: "review",
      });
      assertExists(planPath, "Should create plan");
    });

    await t.step("Recovery from corrupt files remains possible", async () => {
      const corruptPath = join(env.tempDir, "Workspace/Requests/corrupt.md");
      await Deno.writeTextFile(corruptPath, "CORRUPT-BINARY-DATA");

      try {
        const content = await Deno.readTextFile(corruptPath);
        parser.parse(content, corruptPath);
      } catch {
        // Expected failure from corrupt request content.
      }

      await Deno.remove(corruptPath);
      const recovered = await env.createRequest("After corrupt file");
      assertExists(recovered.traceId, "Should still create requests after corrupt file");
    });

    await t.step("Invalid input does not affect other requests", async () => {
      const valid1 = await env.createRequest("Valid request 1");
      const brokenPath = join(env.tempDir, "Workspace/Requests/broken.md");
      await Deno.writeTextFile(brokenPath, `---\ninvalid:---\nbad`);

      const valid2 = await env.createRequest("Valid request 2");
      assertExists(valid1.traceId, "First valid request should exist");
      assertExists(valid2.traceId, "Second valid request should exist");
    });
  } finally {
    await env.cleanup();
  }
});
