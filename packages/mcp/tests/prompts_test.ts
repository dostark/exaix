/**
 * @module MCPPromptsTest
 * @path packages/mcp/tests/prompts_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Verifies the MCP prompt registry, ensuring server-side prompts are correctly listed
 * with their arguments and successfully retrieved by clients with argument interpolation.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { McpToolName } from "@exaix/mcp";
import { MessageRole } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { createMockConfig } from "@exaix/testing";
import { initTestDbService } from "@exaix/testing";
import {
  generateCreateReviewPrompt,
  generateExecutePlanPrompt,
  generatePrompt,
  getPrompt,
  getPrompts,
} from "@exaix/mcp/server";

// ============================================================================
// Prompt List Tests
// ============================================================================

Deno.test("getPrompts: returns all available prompts", () => {
  const prompts = getPrompts();

  assertEquals(prompts.length, 3);
  assertEquals(prompts[0].name, "execute_plan");
  assertEquals(prompts[1].name, "create_review");
  assertEquals(prompts[2].name, "commit_message");
});

Deno.test("getPrompt: returns specific prompt by name", () => {
  const prompt = getPrompt("execute_plan");

  assertExists(prompt);
  assertEquals(prompt.name, "execute_plan");
  assertStringIncludes(prompt.description, "Execute");
  assertEquals(prompt.arguments?.length, 2);
});

Deno.test("getPrompt: returns null for unknown prompt", () => {
  const prompt = getPrompt("unknown_prompt");

  assertEquals(prompt, null);
});

// ============================================================================
// Execute Plan Prompt Tests
// ============================================================================

Deno.test("generateExecutePlanPrompt: generates prompt with plan details", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = new EventLogger({ db });
  try {
    const result = generateExecutePlanPrompt({ plan_id: "test-plan-123", portal: "MyApp" }, logger);

    assertExists(result);
    assertExists(result.description);
    assertStringIncludes(result.description, "test-plan-123");
    assertStringIncludes(result.description, "MyApp");
    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0].role, MessageRole.USER);

    const text = result.messages[0].content.text;
    assertStringIncludes(text, "test-plan-123");
    assertStringIncludes(text, "MyApp");
    assertStringIncludes(text, McpToolName.READ_FILE);
    assertStringIncludes(text, McpToolName.WRITE_FILE);
  } finally {
    await cleanup();
  }
});

Deno.test("generateExecutePlanPrompt: includes tool usage guidance", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = new EventLogger({ db });
  try {
    const result = generateExecutePlanPrompt({ plan_id: "plan-456", portal: "TestPortal" }, logger);
    const text = result.messages[0].content.text;

    assertStringIncludes(text, McpToolName.READ_FILE);
    assertStringIncludes(text, McpToolName.WRITE_FILE);
    assertStringIncludes(text, McpToolName.LIST_DIRECTORY);
    assertStringIncludes(text, "git_status");
    assertStringIncludes(text, "git_create_branch");
    assertStringIncludes(text, "git_commit");
  } finally {
    await cleanup();
  }
});

Deno.test("generateExecutePlanPrompt: logs to IActivity Journal", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = new EventLogger({ db });
  try {
    generateExecutePlanPrompt({ plan_id: "log-test-plan", portal: "TestPortal" }, logger);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const logs = db.instance.prepare("SELECT * FROM activity WHERE action_type = ?")
      .all("mcp.prompts.execute_plan");
    assertEquals(logs.length, 1);

    const log = logs[0] as { target: string; payload: string };
    assertEquals(log.target, "log-test-plan");
    assertEquals(JSON.parse(log.payload).portal, "TestPortal");
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Create Review Prompt Tests
// ============================================================================

Deno.test("generateCreateReviewPrompt: generates prompt with review details", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = new EventLogger({ db });
  try {
    const result = generateCreateReviewPrompt({
      portal: "MyApp",
      description: "Add user authentication",
      trace_id: "trace-789",
    }, logger);

    assertExists(result);
    assertExists(result.description);
    assertStringIncludes(result.description, "Add user authentication");
    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0].role, MessageRole.USER);

    const text = result.messages[0].content.text;
    assertStringIncludes(text, "MyApp");
    assertStringIncludes(text, "Add user authentication");
    assertStringIncludes(text, "trace-789");
  } finally {
    await cleanup();
  }
});

Deno.test("generateCreateReviewPrompt: includes git workflow guidance", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = new EventLogger({ db });
  try {
    const result = generateCreateReviewPrompt({
      portal: "TestPortal",
      description: "Fix bug",
      trace_id: "trace-123",
    }, logger);
    const text = result.messages[0].content.text;

    assertStringIncludes(text, "feature branch");
    assertStringIncludes(text, "git_create_branch");
    assertStringIncludes(text, "git_status");
    assertStringIncludes(text, "git_commit");
    assertStringIncludes(text, "trace_id");
  } finally {
    await cleanup();
  }
});

Deno.test("generateCreateReviewPrompt: logs to IActivity Journal", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = new EventLogger({ db });
  try {
    generateCreateReviewPrompt({
      portal: "TestPortal",
      description: "Test review",
      trace_id: "log-trace-456",
    }, logger);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const logs = db.instance.prepare("SELECT * FROM activity WHERE action_type = ?")
      .all("mcp.prompts.create_review");
    assertEquals(logs.length, 1);

    const log = logs[0] as { target: string; payload: string };
    assertEquals(log.target, "log-trace-456");

    const payload = JSON.parse(log.payload);
    assertEquals(payload.portal, "TestPortal");
    assertEquals(payload.description, "Test review");
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Commit Message Prompt Tests
// ============================================================================

Deno.test("generateCommitMessagePrompt: generates prompt with commit task details", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = new EventLogger({ db });
  try {
    const result = generatePrompt("commit_message", { portal: "MyApp" }, createMockConfig("/tmp/test"), logger);

    assertExists(result);
    assertExists(result!.description);
    assertEquals(result!.messages.length, 1);
    assertEquals(result!.messages[0].role, MessageRole.USER);

    const text = result!.messages[0].content.text;
    assertStringIncludes(text, "MyApp");
    assertStringIncludes(text, "git_status");
    assertStringIncludes(text, "read_file");
    assertStringIncludes(text, "what:");
    assertStringIncludes(text, "rationale:");
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Generic Prompt Generation Tests
// ============================================================================

Deno.test("generatePrompt: routes to execute_plan generator", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = new EventLogger({ db });
  try {
    const config = createMockConfig("/tmp/test");
    const result = generatePrompt("execute_plan", { plan_id: "plan-999", portal: "TestPortal" }, config, logger);

    assertExists(result);
    assertStringIncludes(result!.messages[0].content.text, "plan-999");
  } finally {
    await cleanup();
  }
});

Deno.test("generatePrompt: routes to create_review generator", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = new EventLogger({ db });
  try {
    const config = createMockConfig("/tmp/test");
    const result = generatePrompt(
      "create_review",
      {
        portal: "TestPortal",
        description: "Test change",
        trace_id: "trace-888",
      },
      config,
      logger,
    );

    assertExists(result);
    assertStringIncludes(result!.messages[0].content.text, "Test change");
  } finally {
    await cleanup();
  }
});

Deno.test("generatePrompt: returns null for unknown prompt", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = new EventLogger({ db });
  try {
    const config = createMockConfig("/tmp/test");
    const result = generatePrompt("unknown_prompt", {}, config, logger);

    assertEquals(result, null);
  } finally {
    await cleanup();
  }
});
