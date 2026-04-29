/**
 * @module MemoryCommandsTest
 * @path tests/cli/memory_commands_test.ts
 * @description Tests for CLI memory introspection, validating project/global memory listing,
 * JSON format exports, and pattern/decision retrieval across different memory scopes.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { ExecutionStatus } from "@exaix/core";
import { UIOutputFormat } from "@exaix/tui";
import { TestEnvironmentFactory } from "../fixtures/test_environment_factory.ts";
import { createTestExecution, createTestProject } from "../helpers/memory_test_helper.ts";

// ===== Memory List Tests =====

Deno.test("MemoryCommands: list returns summary with no data", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.list(UIOutputFormat.TABLE);

    assertStringIncludes(result, "Memory Banks Summary");
    assertStringIncludes(result, "Projects:");
    assertStringIncludes(result, "Executions:");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: list returns summary with projects", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "TestProject");

    const result = await commands.list(UIOutputFormat.TABLE);

    assertStringIncludes(result, "Projects:    1");
    assertStringIncludes(result, "TestProject");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: list --format json outputs valid JSON", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "JsonProject");

    const result = await commands.list(UIOutputFormat.JSON);
    const parsed = JSON.parse(result);

    assertEquals(Array.isArray(parsed.projects), true);
    assertStringIncludes(parsed.projects.join(","), "JsonProject");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: list --format md outputs markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "MdProject");

    const result = await commands.list(UIOutputFormat.MARKDOWN);

    assertStringIncludes(result, "# Memory Banks Summary");
    assertStringIncludes(result, "| Metric | Value |");
    assertStringIncludes(result, "- MdProject");
  } finally {
    await cleanup();
  }
});

// ===== Memory Search Tests =====

Deno.test("MemoryCommands: search finds patterns by name", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "SearchProject");

    const result = await commands.search("Test IPattern");

    assertStringIncludes(result, "Test IPattern");
    assertStringIncludes(result, "SearchProject");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: search returns no results message", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.search("nonexistent query 12345");

    assertStringIncludes(result, "No results found");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: search --portal filters correctly", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "ProjectA");
    await createTestProject(memoryBank, "ProjectB");

    // Search with portal filter
    const result = await commands.search("IPattern", { portal: "ProjectA" });

    assertStringIncludes(result, "ProjectA");
    // Should not contain ProjectB since we filtered by ProjectA
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: search --format json outputs valid JSON", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "JsonSearchProject");

    const result = await commands.search("IPattern", { format: UIOutputFormat.JSON });
    const parsed = JSON.parse(result);

    assertEquals(Array.isArray(parsed), true);
  } finally {
    await cleanup();
  }
});

// ===== Project Commands Tests =====

Deno.test("MemoryCommands: project list shows all projects", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "Alpha");
    await createTestProject(memoryBank, "Beta");

    const result = await commands.projectList(UIOutputFormat.TABLE);

    assertStringIncludes(result, "Alpha");
    assertStringIncludes(result, "Beta");
    assertStringIncludes(result, "Patterns");
    assertStringIncludes(result, "Decisions");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: project list empty returns message", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.projectList(UIOutputFormat.TABLE);

    assertStringIncludes(result, "No project memories found");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: project show displays details", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "DetailProject");

    const result = await commands.projectShow("DetailProject", UIOutputFormat.TABLE);

    assertStringIncludes(result, "DetailProject");
    assertStringIncludes(result, "Overview");
    assertStringIncludes(result, "Test IPattern");
    assertStringIncludes(result, "Use TypeScript");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: project show non-existent returns error", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.projectShow("NonExistent", UIOutputFormat.TABLE);

    assertStringIncludes(result, "Error");
    assertStringIncludes(result, "not found");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: project show --format json outputs valid JSON", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "JsonShowProject");

    const result = await commands.projectShow("JsonShowProject", UIOutputFormat.JSON);
    const parsed = JSON.parse(result);

    assertEquals(parsed.portal, "JsonShowProject");
    assertEquals(Array.isArray(parsed.patterns), true);
  } finally {
    await cleanup();
  }
});

// ===== Execution Commands Tests =====

Deno.test("MemoryCommands: execution list returns history", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestExecution(memoryBank, "11111111-1111-1111-1111-111111111111", "ExecProject");

    const result = await commands.executionList({ format: UIOutputFormat.TABLE });

    assertStringIncludes(result, "Execution History");
    assertStringIncludes(result, "11111111");
    assertStringIncludes(result, ExecutionStatus.COMPLETED);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution list empty returns message", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.executionList({ format: UIOutputFormat.TABLE });

    assertStringIncludes(result, "No execution history found");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution list --portal filters correctly", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestExecution(memoryBank, "22222222-2222-2222-2222-222222222222", "FilterProjectA");
    await createTestExecution(memoryBank, "33333333-3333-3333-3333-333333333333", "FilterProjectB");

    const result = await commands.executionList({ portal: "FilterProjectA", format: UIOutputFormat.TABLE });

    assertStringIncludes(result, "22222222");
    // Execution for FilterProjectB should be filtered out
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution list --limit works", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestExecution(memoryBank, "44444444-4444-4444-4444-444444444444", "LimitProject");
    await createTestExecution(memoryBank, "55555555-5555-5555-5555-555555555555", "LimitProject");
    await createTestExecution(memoryBank, "66666666-6666-6666-6666-666666666666", "LimitProject");

    const result = await commands.executionList({ limit: 2, format: UIOutputFormat.TABLE });

    assertStringIncludes(result, "Showing 2 execution(s)");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution show displays details", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const traceId = "77777777-7777-7777-7777-777777777777";
    await createTestExecution(memoryBank, traceId, "ShowExecProject");

    const result = await commands.executionShow(traceId, UIOutputFormat.TABLE);

    assertStringIncludes(result, traceId);
    assertStringIncludes(result, "ShowExecProject");
    assertStringIncludes(result, ExecutionStatus.COMPLETED);
    assertStringIncludes(result, "test-agent");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution show non-existent returns error", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.executionShow("nonexistent-trace-id", UIOutputFormat.TABLE);

    assertStringIncludes(result, "Error");
    assertStringIncludes(result, "not found");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution show --format json outputs valid JSON", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const traceId = "88888888-8888-8888-8888-888888888888";
    await createTestExecution(memoryBank, traceId, "JsonExecProject");

    const result = await commands.executionShow(traceId, UIOutputFormat.JSON);
    const parsed = JSON.parse(result);

    assertEquals(parsed.trace_id, traceId);
    assertEquals(parsed.status, ExecutionStatus.COMPLETED);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution show --format md outputs markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const traceId = "99999999-9999-9999-9999-999999999999";
    await createTestExecution(memoryBank, traceId, "MdExecProject");

    const result = await commands.executionShow(traceId, UIOutputFormat.MARKDOWN);

    assertStringIncludes(result, "# Execution:");
    assertStringIncludes(result, "## Details");
    assertStringIncludes(result, "| Field | Value |");
  } finally {
    await cleanup();
  }
});

// ===== Rebuild Index Test =====

Deno.test("MemoryCommands: rebuild-index completes successfully", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "IndexProject");
    await createTestExecution(memoryBank, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "IndexProject");

    const result = await commands.rebuildIndex();

    assertStringIncludes(result, "rebuilt successfully");
  } finally {
    await cleanup();
  }
});
