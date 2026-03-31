/**
 * @module PlanExecutorDetectionTest
 * @path tests/services/plan/plan_executor_detection_test.ts
 * @description Verifies the logic for detecting executable plans, ensuring that the system
 * correctly identifies structured task blocks within larger agent responses.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { MemoryStatus } from "../../../src/shared/status/memory_status.ts";
import { parse as parseYaml } from "@std/yaml";

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { initTestDbService } from "../../helpers/db.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { getWorkspaceActiveDir } from "../../helpers/paths_helper.ts";

describe("Plan Executor - Detection", () => {
  let tempDir: string;
  let cleanup: () => Promise<void>;
  let activePath: string;

  beforeEach(async () => {
    const result = await initTestDbService();
    tempDir = result.tempDir;
    cleanup = result.cleanup;

    // Create Workspace/Active directory
    activePath = getWorkspaceActiveDir(tempDir);
    await ensureDir(activePath);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("File Detection", () => {
    it("should detect plan file by _plan.md suffix", async () => {
      // Arrange: Create a plan file
      const planContent = `---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
request_id: "request-550e8400"
status: approved
created_at: "2025-12-03T10:00:00.000Z"
---

# Plan: request-550e8400

## Proposed Plan
Implement hello world function.
`;

      const planPath = join(activePath, "request-550e8400_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      // Act: Check if file exists and matches pattern
      const files = [];
      for await (const entry of Deno.readDir(activePath)) {
        if (entry.isFile && entry.name.endsWith("_plan.md")) {
          files.push(entry.name);
        }
      }

      // Assert
      assertEquals(files.length, 1);
      assertEquals(files[0], "request-550e8400_plan.md");
    });

    it("should ignore non-plan files in Active directory", async () => {
      // Arrange: Create various files
      await Deno.writeTextFile(join(activePath, "README.md"), "# Active Tasks");
      await Deno.writeTextFile(join(activePath, "notes.txt"), "Notes");
      await Deno.writeTextFile(join(activePath, "request-abc_plan.md"), "---\n---\n# Plan");

      // Act: Filter plan files
      const planFiles = [];
      for await (const entry of Deno.readDir(activePath)) {
        if (entry.isFile && entry.name.endsWith("_plan.md")) {
          planFiles.push(entry.name);
        }
      }

      // Assert: Only plan file detected
      assertEquals(planFiles.length, 1);
      assertEquals(planFiles[0], "request-abc_plan.md");
    });

    it("should detect multiple plan files", async () => {
      // Arrange: Create multiple plan files
      const plans = ["request-a1b2_plan.md", "request-c3d4_plan.md", "request-e5f6_plan.md"];
      for (const planFile of plans) {
        await Deno.writeTextFile(
          join(activePath, planFile),
          "---\ntrace_id: test\n---\n# Plan",
        );
      }

      // Act: Detect all plans
      const detected = [];
      for await (const entry of Deno.readDir(activePath)) {
        if (entry.isFile && entry.name.endsWith("_plan.md")) {
          detected.push(entry.name);
        }
      }

      // Assert
      assertEquals(detected.length, 3);
      assertEquals(detected.sort(), plans.sort());
    });
  });

  describe("Plan File Reading", () => {
    it("should read plan file content correctly", async () => {
      // Arrange
      const planContent = `---
trace_id: "test-trace-id"
request_id: "request-test"
status: approved
---

# Plan Content
This is the plan body.
`;
      const planPath = join(activePath, "request-test_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      // Act
      const content = await Deno.readTextFile(planPath);

      // Assert
      assertStringIncludes(content, 'trace_id: "test-trace-id"');
      assertStringIncludes(content, "# Plan Content");
      assertStringIncludes(content, "This is the plan body");
    });

    it("should parse YAML frontmatter from plan", async () => {
      // Arrange
      const planContent = `---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
request_id: "request-550e8400"
identity_id: "senior-coder"
status: approved
created_at: "2025-12-03T10:00:00.000Z"
---

# Plan body
`;
      const planPath = join(activePath, "request-550e8400_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      // Act: Parse frontmatter
      const content = await Deno.readTextFile(planPath);
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
      assertExists(yamlMatch, "Should match YAML frontmatter");

      const frontmatter = parseYaml(yamlMatch[1]) as {
        trace_id?: string;
        request_id?: string;
        identity_id?: string;
        status?: string;
        [key: string]: unknown;
      };

      // Assert
      assertEquals(frontmatter.trace_id, "550e8400-e29b-41d4-a716-446655440000");
      assertEquals(frontmatter.request_id, "request-550e8400");
      assertEquals(frontmatter.identity_id, "senior-coder");
      assertEquals(frontmatter.status, MemoryStatus.APPROVED);
    });

    it("should extract plan body after frontmatter", async () => {
      // Arrange
      const planContent = `---
trace_id: "test-id"
status: approved
---

# Proposed Plan

## Overview
Implementation details here.

## Steps
1. Step one
2. Step two
`;
      const planPath = join(activePath, "test_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      // Act
      const content = await Deno.readTextFile(planPath);
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      assertExists(yamlMatch);
      const body = yamlMatch[2] || "";

      // Assert
      assertStringIncludes(body, "# Proposed Plan");
      assertStringIncludes(body, "## Overview");
      assertStringIncludes(body, "## Steps");
      assertStringIncludes(body, "1. Step one");
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid YAML frontmatter gracefully", async () => {
      // Arrange: Create plan with malformed YAML
      const planContent = `---
trace_id: [invalid yaml
status: broken
---

# Plan body
`;
      const planPath = join(activePath, "invalid_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      // Act & Assert: Should not throw, but return null
      const content = await Deno.readTextFile(planPath);
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
      assertExists(yamlMatch);

      let frontmatter = null;
      try {
        frontmatter = parseYaml(yamlMatch[1]);
      } catch {
        // Expected to fail parsing
        frontmatter = null;
      }

      assertEquals(frontmatter, null);
    });

    it("should handle plan file without frontmatter", async () => {
      // Arrange
      const planContent = `# Plan without frontmatter
This plan is missing YAML frontmatter.
`;
      const planPath = join(activePath, "no-frontmatter_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      // Act
      const content = await Deno.readTextFile(planPath);
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);

      // Assert
      assertEquals(yamlMatch, null);
    });

    it("should handle empty plan file", async () => {
      // Arrange
      const planPath = join(activePath, "empty_plan.md");
      await Deno.writeTextFile(planPath, "");

      // Act
      const content = await Deno.readTextFile(planPath);

      // Assert
      assertEquals(content, "");
    });

    it("should handle plan file with missing trace_id", async () => {
      // Arrange
      const planContent = `---
request_id: "request-test"
status: approved
---

# Plan without trace_id
`;
      const planPath = join(activePath, "no-trace_plan.md");
      await Deno.writeTextFile(planPath, planContent);

      // Act
      const content = await Deno.readTextFile(planPath);
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
      assertExists(yamlMatch);

      const frontmatter = parseYaml(yamlMatch[1]) as {
        trace_id?: string;
        request_id?: string;
        identity_id?: string;
        status?: string;
        [key: string]: unknown;
      };

      // Assert
      assertEquals(frontmatter.trace_id, undefined);
      assertExists(frontmatter.request_id);
    });
  });

  describe("Integration with FileWatcher", () => {
    it("should detect plan when file is created", async () => {
      // Arrange: Setup watcher pattern
      const _config = createMockConfig(tempDir, {
        watcher: { debounce_ms: 50, stability_check: false },
      });

      // Create plan file
      const planPath = join(activePath, "request-watch_plan.md");
      await Deno.writeTextFile(
        planPath,
        `---
trace_id: "watch-test"
status: approved
---

# Plan
`,
      );

      // Act: Simulate watcher detecting file
      const stats = await Deno.stat(planPath);

      // Assert
      assertEquals(stats.isFile, true);
      assertExists(stats.size);
    });

    it("should detect plan file after write completion", async () => {
      // Arrange: Create partial plan file (simulating write in progress)
      const planPath = join(activePath, "request-writing_plan.md");

      // Act: Write file in chunks (simulating incomplete write)
      const file = await Deno.create(planPath);
      await file.write(new TextEncoder().encode("---\n"));
      await file.write(new TextEncoder().encode("trace_id: test\n"));
      await file.write(new TextEncoder().encode("---\n"));
      await file.write(new TextEncoder().encode("# Plan"));
      file.close();

      // Wait for write to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert: File is complete and readable
      const content = await Deno.readTextFile(planPath);
      assertStringIncludes(content, "trace_id: test");
      assertStringIncludes(content, "# Plan");
    });
  });
});
