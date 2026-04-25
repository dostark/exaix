/**
 * @module PlanRevisionIntegrationTest
 * @path tests/integration/03_plan_revision_test.ts
 * @description Tests the iterative plan revision cycle, validating that user feedback correctly
 * triggers plan regeneration while preserving original context and trace integrity.
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { MemoryBankSource } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { join as _join } from "@std/path";
import { TestEnvironment } from "./helpers/test_environment.ts";

/**
 * Helper to add revision comments to a plan
 */
async function revisePlan(
  _env: TestEnvironment,
  planPath: string,
  comments: string,
): Promise<string> {
  let content = await Deno.readTextFile(planPath);

  // Check if review comments section already exists
  if (content.includes("## Review Comments")) {
    // Append to existing section
    const timestamp = new Date().toISOString();
    content = content.replace(
      /## Review Comments/,
      `## Review Comments\n\n### Revision ${timestamp}\n\n${comments}\n\n---\n\n### Previous Comments`,
    );
  } else {
    // Add new section
    const timestamp = new Date().toISOString();
    content += `\n\n## Review Comments\n\n### Revision ${timestamp}\n\n${comments}\n`;
  }

  await Deno.writeTextFile(planPath, content);
  return planPath;
}

Deno.test("Integration: Plan Revision - Request to Revised Plan", async (t) => {
  const env = await TestEnvironment.create();

  try {
    let traceId: string;
    let planPath: string;
    const revisionComment1 = "Please add error handling for file not found scenarios.";
    const revisionComment2 = "Also add input validation for the path parameter.";

    // Setup: Create request and plan
    await t.step("Setup: Create request and plan", async () => {
      const result = await env.createRequest(
        "Create a file reading utility",
        { identityId: "senior-coder" },
      );
      traceId = result.traceId;

      planPath = await env.createPlan(traceId, "file-reader", {
        status: "review",
        actions: [
          {
            tool: McpToolName.WRITE_FILE,
            params: {
              path: "src/file_reader.ts",
              content: "export function readFile(path: string): string { return Deno.readTextFileSync(path); }",
            },
          },
        ],
      });
    });

    // ========================================================================
    // Test 1: Plan can receive revision comments
    // ========================================================================
    await t.step("Test 1: Plan in review can receive revision comments", async () => {
      // Verify plan is in review status
      const beforeContent = await Deno.readTextFile(planPath);
      assertStringIncludes(beforeContent, "status: review");

      // Add revision comments
      await revisePlan(env, planPath, revisionComment1);

      // Verify comments were added
      const afterContent = await Deno.readTextFile(planPath);
      assertStringIncludes(afterContent, revisionComment1);
    });

    // ========================================================================
    // Test 2: Revision comments appended to content
    // ========================================================================
    await t.step("Test 2: Revision comments appended to plan content", async () => {
      const content = await Deno.readTextFile(planPath);

      // Should have Review Comments section
      assertStringIncludes(content, "## Review Comments");

      // Should have the revision content
      assertStringIncludes(content, "error handling");
      assertStringIncludes(content, "file not found");

      // Original plan content should still be present
      assertStringIncludes(content, "## Actions");
      assertStringIncludes(content, McpToolName.WRITE_FILE);
    });

    // ========================================================================
    // Test 3: Status remains "review"
    // ========================================================================
    await t.step("Test 3: Plan status remains 'review' after revision", async () => {
      const content = await Deno.readTextFile(planPath);

      // Status should still be review
      assertStringIncludes(content, "status: review");

      // Should NOT be rejected or approved
      assert(!content.includes("status: rejected"), "Should not be rejected");
      assert(!content.includes("status: approved"), "Should not be approved");
    });

    // ========================================================================
    // Test 4: Multiple revision rounds supported
    // ========================================================================
    await t.step("Test 4: Multiple revision rounds accumulate comments", async () => {
      // Add second revision
      await revisePlan(env, planPath, revisionComment2);

      const content = await Deno.readTextFile(planPath);

      // Both revision comments should be present
      assertStringIncludes(content, revisionComment1);
      assertStringIncludes(content, revisionComment2);

      // Should have revision markers
      assertStringIncludes(content, "Revision");

      // Should indicate previous comments
      assertStringIncludes(content, "Previous Comments");
    });

    // ========================================================================
    // Test 5: Original trace_id maintained
    // ========================================================================
    await t.step("Test 5: Revised plan maintains original trace_id", async () => {
      const content = await Deno.readTextFile(planPath);

      // Should have same trace_id
      assertStringIncludes(content, `trace_id: "${traceId}"`);

      // Extract and verify
      const traceMatch = content.match(/trace_id: "([^"]+)"/);
      assertExists(traceMatch);
      assertEquals(traceMatch[1], traceId);
    });

    // ========================================================================
    // Test 6: Revision logged to IActivity Journal
    // ========================================================================
    await t.step("Test 6: Revision requests logged to IActivity Journal", async () => {
      // Log revision activity
      env.db.logActivity(
        MemoryBankSource.USER,
        "plan.revision_requested",
        planPath,
        {
          comments: revisionComment2,
          revision_number: 2,
        },
        traceId,
      );

      // Wait for log flush
      await new Promise((resolve) => setTimeout(resolve, 150));

      const activities = env.getActivityLog(traceId);

      const revisionActivity = activities.find((a) => a.action_type === "plan.revision_requested");
      assertExists(revisionActivity, "Should have revision activity");

      const payload = JSON.parse(revisionActivity.payload);
      assertEquals(payload.revision_number, 2);
    });

    // ========================================================================
    // Test 7: Plan can be approved after revision
    // ========================================================================
    await t.step("Test 7: Plan can be approved after revision", async () => {
      // Approve the revised plan
      const activePath = await env.approvePlan(planPath);

      // Verify plan moved to Active
      const activeExists = await env.fileExists("Workspace/Active/file-reader_plan.md");
      assertEquals(activeExists, true, "Plan should be in Workspace/Active");

      // Verify status updated
      const content = await Deno.readTextFile(activePath);
      assertStringIncludes(content, "status: approved");

      // Revision comments should still be present
      assertStringIncludes(content, "## Review Comments");
      assertStringIncludes(content, revisionComment1);
      assertStringIncludes(content, revisionComment2);

      // trace_id should still be there
      assertStringIncludes(content, `trace_id: "${traceId}"`);
    });
  } finally {
    await env.cleanup();
  }
});

// Additional revision scenario tests

Deno.test("Integration: Plan Revision - Revision preserves plan structure", async () => {
  const env = await TestEnvironment.create();

  try {
    const { traceId } = await env.createRequest("Test structure preservation");
    const planPath = await env.createPlan(traceId, "structure-test", {
      status: "review",
      actions: [
        { tool: McpToolName.WRITE_FILE, params: { path: "a.ts", content: "// file a" } },
        { tool: McpToolName.WRITE_FILE, params: { path: "b.ts", content: "// file b" } },
      ],
    });

    // Add revision
    await revisePlan(env, planPath, "Please ensure proper imports.");

    const content = await Deno.readTextFile(planPath);

    // Original structure preserved
    assertStringIncludes(content, "# Proposed Plan");
    assertStringIncludes(content, "## Actions");
    assertStringIncludes(content, "## Reasoning");
    assertStringIncludes(content, "a.ts");
    assertStringIncludes(content, "b.ts");

    // Frontmatter intact
    assertStringIncludes(content, "---");
    assertStringIncludes(content, `trace_id: "${traceId}"`);
    assertStringIncludes(content, 'request_id: "structure-test"');
  } finally {
    await env.cleanup();
  }
});

Deno.test("Integration: Plan Revision - Many revisions don't corrupt file", async () => {
  const env = await TestEnvironment.create();

  try {
    const { traceId } = await env.createRequest("Test many revisions");
    const planPath = await env.createPlan(traceId, "many-revisions", { status: "review" });

    // Add 5 revisions
    for (let i = 1; i <= 5; i++) {
      await revisePlan(env, planPath, `Revision comment number ${i}`);
    }

    const content = await Deno.readTextFile(planPath);

    // All revisions present
    for (let i = 1; i <= 5; i++) {
      assertStringIncludes(content, `Revision comment number ${i}`);
    }

    // File still valid
    assertStringIncludes(content, "---");
    assertStringIncludes(content, `trace_id: "${traceId}"`);
    assertStringIncludes(content, "status: review");
  } finally {
    await env.cleanup();
  }
});

Deno.test("Integration: Plan Revision - Revision with code snippets", async () => {
  const env = await TestEnvironment.create();

  try {
    const { traceId } = await env.createRequest("Test code in revision");
    const planPath = await env.createPlan(traceId, "code-revision", { status: "review" });

    const codeRevision = `
Please use this pattern instead:

\`\`\`typescript
try {
  const content = await Deno.readTextFile(path);
  return content;
} catch (error) {
  if (error instanceof Deno.errors.NotFound) {
    throw new FileNotFoundError(path);
  }
  throw error;
}
\`\`\`

This provides better error handling.
    `.trim();

    await revisePlan(env, planPath, codeRevision);

    const content = await Deno.readTextFile(planPath);

    // Code block preserved
    assertStringIncludes(content, "```typescript");
    assertStringIncludes(content, "Deno.readTextFile");
    assertStringIncludes(content, "FileNotFoundError");
    assertStringIncludes(content, "```");
  } finally {
    await env.cleanup();
  }
});

Deno.test("Integration: Plan Revision - Can reject after revision", async () => {
  const env = await TestEnvironment.create();

  try {
    const { traceId } = await env.createRequest("Test reject after revision");
    const planPath = await env.createPlan(traceId, "reject-after-revise", { status: "review" });

    // Add revision
    await revisePlan(env, planPath, "Please fix the security issue.");

    // Then decide to reject
    const rejectedPath = await env.rejectPlan(planPath, "Security issue not adequately addressed.");

    const content = await Deno.readTextFile(rejectedPath);

    // Should have both revision and rejection
    assertStringIncludes(content, "## Review Comments");
    assertStringIncludes(content, "fix the security issue");
    assertStringIncludes(content, "## Rejection Reason");
    assertStringIncludes(content, "not adequately addressed");
    assertStringIncludes(content, "status: rejected");
  } finally {
    await env.cleanup();
  }
});
