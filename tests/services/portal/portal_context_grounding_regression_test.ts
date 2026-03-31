/**
 * @module PortalContextGroundingRegressionTest
 * @path tests/services/portal/portal_context_grounding_regression_test.ts
 * @description Verifies that the RequestProcessor correctly injects deep portal
 * file structures into the LLM prompt for better agent grounding.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { TestEnvironment } from "../../integration/helpers/test_environment.ts";
import { join } from "@std/path";
import { MockStrategy } from "../../../src/shared/enums.ts";

Deno.test("Regression: Portal Context Grounding - deeper file summary in prompt", async () => {
  const env = await TestEnvironment.create({ initGit: false });

  try {
    // 1. Create a deep portal structure (3 levels)
    const portalPath = join(env.tempDir, "target-repo");
    await Deno.mkdir(join(portalPath, "src/cli/commands"), { recursive: true });
    await Deno.writeTextFile(join(portalPath, "src/cli/commands/init.ts"), "// init");
    await Deno.writeTextFile(join(portalPath, "src/cli/commands/plan.ts"), "// plan");
    await Deno.writeTextFile(join(portalPath, "src/index.ts"), "// index");

    // 2. Setup MockLLMProvider to capture prompts
    // Use MockStrategy.RECORDED to trigger default pattern fallbacks in MockLLMProvider
    const { provider, processor } = env.createRequestProcessor({
      providerMode: MockStrategy.RECORDED,
    });

    // 3. Create request with portal
    const { filePath: requestPath } = await env.createRequest("Fix plan command", {
      portal: "target-repo",
    });

    // Manually register portal in environment config
    env.config.portals = [{
      alias: "target-repo",
      target_path: portalPath,
    }];

    // 4. Process request to generate a plan
    await processor.process(requestPath);

    // 5. Inspect the prompt sent to LLM
    const lastCall = provider.getLastCall();
    assert(lastCall, "LLM should have been called during plan generation");

    const prompt = lastCall.prompt;

    // Verify that the deep file structure is present in the prompt's PORTAL REPOSITORY CONTEXT
    // Note: The tree view shows filenames relative to their parent
    assertStringIncludes(prompt, "init.ts");
    assertStringIncludes(prompt, "plan.ts");
    assertStringIncludes(prompt, "commands");
    assertStringIncludes(prompt, "src");

    console.log("✅ Grounding regression test passed: Deep portal structure detected in prompt");
  } finally {
    await env.cleanup();
  }
});
