/**
 * @module PortalContextGroundingTest
 * @path tests/services/portal/portal_context_grounding_test.ts
 * @description Verifies that the RequestProcessor correctly injects portal-specific
 * context, such as file lists and repository structure, into agent prompts.
 */

import { assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { RequestProcessor } from "../../../src/services/request/request_processor.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { TEST_DEFAULT_BRANCH } from "../../helpers/constants.ts";

import { MockLLMProvider } from "@exaix/ai/providers/mock_llm_provider.ts";
import { MockStrategy, PortalOperation } from "@exaix/core";
import type { IApplicationContext } from "@exaix/core/types";
import { createStubConfig, createStubDisplay, createStubGit } from "../../helpers/test_helpers.ts";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";

Deno.test("RequestProcessor: Portal context includes file list for grounding", async () => {
  const { tempDir, db, config, cleanup } = await initTestDbService();

  try {
    // 1. Setup mock portal
    const portalPath = join(tempDir, "my-portal");
    await Deno.mkdir(portalPath, { recursive: true });
    await Deno.writeTextFile(join(portalPath, "README.md"), "# Mock Portal");
    await Deno.writeTextFile(join(portalPath, "index.ts"), "import { serve } from './app.ts'");
    await Deno.mkdir(join(portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(portalPath, "src", "app.ts"), "export const serve = () => {}");

    config.portals = [{
      alias: "test-portal",
      target_path: portalPath,
      default_branch: TEST_DEFAULT_BRANCH,
      identities_allowed: ["*"],
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    }];

    // 2. Setup agent blueprint
    const blueprintsDir = join(tempDir, "Blueprints", "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    const fixture_1 = readFixtureTextSync(
      import.meta.url,
      "services",
      "portal",
      "portal_context_grounding_test",
      "fixture_1.md",
    );
    await Deno.writeTextFile(join(blueprintsDir, "portal-agent.md"), fixture_1);

    // 3. Setup Mock LLM to capture prompt
    const mockProvider = new MockLLMProvider(MockStrategy.SCRIPTED, {
      responses: [
        '<thought>Analyzing...</thought><content>{"title":"Report","description":"Analysis","analysis":{}}</content>',
      ],
    });

    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      provider: mockProvider,
      git: createStubGit(),
      display: createStubDisplay(db),
    };

    const processor = new RequestProcessor({
      workspacePath: join(tempDir, "Workspace"),
      requestsDir: join(tempDir, "Requests"),
      blueprintsPath: blueprintsDir,
      includeReasoning: true,
      context,
      testProvider: mockProvider,
    });

    // 4. Create request
    const requestPath = join(tempDir, "Requests", "req1.md");
    await Deno.mkdir(join(tempDir, "Requests"), { recursive: true });
    await Deno.writeTextFile(
      requestPath,
      `---
trace_id: "t1"
identity: code-analyst
portal: test-portal
created: "${new Date().toISOString()}"
---
Analyze the portal.`,
    );

    // 5. Process
    await processor.process(requestPath);

    // 6. Assertions
    const lastCall = mockProvider.getLastCall();
    const capturedPrompt = lastCall?.prompt || "";

    assertStringIncludes(capturedPrompt, "### File List:");
    assertStringIncludes(capturedPrompt, "- README.md");
    assertStringIncludes(capturedPrompt, "- index.ts");
    assertStringIncludes(capturedPrompt, "[DIR] src");
    assertStringIncludes(capturedPrompt, "  - app.ts");
  } finally {
    await cleanup();
  }
});
