/**
 * @module PortalContextGroundingRegressionTest
 * @path tests/services/portal/portal_context_grounding_regression_test.ts
 * @description Verifies that the RequestProcessor correctly injects deep portal
 * file structures into the LLM prompt for better agent grounding.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { TestEnvironment } from "../../integration/helpers/test_environment.ts";
import { join } from "@std/path";
import { MockStrategy, PortalOperation } from "@exaix/core";
import { TEST_DEFAULT_BRANCH } from "../../helpers/constants.ts";

const SENIOR_CODER_BLUEPRINT_PATH = new URL("../../../Blueprints/Identities/senior-coder.md", import.meta.url);

Deno.test("Regression: Portal Context Grounding - deeper file summary in prompt", async () => {
  const env = await TestEnvironment.create({ initGit: false });

  try {
    // 1. Create a deep portal structure (3 levels)
    const portalPath = join(env.tempDir, "target-repo");
    await Deno.mkdir(join(portalPath, "src/cli/commands"), { recursive: true });
    await Deno.writeTextFile(join(portalPath, "src/cli/commands/init.ts"), "// init");
    await Deno.writeTextFile(join(portalPath, "src/cli/commands/plan.ts"), "// plan");
    await Deno.writeTextFile(join(portalPath, "src/index.ts"), "// index");

    // 2. Register portal in environment config before constructing the processor.
    env.config.portals = [{
      alias: "target-repo",
      target_path: portalPath,
      default_branch: TEST_DEFAULT_BRANCH,
      identities_allowed: ["*"],
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    }];

    await env.createBlueprint(
      "senior-coder",
      await Deno.readTextFile(SENIOR_CODER_BLUEPRINT_PATH),
    );

    // 3. Setup MockLLMProvider to capture prompts
    // Use MockStrategy.RECORDED to trigger default pattern fallbacks in MockLLMProvider
    const { provider, processor } = env.createRequestProcessor({
      providerMode: MockStrategy.RECORDED,
    });

    // 4. Create request with portal
    const { filePath: requestPath } = await env.createRequest("Fix plan command", {
      portal: "target-repo",
    });

    // 5. Process request to generate a plan
    await processor.process(requestPath);

    // 6. Inspect prompts sent to the mock provider.
    const promptHistory = provider.callHistory.map((call) => call.prompt).join("\n\n---\n\n");
    assert(provider.callHistory.length > 0, "LLM should have been called during plan generation");

    // Verify that the deep file structure is present in the prompt's PORTAL REPOSITORY CONTEXT
    // Note: The tree view shows filenames relative to their parent
    assertStringIncludes(promptHistory, "init.ts");
    assertStringIncludes(promptHistory, "plan.ts");
    assertStringIncludes(promptHistory, "commands");
    assertStringIncludes(promptHistory, "src");

    console.log("✅ Grounding regression test passed: Deep portal structure detected in prompt");
  } finally {
    await env.cleanup();
  }
});
