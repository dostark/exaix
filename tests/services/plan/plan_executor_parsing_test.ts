// deno-lint-ignore-file no-explicit-any
/**
 * @module PlanExecutorParsingTest
 * @path tests/services/plan/plan_executor_parsing_test.ts
 * @description Verifies the parsing logic for agent execution plans, ensuring correct
 * extraction of tool sequences and argument structures.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { getWorkspaceActiveDir } from "../../helpers/paths_helper.ts";
import { parse } from "@std/yaml";

import type { JSONObject } from "@exaix/core/types/json.ts";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";

interface Frontmatter {
  trace_id?: string;
  request_id?: string;
  agent?: string;
  status?: string;
  created_at?: string;
  [key: string]: any;
}

Deno.test("Plan Executor - Parsing", async (t) => {
  const testDir = await Deno.makeTempDir({ prefix: "plan-parsing-test-" });

  await t.step("Plan Structure Extraction", async (t) => {
    await t.step("should extract steps from plan body", async () => {
      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent.md",
      );
      const planPath = join(testDir, "test_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      // Parse the plan
      const content = await Deno.readTextFile(planPath);
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      assertExists(bodyMatch);

      const body = bodyMatch[1];
      const stepMatches = [...body.matchAll(/## Step \d+: ([^\n]+)\n([\s\S]*?)(?=## Step \d+:|$)/g)];

      assertEquals(stepMatches.length, 2);
      assertEquals(stepMatches[0][1], "Create User Model");
      assertEquals(stepMatches[1][1], "Add Validation");
    });

    await t.step("should extract step descriptions and tasks", async () => {
      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent_1.md",
      );
      const planPath = join(testDir, "test_plan2.md");
      await Deno.writeTextFile(planPath, planContent);

      const content = await Deno.readTextFile(planPath);
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      const body = bodyMatch![1];

      const stepMatches = [...body.matchAll(/## Step \d+: ([^\n]+)\n([\s\S]*?)(?=## Step \d+:|$)/g)];
      const step1Content = stepMatches[0][2];

      // Check description
      assertEquals(step1Content.includes("Create the database schema"), true);

      // Check tasks
      assertEquals(step1Content.includes("- Create users table"), true);
      assertEquals(step1Content.includes("- Add indexes"), true);
      assertEquals(step1Content.includes("- Set up migrations"), true);
    });

    await t.step("should handle plans with single step", async () => {
      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent_2.md",
      );
      const planPath = join(testDir, "single_step_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      const content = await Deno.readTextFile(planPath);
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      const body = bodyMatch![1];

      const stepMatches = [...body.matchAll(/## Step \d+: ([^\n]+)\n([\s\S]*?)(?=## Step \d+:|$)/g)];

      assertEquals(stepMatches.length, 1);
      assertEquals(stepMatches[0][1], "Quick Fix");
    });
  });

  await t.step("Context Extraction", async (t) => {
    await t.step("should extract request_id from frontmatter", async () => {
      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent_3.md",
      );
      const planPath = join(testDir, "context_plan1.md");
      await Deno.writeTextFile(planPath, planContent);

      const content = await Deno.readTextFile(planPath);
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      assertExists(frontmatterMatch);

      const frontmatter = parse(frontmatterMatch[1]) as JSONObject;

      assertEquals(frontmatter.request_id, "req-789");
    });

    await t.step("should extract agent from frontmatter", async () => {
      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent_4.md",
      );
      const planPath = join(testDir, "context_plan2.md");
      await Deno.writeTextFile(planPath, planContent);

      const content = await Deno.readTextFile(planPath);
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

      const frontmatter = parse(frontmatterMatch![1]) as JSONObject;

      assertEquals(frontmatter.identity, "mock-agent");
    });

    await t.step("should handle missing optional context fields", async () => {
      const planContent = `---
trace_id: test-trace-123
---

# Plan
## Step 1: Minimal plan
`;

      const planPath = join(testDir, "minimal_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      const content = await Deno.readTextFile(planPath);
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

      const frontmatter = parse(frontmatterMatch![1]) as JSONObject;

      assertEquals(frontmatter.request_id, undefined);
      assertEquals(frontmatter.identity, undefined);
      assertExists(frontmatter.trace_id); // Only trace_id is required
    });
  });

  await t.step("Plan Validation", async (t) => {
    await t.step("should validate plan has at least one step", async () => {
      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent_5.md",
      );
      const planPath = join(testDir, "no_steps_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      const content = await Deno.readTextFile(planPath);
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      const body = bodyMatch![1];

      const stepMatches = [...body.matchAll(/## Step \d+: ([^\n]+)/g)];

      assertEquals(stepMatches.length, 0);
      // This should be caught as validation error
    });

    await t.step("should validate step numbering is sequential", async () => {
      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent_6.md",
      );
      const planPath = join(testDir, "invalid_numbering.md");
      await Deno.writeTextFile(planPath, planContent);

      const content = await Deno.readTextFile(planPath);
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      const body = bodyMatch![1];

      const stepMatches = [...body.matchAll(/## Step (\d+): ([^\n]+)/g)];

      assertEquals(stepMatches.length, 3);

      // Check if numbering is sequential
      const stepNumbers = stepMatches.map((m) => parseInt(m[1]));
      const isSequential = stepNumbers.every((num, idx) => num === idx + 1);

      assertEquals(isSequential, false);
      // Should be detected as invalid sequential numbering
    });

    await t.step("should validate steps have titles", async () => {
      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent_7.md",
      );
      const planPath = join(testDir, "missing_title.md");
      await Deno.writeTextFile(planPath, planContent);

      const content = await Deno.readTextFile(planPath);
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      const body = bodyMatch![1];

      const stepMatches = [...body.matchAll(/## Step (\d+): ([^\n]*)/g)];

      // Check if all steps have non-empty titles
      const hasEmptyTitle = stepMatches.some((m) => m[2].trim() === "");

      assertEquals(hasEmptyTitle, false);
      // Should be caught as valid (no empty titles)
    });
  });

  await t.step("Error Handling", async (t) => {
    await t.step("should handle plan with no body section", async () => {
      const planContent = `---
trace_id: test-trace-123
---`;

      const planPath = join(testDir, "no_body.md");
      await Deno.writeTextFile(planPath, planContent);

      const content = await Deno.readTextFile(planPath);
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);

      assertEquals(bodyMatch, null);
      // Should be caught and logged as parsing error
    });

    await t.step("should handle malformed step headers", async () => {
      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent_8.md",
      );
      const planPath = join(testDir, "malformed_headers.md");
      await Deno.writeTextFile(planPath, planContent);

      const content = await Deno.readTextFile(planPath);
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      const body = bodyMatch![1];

      // Strict regex: only matches "## Step \d+: Title"
      const stepMatches = [...body.matchAll(/## Step (\d+): ([^\n]+)/g)];

      assertEquals(stepMatches.length, 1); // Only Step 3 matches
      assertEquals(stepMatches[0][2], "Valid Step");
    });

    await t.step("should handle empty step content", async () => {
      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent_9.md",
      );
      const planPath = join(testDir, "empty_content.md");
      await Deno.writeTextFile(planPath, planContent);

      const content = await Deno.readTextFile(planPath);
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      const body = bodyMatch![1];

      const stepMatches = [...body.matchAll(/## Step \d+: ([^\n]+)\n([\s\S]*?)(?=## Step \d+:|$)/g)];

      assertEquals(stepMatches.length, 2);

      // Step 1 has empty/whitespace-only content
      const step1Content = stepMatches[0][2].trim();
      assertEquals(step1Content, "");

      // Step 2 has content
      const step2Content = stepMatches[1][2].trim();
      assertEquals(step2Content.includes("Some content here"), true);
    });
  });

  await t.step("Integration with File System", async (t) => {
    await t.step("should read and parse real plan file", async () => {
      const activePath = getWorkspaceActiveDir(testDir);
      await ensureDir(activePath);

      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent_10.md",
      );
      const planPath = join(activePath, "integration_test_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      // Full parsing flow
      const content = await Deno.readTextFile(planPath);

      // Parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      assertExists(frontmatterMatch);

      const frontmatter = parse(frontmatterMatch[1]) as Frontmatter;

      assertEquals(frontmatter.trace_id, "integration-test-123");
      assertEquals(frontmatter.request_id, "integration-req-456");
      assertEquals(frontmatter.identity, "mock-agent");

      // Parse body
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      assertExists(bodyMatch);

      const body = bodyMatch[1];
      const stepMatches = [...body.matchAll(/## Step (\d+): ([^\n]+)\n([\s\S]*?)(?=## Step \d+:|$)/g)];

      assertEquals(stepMatches.length, 3);

      // Validate step 1
      assertEquals(stepMatches[0][1], "1");
      assertEquals(stepMatches[0][2], "Create User Model");
      assertEquals(stepMatches[0][3].includes("Add User interface"), true);

      // Validate step 2
      assertEquals(stepMatches[1][1], "2");
      assertEquals(stepMatches[1][2], "Add Authentication Routes");
      assertEquals(stepMatches[1][3].includes("POST /api/auth/signup"), true);

      // Validate step 3
      assertEquals(stepMatches[2][1], "3");
      assertEquals(stepMatches[2][2], "Add Middleware");
      assertEquals(stepMatches[2][3].includes("Verify JWT tokens"), true);
    });

    await t.step("should parse plan from Workspace/Active directory", async () => {
      const activePath = getWorkspaceActiveDir(testDir);
      await ensureDir(activePath);

      const planContent = readFixtureTextSync(
        import.meta.url,
        "services",
        "plan",
        "plan_executor_parsing_test",
        "planContent_11.md",
      );
      const planPath = join(activePath, "quick_fix_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      // Verify file exists in expected location
      const fileInfo = await Deno.stat(planPath);
      assertEquals(fileInfo.isFile, true);

      // Parse it
      const content = await Deno.readTextFile(planPath);
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

      const frontmatter = parse(frontmatterMatch![1]) as Frontmatter;

      assertEquals(frontmatter.trace_id, "fs-test-789");

      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      const body = bodyMatch![1];
      const stepMatches = [...body.matchAll(/## Step (\d+): ([^\n]+)/g)];

      assertEquals(stepMatches.length, 1);
      assertEquals(stepMatches[0][2], "Update Config");
    });
  });

  // Cleanup
  await Deno.remove(testDir, { recursive: true });
});
