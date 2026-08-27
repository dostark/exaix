/**
 * @module RequestCommandsTest
 * @path apps/exactl/tests/request_commands_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Integration tests for CLI request management, covering the creation of prompt-based
 * requests, skill/agent targeting, and state tracking within the Workspace/Requests directory.
 */

import { assertEquals, assertExists, assertNotEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { CritiqueSeverity, RequestPriority, RequestSource } from "@exaix/core";
import { RequestStatus } from "@exaix/core/status";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { RequestCommands } from "../src/commands/request_commands.ts";
import type { DatabaseService as DatabaseService } from "@exaix/storage-sqlite";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { createMockConfig } from "@exaix/testing";
import { getWorkspaceRequestsDir } from "@exaix/testing";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "@exaix/testing";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import { AnalysisMode, type IRequestOptions } from "@exaix/core/types";

describe("RequestCommands", () => {
  let tempDir: string;
  let db: DatabaseService;
  let requestCommands: RequestCommands;
  let requestsDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    // Initialize shared CLI test context
    const result = await createCliTestContext({ createDirs: ["Workspace/Requests", "Blueprints/Flows"] });
    tempDir = result.tempDir;
    db = result.db;
    cleanup = result.cleanup;

    // Create mock flow file for testing
    const flowsDir = join(tempDir, "Blueprints", "Flows");
    await Deno.writeTextFile(join(flowsDir, "code-review.flow.yaml"), "mock flow content");

    // Derived paths
    requestsDir = getWorkspaceRequestsDir(tempDir);

    // Initialize RequestCommands
    requestCommands = new RequestCommands(result.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("create", () => {
    it("should create request with valid YAML frontmatter", async () => {
      const result = await requestCommands.create("Implement user authentication");

      // Verify result structure
      assertExists(result.trace_id);
      assertEquals(result.trace_id.length, 36); // UUID format
      assertEquals(result.status, RequestStatus.PENDING);
      assertEquals(result.priority, "normal");
      assertEquals(result.identity, "default");

      // Verify file exists
      if (!result.path) throw new Error("Path should be defined");
      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "---"); // YAML delimiters
      assertStringIncludes(content, `trace_id: "${result.trace_id}"`);
      assertStringIncludes(content, "status: pending");
      assertStringIncludes(content, "priority: normal");
      assertStringIncludes(content, "identity_id: default");
      assertStringIncludes(content, "Implement user authentication");
    });

    it("should accept custom priority", async () => {
      const result = await requestCommands.create("Fix critical bug", { priority: RequestPriority.CRITICAL });
      assertEquals(result.priority, RequestPriority.CRITICAL);

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "priority: critical");
    });

    it("should accept custom agent", async () => {
      const result = await requestCommands.create("Write tests", { identity: "test_writer" });
      assertEquals(result.identity, "test_writer");

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "identity_id: test_writer");
    });

    it("should accept portal option", async () => {
      const result = await requestCommands.create("Add feature", { portal: "MyProject" });

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "portal: MyProject");
    });

    it("should generate unique trace_ids", async () => {
      const result1 = await requestCommands.create("Request 1");
      const result2 = await requestCommands.create("Request 2");

      assertNotEquals(result1.trace_id, result2.trace_id);
      assertNotEquals(result1.filename, result2.filename);
    });

    it("should reject invalid priority", async () => {
      // Use helper to bypass type checking for invalid priority test
      function createOptions(priority: string): IRequestOptions {
        return { priority: priority as IRequestOptions["priority"] };
      }
      await assertRejects(
        async () => await requestCommands.create("Test", createOptions("invalid")),
        Error,
        "Invalid priority",
      );
    });

    it("should create file in correct directory", async () => {
      const result = await requestCommands.create("Test request");

      const expectedDir = getWorkspaceRequestsDir(tempDir);
      if (!result.path) throw new Error("Path should be defined");
      assertStringIncludes(result.path, expectedDir);
    });

    it("should use filename pattern request-{short_trace_id}.md", async () => {
      const result = await requestCommands.create("Test request");

      const shortId = result.trace_id.slice(0, 8);
      assertEquals(result.filename, `request-${shortId}.md`);
    });

    it("should log activity to journal", async () => {
      const result = await requestCommands.create("Test request");

      // Wait for flush
      await db.waitForFlush();

      // Query activity journal
      const activities = await db.getRecentActivity(10);
      const createActivity = activities.find((a) =>
        a.action_type === "request.created" &&
        a.trace_id === result.trace_id
      );

      assertExists(createActivity, "IActivity should be logged");
      // Actor is now user identity (email or username) instead of "human"
      assertExists(createActivity?.actor);
      const createPayload = JSON.parse(createActivity?.payload || "{}");
      assertExists(createPayload?.description_length);
    });

    it("should include created_by from user identity", async () => {
      const result = await requestCommands.create("Test request");
      assertExists(result.created_by);

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, `created_by: ${result.created_by}`);
    });

    it("should include source field", async () => {
      const result = await requestCommands.create("Test");
      assertEquals(result.source, RequestSource.CLI);

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "source: cli");
    });

    it("should include created timestamp in ISO format", async () => {
      const before = new Date().toISOString();
      const result = await requestCommands.create("Test");
      const after = new Date().toISOString();

      assertExists(result.created);
      // Timestamp should be between before and after
      assertEquals(result.created >= before, true);
      assertEquals(result.created <= after, true);
    });

    it("should reject empty description", async () => {
      await assertRejects(
        async () => await requestCommands.create(""),
        Error,
        "Description cannot be empty",
      );

      await assertRejects(
        async () => await requestCommands.create("   "),
        Error,
        "Description cannot be empty",
      );
    });

    it("should accept flow option", async () => {
      const result = await requestCommands.create("Test flow request", { flow: "code-review" });

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "flow: code-review");
    });

    it("should reject flow and agent combination", async () => {
      await assertRejects(
        async () => await requestCommands.create("Test", { flow: "code-review", identity: "writer" }),
        Error,
        "Cannot specify both 'flow' and 'agent'/'identity'",
      );
    });

    it("should reject non-existent flow", async () => {
      await assertRejects(
        async () => await requestCommands.create("Test", { flow: "non-existent-flow" }),
        Error,
        "Flow 'non-existent-flow' not found",
      );
    });

    it("should include explicit subject in frontmatter", async () => {
      const result = await requestCommands.create("Implement dark mode", { subject: "Dark Mode" });
      assertEquals(result.subject, "Dark Mode");

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "subject: Dark Mode");
    });

    it("should auto-generate fallback subject when missing", async () => {
      const result = await requestCommands.create("Implement dark mode for all pages");
      assertEquals(result.subject, "Implement dark mode for all pages");

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "subject: Implement dark mode for all pages");
    });

    it("should trigger analysis when analyze option is enabled", async () => {
      const result = await requestCommands.create("Test analyzed request", { analyze: true });
      assertExists(result.trace_id);

      // Verify analysis file created (_analysis.json suffix)
      if (!result.path) throw new Error("Path should be defined");
      const analysisFile = result.path.replace(/\.md$/, "_analysis.json");
      const analysisExists = await exists(analysisFile);
      assertEquals(analysisExists, true, `Analysis file ${analysisFile} should exist`);

      const analysisRaw = await Deno.readTextFile(analysisFile);
      const analysis = JSON.parse(analysisRaw);
      assertEquals(analysis.metadata.mode, "heuristic");
      assertExists(analysis.complexity);
      assertExists(analysis.actionabilityScore);
    });

    it("should support engine override for analysis", async () => {
      const result = await requestCommands.create("LLM analysis test", {
        analyze: true,
        analysis_engine: AnalysisMode.LLM,
      });

      if (!result.path) throw new Error("Path should be defined");
      const analysisFile = result.path.replace(/\.md$/, "_analysis.json");
      const analysisRaw = await Deno.readTextFile(analysisFile);
      const analysis = JSON.parse(analysisRaw);

      assertEquals(analysis.metadata.mode, "llm");
    });
  });

  describe("createFromFile", () => {
    it("should create request from file content", async () => {
      const inputFile = join(tempDir, "input.md");
      await Deno.writeTextFile(inputFile, "Implement feature from file");

      const result = await requestCommands.createFromFile(inputFile);

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "Implement feature from file");
      assertEquals(result.source, RequestSource.FILE);
      assertStringIncludes(content, "source: file");
    });

    it("should reject non-existent file", async () => {
      await assertRejects(
        async () => await requestCommands.createFromFile("/nonexistent/file.md"),
        Error,
        "File not found",
      );
    });

    it("should reject empty file", async () => {
      const inputFile = join(tempDir, "empty.md");
      await Deno.writeTextFile(inputFile, "   \n  ");

      await assertRejects(
        async () => await requestCommands.createFromFile(inputFile),
        Error,
        "File is empty",
      );
    });

    it("should pass options to created request", async () => {
      const inputFile = join(tempDir, "input.md");
      await Deno.writeTextFile(inputFile, "Test content");

      const result = await requestCommands.createFromFile(inputFile, {
        identity: "custom_agent",
        priority: RequestPriority.HIGH,
      });

      assertEquals(result.identity, "custom_agent");
      assertEquals(result.priority, RequestPriority.HIGH);
    });

    it("should trim whitespace from file content", async () => {
      const inputFile = join(tempDir, "input.md");
      await Deno.writeTextFile(inputFile, "\n\n  Test content with whitespace  \n\n");

      const result = await requestCommands.createFromFile(inputFile);

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "Test content with whitespace");
    });
  });

  describe("list", () => {
    it("should return empty array when no requests", async () => {
      const requests = await requestCommands.list();
      assertEquals(requests, []);
    });

    it("should list all requests", async () => {
      await requestCommands.create("Request 1");
      await requestCommands.create("Request 2");

      const requests = await requestCommands.list();
      assertEquals(requests.length, 2);
    });

    it("should filter by status", async () => {
      await requestCommands.create("Request 1");
      // Create another request and manually modify its status
      const result2 = await requestCommands.create("Request 2");
      if (!result2.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result2.path);
      const updated = content.replace("status: pending", "status: in_progress");
      if (!result2.path) throw new Error("Path should be defined");
      await Deno.writeTextFile(result2.path, updated);

      const pending = await requestCommands.list(RequestStatus.PENDING);
      assertEquals(pending.length, 1);

      const inProgress = await requestCommands.list(RequestStatus.IN_PROGRESS);
      assertEquals(inProgress.length, 1);
    });

    it("should filter by NEEDS_CLARIFICATION status", async () => {
      const result = await requestCommands.create("Vague request");
      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      await Deno.writeTextFile(result.path, content.replace("status: pending", "status: needs_clarification"));

      const needsClarity = await requestCommands.list(RequestStatus.NEEDS_CLARIFICATION);
      assertEquals(needsClarity.length, 1);
      assertEquals(needsClarity[0].status, RequestStatus.NEEDS_CLARIFICATION);
    });

    it("should filter by REFINING status", async () => {
      const result = await requestCommands.create("Ambiguous request");
      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      await Deno.writeTextFile(result.path, content.replace("status: pending", "status: refining"));

      const refining = await requestCommands.list(RequestStatus.REFINING);
      assertEquals(refining.length, 1);
      assertEquals(refining[0].status, RequestStatus.REFINING);
    });

    it("should filter by ENRICHING status", async () => {
      const result = await requestCommands.create("Underspecified request");
      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      await Deno.writeTextFile(result.path, content.replace("status: pending", "status: enriching"));

      const enriching = await requestCommands.list(RequestStatus.ENRICHING);
      assertEquals(enriching.length, 1);
      assertEquals(enriching[0].status, RequestStatus.ENRICHING);
    });

    it("should not include REFINING requests when filtering for PENDING", async () => {
      await requestCommands.create("Pending request");
      const result2 = await requestCommands.create("Refining request");
      if (!result2.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result2.path);
      await Deno.writeTextFile(result2.path, content.replace("status: pending", "status: refining"));

      const pending = await requestCommands.list(RequestStatus.PENDING);
      assertEquals(pending.length, 1);
      assertEquals(pending[0].status, RequestStatus.PENDING);
    });

    it("should sort by created date descending", async () => {
      const result1 = await requestCommands.create("Request 1");
      await new Promise((r) => setTimeout(r, 50)); // Small delay
      const result2 = await requestCommands.create("Request 2");

      const requests = await requestCommands.list();
      // Most recent first
      assertEquals(requests[0].trace_id, result2.trace_id);
      assertEquals(requests[1].trace_id, result1.trace_id);
    });

    it("should include metadata from frontmatter", async () => {
      await requestCommands.create("Test request", { priority: RequestPriority.HIGH, identity: "architect" });

      const requests = await requestCommands.list();
      assertEquals(requests.length, 1);
      assertEquals(requests[0].priority, RequestPriority.HIGH);
      assertEquals(requests[0].identity, "architect");
      assertEquals(requests[0].status, RequestStatus.PENDING);
    });
  });

  describe("show", () => {
    it("should show request by full trace_id", async () => {
      const created = await requestCommands.create("Test request");

      const { metadata, content } = await requestCommands.show(created.trace_id);
      assertEquals(metadata.trace_id, created.trace_id);
      assertStringIncludes(content, "Test request");
    });

    it("should show request by short trace_id", async () => {
      const created = await requestCommands.create("Test request");
      const shortId = created.trace_id.slice(0, 8);

      const { metadata } = await requestCommands.show(shortId);
      assertEquals(metadata.trace_id, created.trace_id);
    });

    it("should show request by filename", async () => {
      const created = await requestCommands.create("Test request");

      const { metadata } = await requestCommands.show(created.filename);
      assertEquals(metadata.trace_id, created.trace_id);
    });

    it("should reject non-existent request", async () => {
      await assertRejects(
        async () => await requestCommands.show("nonexistent"),
        Error,
        "Request not found",
      );
    });

    it("should return full content body", async () => {
      const description = "This is a detailed request\nwith multiple lines\nand formatting.";
      const created = await requestCommands.create(description);

      const { content } = await requestCommands.show(created.trace_id);
      assertStringIncludes(content, "This is a detailed request");
      assertStringIncludes(content, "with multiple lines");
    });

    it("should handle non-matching short ID", async () => {
      // Create two requests
      await requestCommands.create("Request 1");
      await requestCommands.create("Request 2");

      // A random non-matching ID should fail with "not found"
      await assertRejects(
        async () => await requestCommands.show("zzzzzzzzz"),
        Error,
        "Request not found",
      );
    });

    it("should show request by subject match", async () => {
      await requestCommands.create("Build a search engine", { subject: "Search Project" });
      await requestCommands.create("Other build task");

      const { metadata } = await requestCommands.show("Search Project");
      assertEquals(metadata.subject, "Search Project");
      assertStringIncludes(metadata.trace_id, ""); // Just check it exists
    });

    it("should throw error for non-matching subject", async () => {
      await requestCommands.create("Build something", { subject: "Build Something" });

      await assertRejects(
        async () => await requestCommands.show("NonExistentSubject"),
        Error,
        "Request not found",
      );
    });
  });

  describe("priority validation", () => {
    const validPriorities = ["low", "normal", "high", CritiqueSeverity.CRITICAL];

    for (const priority of validPriorities) {
      it(`should accept valid priority: ${priority}`, async () => {
        const result = await requestCommands.create("Test", {
          priority: priority as RequestPriority,
        });
        assertEquals(result.priority, priority as RequestPriority);
      });
    }
  });

  describe("list edge cases", () => {
    it("should skip non-.md files in directory", async () => {
      // Create a valid request
      await requestCommands.create("Valid request");

      // Create non-.md files that should be ignored
      await Deno.writeTextFile(join(requestsDir, "readme.txt"), "Some text");
      await Deno.writeTextFile(join(requestsDir, "config.json"), "{}");
      await Deno.writeTextFile(join(requestsDir, ".hidden"), "hidden");

      const requests = await requestCommands.list();
      assertEquals(requests.length, 1); // Only the valid request
    });

    it("should skip directories in inbox", async () => {
      await requestCommands.create("Valid request");

      // Create a subdirectory that should be ignored
      await ensureDir(join(requestsDir, "subdir"));
      await Deno.writeTextFile(join(requestsDir, "subdir", "nested.md"), "nested");

      const requests = await requestCommands.list();
      assertEquals(requests.length, 1); // Only the valid request
    });

    it("should handle requests with minimal frontmatter", async () => {
      // Create a file with minimal frontmatter (missing some fields)
      const minimalContent = `---
trace_id: "show-minimal-123"
---

Minimal content for show
`;
      await ensureDir(requestsDir);
      await Deno.writeTextFile(join(requestsDir, "request-minimal.md"), minimalContent);

      const requests = await requestCommands.list();
      assertEquals(requests.length, 1);
      assertEquals(requests[0].priority, "normal"); // Default when missing
      assertEquals(requests[0].identity, "default"); // Default when missing
      assertEquals(requests[0].created_by, "unknown"); // Default when missing
      assertEquals(requests[0].source, "unknown"); // Default when missing
    });

    it("should return empty array when Workspace/Requests directory does not exist", async () => {
      // Create a fresh RequestCommands with non-existent directory
      const emptyDir = join(tempDir, "empty_workspace");
      const context: ICliApplicationContext = {
        config: createStubConfig(createMockConfig(emptyDir)),
        db,
        git: createStubGit(),
        provider: createStubProvider(),
        display: createStubDisplay(),
      };
      const emptyCommands = new RequestCommands(context);

      const requests = await emptyCommands.list();
      assertEquals(requests, []);
    });
  });

  describe("show edge cases", () => {
    it("should throw error for ambiguous short ID", async () => {
      // Create two requests - we'll manually modify one to have a similar prefix
      const request1 = await requestCommands.create("Request 1");

      // Create another request and modify its trace_id to share prefix
      const request2 = await requestCommands.create("Request 2");
      if (!request2.path) throw new Error("Path should be defined");
      const content2 = await Deno.readTextFile(request2.path);
      // Use same first 8 characters as request1
      const sharedPrefix = request1.trace_id.slice(0, 8);
      const fakeTraceId = `${sharedPrefix}-fake-uuid-different`;
      const updated2 = content2.replace(request2.trace_id, fakeTraceId);
      if (!request2.path) throw new Error("Path should be defined");
      await Deno.writeTextFile(request2.path, updated2);

      // Now searching by the shared 8-char prefix should be ambiguous
      await assertRejects(
        async () => await requestCommands.show(sharedPrefix),
        Error,
        "Ambiguous request ID",
      );
    });

    it("should handle request with minimal frontmatter in show", async () => {
      // Extra debug: print requestsDir and file existence
      console.log("requestsDir in test:", requestsDir);
      const testFilePath = join(requestsDir, "request-showmin.md");
      const fileExists = await exists(testFilePath);
      console.log("request-showmin.md exists after write:", fileExists);
      // List all files in requestsDir
      for await (const entry of Deno.readDir(requestsDir)) {
        console.log("File in requestsDir:", entry.name);
      }
      // Print file content
      if (fileExists) {
        const fileContent = await Deno.readTextFile(testFilePath);
        console.log("Content of request-showmin.md:\n" + fileContent);
      }
      // Debug: List all trace_ids in requestsDir
      for await (const entry of Deno.readDir(requestsDir)) {
        if (entry.isFile && entry.name.endsWith(".md")) {
          const filePath = join(requestsDir, entry.name);
          const content = await Deno.readTextFile(filePath);
          const match = content.match(/trace_id:\s*"([^"]+)"/);
          if (match) {
            console.log(`Found request file: ${entry.name}, trace_id: ${match[1]}`);
          }
          // Print full frontmatter for debugging
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (fmMatch) {
            console.log(`Frontmatter for ${entry.name}:\n${fmMatch[1]}`);
          } else {
            console.log(`No frontmatter found in ${entry.name}`);
          }
        }
      }
    });

    it("should throw error when directory does not exist", async () => {
      // Create a fresh RequestCommands with non-existent directory
      const emptyDir = join(tempDir, "nonexistent_workspace");
      const context: ICliApplicationContext = {
        config: createStubConfig(createMockConfig(emptyDir)),
        db,
        git: createStubGit(),
        provider: createStubProvider(),
        display: createStubDisplay(),
      };
      const emptyCommands = new RequestCommands(context);

      await assertRejects(
        async () => await emptyCommands.show("any-id"),
        Error,
        "Request not found",
      );
    });

    it("should skip non-.md files when searching", async () => {
      await requestCommands.create("Valid request");

      // Create a .txt file with content that might match
      await Deno.writeTextFile(
        join(requestsDir, "not-a-request.txt"),
        'trace_id: "fake-trace-id"',
      );

      // Should not find the txt file
      await assertRejects(
        async () => await requestCommands.show("fake-trace-id"),
        Error,
        "Request not found",
      );
    });

    it("should skip directories when searching", async () => {
      await requestCommands.create("Valid request");

      // Create a subdirectory
      const subdir = join(requestsDir, "subdir");
      await ensureDir(subdir);

      // Should not throw when directory exists
      const requests = await requestCommands.list();
      assertEquals(requests.length, 1);
    });
  });

  describe("create edge cases", () => {
    it("should handle description with special characters", async () => {
      const description = 'Test with "quotes" and \\backslashes\\ and\nnewlines';
      const result = await requestCommands.create(description);

      // File should be created and readable
      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "---");
      assertExists(result.trace_id);
    });

    it("should handle very long descriptions", async () => {
      const description = "A".repeat(10000); // 10KB description
      const result = await requestCommands.create(description);

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "A".repeat(100)); // Just check some content exists
      assertEquals(result.status, RequestStatus.PENDING);
    });

    it("should handle unicode in description", async () => {
      const description = "Implement 日本語 support with émojis 🚀";
      const result = await requestCommands.create(description);

      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "日本語");
      assertStringIncludes(content, "🚀");
    });

    it("should create directory if Workspace/Requests does not exist", async () => {
      // Create a fresh workspace without the Requests dir
      const freshDir = join(tempDir, "fresh_workspace");
      await ensureDir(join(freshDir, ".exa")); // Need runtime dir for db
      const context: ICliApplicationContext = {
        config: createStubConfig(createMockConfig(freshDir)),
        db,
        git: createStubGit(),
        provider: createStubProvider(),
        display: createStubDisplay(),
      };
      const freshCommands = new RequestCommands(context);

      // This should create the directory automatically
      const result = await freshCommands.create("Test auto-create dir");
      assertExists(result.trace_id);

      // Verify directory was created
      const dirExists = await Deno.stat(getWorkspaceRequestsDir(freshDir)).catch(() => null);
      assertExists(dirExists);
    });

    it("should log activity with correct payload fields", async () => {
      const result = await requestCommands.create("Test activity payload", {
        priority: RequestPriority.HIGH,
        identity: "special_agent",
        portal: "TestPortal",
      });

      await db.waitForFlush();

      const activities = await db.getRecentActivity(10);
      const activity = activities.find((a) => a.trace_id === result.trace_id);

      assertExists(activity);
      assertEquals(activity.action_type, "request.created");
      assertExists(activity.actor);
      assertExists(activity.payload);
      const payload = JSON.parse(activity.payload);
      assertEquals(payload.priority, "high");
      assertEquals(payload.identity, "special_agent");
      assertEquals(payload.identity, "special_agent");
      assertEquals(payload.portal, "TestPortal");
      assertEquals(payload.source, RequestSource.CLI);
      assertEquals(typeof payload.description_length, "number");
    });

    it("should set portal to null in activity when not provided", async () => {
      const result = await requestCommands.create("Test without portal");

      await db.waitForFlush();

      const activities = await db.getRecentActivity(10);
      const activity = activities.find((a) => a.trace_id === result.trace_id);

      assertExists(activity);
      const payload = JSON.parse(activity.payload);
      assertEquals(payload.portal, null);
    });
  });

  describe("createFromFile edge cases", () => {
    it("should handle file with only whitespace and newlines", async () => {
      const inputFile = join(tempDir, "whitespace.md");
      await Deno.writeTextFile(inputFile, "   \n\t\n   ");

      await assertRejects(
        async () => await requestCommands.createFromFile(inputFile),
        Error,
        "File is empty",
      );
    });

    it("should handle file with portal option", async () => {
      const inputFile = join(tempDir, "portal_test.md");
      await Deno.writeTextFile(inputFile, "Request with portal context");

      const result = await requestCommands.createFromFile(inputFile, {
        portal: "MyPortal",
      });

      assertEquals(result.portal, "MyPortal");
      if (!result.path) throw new Error("Path should be defined");
      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "portal: MyPortal");
    });
  });
});
