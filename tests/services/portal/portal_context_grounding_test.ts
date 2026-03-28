/**
 * @module PortalContextGroundingTest
 * @path tests/portal_context_grounding_test.ts
 * @description Verifies that the RequestProcessor correctly injects portal-specific
 * context, such as file lists and repository structure, into agent prompts.
 */

import { assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { RequestProcessor } from "../../../src/services/request_processor.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { MockLLMProvider } from "../../../src/ai/providers/mock_llm_provider.ts";
import { MockStrategy } from "../../../src/shared/enums.ts";

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
    }];

    // 2. Setup agent blueprint
    const blueprintsDir = join(tempDir, "Blueprints", "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    await Deno.writeTextFile(
      join(blueprintsDir, "code-analyst.md"),
      `---
identity_id: code-analyst
name: Code Analyst
model: mock
provider: mock
---
You are a code analyst. portal context follows.`,
    );

    // 3. Setup Mock LLM to capture prompt
    const mockProvider = new MockLLMProvider(MockStrategy.SCRIPTED, {
      responses: [
        '<thought>Analyzing...</thought><content>{"title":"Report","description":"Analysis","analysis":{}}</content>',
      ],
    });

    const processor = new RequestProcessor(config, db, {
      workspacePath: join(tempDir, "Workspace"),
      requestsDir: join(tempDir, "Requests"),
      blueprintsPath: blueprintsDir,
      includeReasoning: true,
    }, mockProvider);

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
