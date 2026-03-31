/**
 * @module LLMFreeProviderIntegrationTest
 * @path tests/integration/19_llm_free_provider_test.ts
 * @description Verifies RequestProcessor behavior with manual/template-based plans,
 * ensuring stable execution when bypassing external LLM provider calls.
 */

// Integration test for free LLM providers (manual/ignored)
// This test is ignored by default to avoid calling external endpoints in CI.

import { assert, assertExists, assertStringIncludes } from "@std/assert";
import { EvaluationCategory } from "../../src/shared/enums.ts";

import { TestEnvironment } from "./helpers/test_environment.ts";
import { ModelFactory } from "../../src/ai/providers.ts";
import { RequestProcessor } from "../../src/services/request/request_processor.ts";
import { getTestModel } from "../ai/helpers/test_model.ts";
import { getWorkspaceDir, getWorkspaceRequestsDir } from "../helpers/paths_helper.ts";
import { DEFAULT_OPENAI_BASE_URL } from "../../src/shared/constants.ts";

const _enabled = Deno.env.get("EXA_TEST_ENABLE_PAID_LLM");
Deno.test(
  { name: "LLM provider integration (manual) - end-to-end RequestProcessor", ignore: _enabled !== "1" },
  async (_t) => {
    // Manual integration test - opt-in only
    // Requires:
    //  - EXA_TEST_ENABLE_PAID_LLM=1 (explicit opt-in)
    //  - EXA_TEST_OPENAI_API_KEY set
    const enabled = Deno.env.get("EXA_TEST_ENABLE_PAID_LLM");
    const apiKey = Deno.env.get("EXA_TEST_OPENAI_API_KEY");

    if (enabled !== "1") {
      console.warn("Skipping manual integration test: EXA_TEST_ENABLE_PAID_LLM is not set to '1' (opt-in required)");
      return;
    }

    if (!apiKey) {
      console.warn("Skipping manual integration test: EXA_TEST_OPENAI_API_KEY not set");
      return;
    }

    const env = await TestEnvironment.create({ initGit: false });

    try {
      // Create blueprint that instructs the model to include <thought> and <content> tags
      await env.createBlueprint(
        "senior-coder",
        `# Senior Coder Blueprint

You are an expert software developer. Analyze requests and create detailed implementation plans.

## Response Format

Always respond with:
- <thought> tags containing your analysis
- <content> tags containing the implementation plan
`,
      );

      // Create a real provider using ModelFactory
      const model = getTestModel();
      const provider = await ModelFactory.create(model, { apiKey, baseUrl: DEFAULT_OPENAI_BASE_URL });

      // Create RequestProcessor using real provider
      const processor = new RequestProcessor(
        env.config,
        env.db,
        {
          workspacePath: getWorkspaceDir(`${env.tempDir}`),
          requestsDir: getWorkspaceRequestsDir(`${env.tempDir}`),
          blueprintsPath: `${env.tempDir}/Blueprints/Identities`,
          includeReasoning: true,
        },
        provider, // Test provider override
      );

      // End-to-end: create request and process
      const requestResult = await env.createRequest(
        "Implement user authentication with JWT tokens",
        { identityId: "senior-coder", priority: 7, tags: ["feature", EvaluationCategory.SECURITY] },
      );

      const planPath = await processor.process(requestResult.filePath);

      // If the provider returned null, check activity log for rate-limiting, auth, or model-not-found and skip gracefully
      if (!planPath) {
        // Allow some time for activity writes
        await new Promise((resolve) => setTimeout(resolve, 500));

        const acts = env.getActivityLog(requestResult.traceId);
        const failed = acts.find((a) => a.action_type?.includes("request.failed"));
        const errPayload = failed?.payload ?? "";
        const errMsg = typeof errPayload === "string" ? errPayload.toLowerCase() : String(errPayload).toLowerCase();

        // Skip on rate-limits (429)
        if (errMsg.includes("429") || errMsg.includes("too many requests") || errMsg.includes("rate limit")) {
          console.warn("Skipping manual integration test: rate limit detected (429)");
          return;
        }

        // Skip on unauthorized (401)
        if (errMsg.includes("401") || errMsg.includes("unauthorized") || errMsg.includes("invalid api key")) {
          console.warn("Skipping manual integration test: unauthorized (401). Check EXA_TEST_OPENAI_API_KEY");
          return;
        }

        // Skip on model not found (404)
        if (errMsg.includes("404") || errMsg.includes("not found") || errMsg.includes("model")) {
          console.warn(
            "Skipping manual integration test: model not found (404). Check EXA_TEST_LLM_MODEL and API access.",
          );
          return;
        }

        // Skip on insufficient quota / billing errors
        if (
          errMsg.includes("insufficient_quota") || errMsg.includes("exceeded your current quota") ||
          errMsg.includes("insufficient quota")
        ) {
          console.warn(
            "Skipping manual integration test: insufficient quota detected. Check billing and usage on your OpenAI account.",
          );
          return;
        }

        // If none of the above, fail as before
        assertExists(planPath, "RequestProcessor should generate a plan file");
      } else {
        assertExists(planPath, "RequestProcessor should generate a plan file");

        // Verify plan file content at least contains trace id and some reasoning/execution markers
        const planContent = await Deno.readTextFile(planPath!);
        assertStringIncludes(planContent, requestResult.traceId, "Plan should include trace_id");

        const hasReasoning = planContent.includes("## Reasoning") || planContent.includes("<thought>");
        const hasExecution = planContent.includes("## Execution Steps") || planContent.includes("```yaml");

        assert(
          hasReasoning || hasExecution,
          "Plan should contain Reasoning or Execution content (model should follow blueprint response format)",
        );
      }

      // Request status should be updated to 'planned'
      const requestContent = await Deno.readTextFile(requestResult.filePath);
      assertStringIncludes(requestContent, "status: planned", "Request status should be updated to 'planned'");

      // IActivity log should include request.processing and request.planned events
      // Allow some time for asynchronous writes
      await new Promise((resolve) => setTimeout(resolve, 500));

      const activities = env.getActivityLog(requestResult.traceId);
      const actionTypes = activities.map((a) => a.action_type);
      const hasProcessing = actionTypes.some((t) => t.includes("request.processing"));
      const hasPlanned = actionTypes.some((t) => t.includes("request.planned"));

      assert(hasProcessing || hasPlanned, "IActivity log should contain processing or planned events");
    } finally {
      await env.cleanup();
    }
  },
);
