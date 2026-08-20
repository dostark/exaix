/**
 * @module MockPlanGenerationIntegrationTest
 * @path tests/integration/plan_mock_generation_test.ts
 * @description Verifies plan generation using the MockLLMProvider, ensuring correct
 * RequestProcessor integration and accurate IActivity logging for generated plans.
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { EvaluationCategory } from "@exaix/core";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { readFixtureTextSync } from "@exaix/testing";

Deno.test("Integration: RequestProcessor with MockLLMProvider", async (t) => {
  const env = await TestEnvironment.create();

  try {
    let requestPath: string;
    let planPath: string;

    // Setup: Create blueprint and processor
    const fixture_1 = readFixtureTextSync(
      import.meta.url,
      "integration",
      "plan_mock_generation_test",
      "fixture_1.md",
    );
    await env.createBlueprint(
      fixture_1,
    );

    const { processor } = env.createRequestProcessor();

    // ========================================================================
    // Test: Full integration - Request → IBlueprint as Blueprint → MockProvider → Plan
    // ========================================================================
    await t.step("End-to-end: Request file to plan generation", async () => {
      const requestResult = await env.createRequest(
        "Implement user authentication with JWT tokens",
        { identityId: "senior-coder", priority: 7, tags: ["feature", EvaluationCategory.SECURITY] },
      );

      requestPath = requestResult.filePath;
      const processorResult = await processor.process(requestPath);

      assertExists(processorResult, "RequestProcessor should generate plan");
      planPath = processorResult;

      // Verify plan file exists on filesystem
      const planExists = await Deno.stat(planPath).then(() => true).catch(() => false);
      assert(planExists, "Plan file should exist on filesystem");
    });

    // ========================================================================
    // Test: PlanWriter integration - MockProvider output → Formatted plan
    // ========================================================================
    await t.step("PlanWriter processes MockProvider output correctly", async () => {
      const planContent = await Deno.readTextFile(planPath);

      // PlanWriter should process <thought>/<content> tags into sections
      assertStringIncludes(planContent, "## Reasoning", "PlanWriter should create Reasoning section");
      assertStringIncludes(
        planContent,
        "## Execution Steps",
        "PlanWriter should create Execution Steps section (JSON format)",
      );
    });

    // ========================================================================
    // Test: RequestProcessor updates request status
    // ========================================================================
    await t.step("RequestProcessor updates request status to 'planned'", async () => {
      const requestContent = await Deno.readTextFile(requestPath);
      assertStringIncludes(requestContent, "status: planned", "Status should update after planning");
    });
  } finally {
    await env.cleanup();
  }
});

// ============================================================================
// Test: Concurrent Request Processing (Integration-specific)
// ============================================================================

Deno.test("Integration: Concurrent Requests with Shared MockLLMProvider", async () => {
  const env = await TestEnvironment.create();

  try {
    // Setup blueprint and processor (shared provider instance)
    await env.createBlueprint(
      "senior-coder",
      `# Senior Coder IBlueprint as Blueprint\n\nYou are an expert software developer.\n\n## Response Format\n\nAlways respond with:\n- <thought> tags containing your analysis\n- <content> tags containing the implementation plan\n`,
    );

    const { processor } = env.createRequestProcessor();

    // Create and process multiple requests concurrently
    const requests = await Promise.all([
      env.createRequest("Implement feature A"),
      env.createRequest("Fix bug B"),
      env.createRequest("Add feature C"),
    ]);

    const planPaths = await Promise.all(
      requests.map((r) => processor.process(r.filePath)),
    );

    // Verify all succeeded with shared provider
    assertEquals(planPaths.length, 3, "All concurrent requests should succeed");
    for (const planPath of planPaths) {
      assertExists(planPath, "Each plan should be generated");

      // Verify file exists
      const exists = await Deno.stat(planPath).then(() => true).catch(() => false);
      assert(exists, "Plan file should exist");
    }

    // Verify each plan has correct trace_id correlation
    for (let i = 0; i < planPaths.length; i++) {
      const planContent = await Deno.readTextFile(planPaths[i]!);
      assertStringIncludes(
        planContent,
        requests[i].traceId,
        "Plan should reference correct trace_id",
      );
    }
  } finally {
    await env.cleanup();
  }
});

// ============================================================================
// Test: IActivity Logging Integration
// ============================================================================

Deno.test("Integration: Mock Plan Generation - IActivity Logging", async () => {
  const env = await TestEnvironment.create();

  try {
    // Setup blueprint and processor
    await env.createBlueprint(
      "senior-coder",
      `# Senior Coder IBlueprint as Blueprint\n\nYou are an expert software developer.\n\n## Response Format\n\nAlways respond with:\n- <thought> tags containing your analysis\n- <content> tags containing the implementation plan\n`,
    );

    const { processor } = env.createRequestProcessor();

    const result = await env.createRequest("Implement feature X");
    await processor.process(result.filePath);

    // Wait for activity log writes
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify RequestProcessor logged activities
    const activities = await env.getActivityLog(result.traceId);
    assert(activities.length > 0, "RequestProcessor should log activities");

    const actionTypes = activities.map((a) => a.action_type);
    const hasProcessing = actionTypes.some((t) => t.includes("request.processing"));
    const hasPlanned = actionTypes.some((t) => t.includes("request.planned"));

    assert(
      hasProcessing || hasPlanned,
      "Should log request.processing or request.planned",
    );
  } finally {
    await env.cleanup();
  }
});

Deno.test("[regression] RequestProcessor copies target_branch into plan frontmatter", async () => {
  const env = await TestEnvironment.create();
  try {
    const fixture_2 = readFixtureTextSync(
      import.meta.url,
      "integration",
      "plan_mock_generation_test",
      "fixture_2.md",
    );
    await env.createBlueprint(
      "senior-coder",
      fixture_2,
    );

    const { processor } = env.createRequestProcessor();
    const targetBranch = "release_1.2";

    const requestResult = await env.createRequest(
      "Implement branch-targeted change",
      { identityId: "senior-coder", targetBranch },
    );

    const planPath = await processor.process(requestResult.filePath);
    assertExists(planPath, "RequestProcessor should generate plan");

    const planContent = await Deno.readTextFile(planPath);
    assertStringIncludes(planContent, `target_branch: ${targetBranch}`);
  } finally {
    await env.cleanup();
  }
});
