/**
 * @module MemoryCommandsTest
 * @path apps/exactl/tests/memory_commands_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Tests for CLI memory introspection, validating project/global memory listing,
 * JSON format exports, and pattern/decision retrieval across different memory scopes.
 */

import { assertEquals, assertInstanceOf, assertRejects, assertStringIncludes } from "@std/assert";
import { ExecutionStatus } from "@exaix/core";
import { MemoryFormatter } from "@exaix/cli/formatters/memory_formatter.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { TestEnvironmentFactory } from "../../../tests/fixtures/test_environment_factory.ts";
import { createTestExecution, createTestProject } from "@exaix/testing";

// Memory List Tests

Deno.test("MemoryCommands: getSummary returns an empty summary with no data", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const summary = await commands.getSummary();

    assertEquals(summary.projects, []);
    assertEquals(summary.executions, 0);
    assertEquals(summary.lastActivity, null);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: getSummary lists the projects", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "TestProject");

    const summary = await commands.getSummary();

    assertEquals(summary.projects, ["TestProject"]);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryFormatter: the summary renders as a table and as markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "MdProject");
    const summary = await commands.getSummary();
    const formatter = new MemoryFormatter();

    const table = formatter.formatListTable(summary);
    assertStringIncludes(table, "Memory Banks Summary");
    assertStringIncludes(table, "Projects:    1");
    const markdown = formatter.formatListMarkdown(summary);
    assertStringIncludes(markdown, "# Memory Banks Summary");
    assertStringIncludes(markdown, "| Metric | Value |");
    assertStringIncludes(markdown, "- MdProject");
  } finally {
    await cleanup();
  }
});

// Memory Search Tests

Deno.test("MemoryCommands: search finds patterns by name", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "SearchProject");

    const results = await commands.search("Test IPattern");

    assertEquals(results.some((result) => result.title.includes("Test IPattern")), true);
    assertEquals(results.some((result) => result.portal === "SearchProject"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: search returns no results for an unknown query", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    assertEquals(await commands.search("nonexistent query 12345"), []);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: search --portal filters correctly", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "ProjectA");
    await createTestProject(memoryBank, "ProjectB");

    const results = await commands.search("IPattern", { portal: "ProjectA" });

    assertEquals(results.length > 0, true);
    assertEquals(results.every((result) => result.portal === "ProjectA"), true);
  } finally {
    await cleanup();
  }
});

// Project Commands Tests

Deno.test("MemoryCommands: project list shows all projects with their counts", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "Alpha");
    await createTestProject(memoryBank, "Beta");

    const projects = await commands.projectList();

    assertEquals(projects.map((project) => project.name), ["Alpha", "Beta"]);
    assertEquals(typeof projects[0].patterns, "number");
    assertEquals(typeof projects[0].decisions, "number");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: project list is empty with no projects", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    assertEquals(await commands.projectList(), []);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: project show returns the project memory", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "DetailProject");

    const project = await commands.projectShow("DetailProject");

    assertEquals(project.portal, "DetailProject");
    assertEquals(project.patterns.some((pattern) => pattern.name.startsWith("Test IPattern")), true);
    assertStringIncludes(new MemoryFormatter().formatProjectShowTable(project), "Overview");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: project show of an unknown portal fails with the not-found code", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const error = await assertRejects(() => commands.projectShow("NonExistent"), ExaCtlError);
    assertInstanceOf(error, ExaCtlError);
    assertEquals(error.code, ExaCtlExitCode.NOT_FOUND);
    assertStringIncludes(error.message, "not found");
  } finally {
    await cleanup();
  }
});

// Execution Commands Tests

Deno.test("MemoryCommands: execution list returns the history", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestExecution(memoryBank, "11111111-1111-4111-8111-111111111111", "ExecProject");

    const executions = await commands.executionList();

    assertEquals(executions.map((execution) => execution.trace_id), ["11111111-1111-4111-8111-111111111111"]);
    assertEquals(executions[0].status, ExecutionStatus.COMPLETED);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution list is empty with no history", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    assertEquals(await commands.executionList(), []);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution list --portal filters correctly", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestExecution(memoryBank, "22222222-2222-4222-8222-222222222222", "FilterProjectA");
    await createTestExecution(memoryBank, "33333333-3333-4333-8333-333333333333", "FilterProjectB");

    const executions = await commands.executionList({ portal: "FilterProjectA" });

    assertEquals(executions.map((execution) => execution.trace_id), ["22222222-2222-4222-8222-222222222222"]);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution list --limit works", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestExecution(memoryBank, "44444444-4444-4444-8444-444444444444", "LimitProject");
    await createTestExecution(memoryBank, "55555555-5555-4555-8555-555555555555", "LimitProject");
    await createTestExecution(memoryBank, "66666666-6666-4666-8666-666666666666", "LimitProject");

    assertEquals((await commands.executionList({ limit: 2 })).length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution show returns the details", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const traceId = "77777777-7777-4777-8777-777777777777";
    await createTestExecution(memoryBank, traceId, "ShowExecProject");

    const execution = await commands.executionShow(traceId);

    assertEquals(execution.trace_id, traceId);
    assertEquals(execution.portal, "ShowExecProject");
    assertEquals(execution.status, ExecutionStatus.COMPLETED);
    assertEquals(execution.agent_role, "test-agent");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution show of an unknown trace fails with the not-found code", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const error = await assertRejects(() => commands.executionShow("nonexistent-trace-id"), ExaCtlError);
    assertEquals(error.code, ExaCtlExitCode.NOT_FOUND);
    assertStringIncludes(error.message, "not found");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryFormatter: an execution renders as markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const traceId = "99999999-9999-4999-8999-999999999999";
    await createTestExecution(memoryBank, traceId, "MdExecProject");

    const markdown = new MemoryFormatter().formatExecutionShowMarkdown(await commands.executionShow(traceId));

    assertStringIncludes(markdown, "# Execution:");
    assertStringIncludes(markdown, "## Details");
    assertStringIncludes(markdown, "| Field | Value |");
  } finally {
    await cleanup();
  }
});

// Rebuild Index Test

Deno.test("MemoryCommands: rebuild-index completes successfully", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "IndexProject");
    await createTestExecution(memoryBank, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "IndexProject");

    assertEquals((await commands.rebuildIndex()).embeddings, null);
  } finally {
    await cleanup();
  }
});
