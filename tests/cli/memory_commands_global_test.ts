/**
 * @module MemoryCommandsGlobalTest
 * @path tests/cli/memory_commands_global_test.ts
 * @description Verifies CLI operations for global (context-free) memory banks, ensuring correct
 * initialization, listing, and cross-project pattern retrieval.
 */

import { ConfidenceAssessmentLevel, LearningCategory, MemoryScope, MemoryType, UIOutputFormat } from "@exaix/core";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { TestEnvironmentFactory } from "../fixtures/test_environment_factory.ts";
import { LearningBuilder } from "../fixtures/memory_builder.ts";
import { createTestProject } from "../helpers/memory_test_helper.ts";

// ===== Global Show Tests =====

Deno.test("MemoryCommands: globalShow returns empty for uninitialized", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.globalShow(UIOutputFormat.TABLE);

    assertStringIncludes(result, "not initialized");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: globalShow displays initialized memory", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const result = await commands.globalShow(UIOutputFormat.TABLE);

    assertStringIncludes(result, "Global Memory");
    assertStringIncludes(result, "Version:");
    assertStringIncludes(result, "Learnings:");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: globalShow --format json outputs valid JSON", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const result = await commands.globalShow(UIOutputFormat.JSON);
    const parsed = JSON.parse(result);

    assertEquals(parsed.version, "1.0.0");
    assertEquals(Array.isArray(parsed.learnings), true);
    assertEquals(typeof parsed.statistics, "object");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: globalShow --format md outputs markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const result = await commands.globalShow(UIOutputFormat.MARKDOWN);

    assertStringIncludes(result, "# Global Memory");
    assertStringIncludes(result, "## Statistics");
  } finally {
    await cleanup();
  }
});

// ===== Global List Learnings Tests =====

Deno.test("MemoryCommands: globalListLearnings returns empty message", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const result = await commands.globalListLearnings(UIOutputFormat.TABLE);

    assertStringIncludes(result, "No learnings");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: globalListLearnings displays learnings", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const learning = new LearningBuilder()
      .withTitle("Test Learning Title")
      .withDescription("Test learning description")
      .withCategory(LearningCategory.PATTERN)
      .withTags(["test-tag"])
      .build();

    await memoryBank.addGlobalLearning(learning);

    const result = await commands.globalListLearnings(UIOutputFormat.TABLE);

    assertStringIncludes(result, "Test Learning Title");
    assertStringIncludes(result, LearningCategory.PATTERN);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: globalListLearnings --format json outputs valid JSON", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const learning = new LearningBuilder()
      .withTitle("JSON Test ILearning")
      .withDescription("Test for JSON output")
      .withCategory(LearningCategory.INSIGHT)
      .build();

    await memoryBank.addGlobalLearning(learning);

    const result = await commands.globalListLearnings(UIOutputFormat.JSON);
    const parsed = JSON.parse(result);

    assertEquals(Array.isArray(parsed), true);
    assertEquals(parsed.length, 1);
    assertEquals(parsed[0].title, "JSON Test ILearning");
  } finally {
    await cleanup();
  }
});

// ===== Global Stats Tests =====

Deno.test("MemoryCommands: globalStats displays statistics", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    // Add some learnings
    await memoryBank.addGlobalLearning(
      new LearningBuilder()
        .withScope(MemoryScope.GLOBAL, "app-a")
        .withTitle("ILearning 1")
        .withDescription("First")
        .withCategory(LearningCategory.PATTERN)
        .build(),
    );

    await memoryBank.addGlobalLearning(
      new LearningBuilder()
        .withScope(MemoryScope.GLOBAL, "app-b")
        .withTitle("ILearning 2")
        .withDescription("Second")
        .withCategory(LearningCategory.INSIGHT)
        .build(),
    );

    const result = await commands.globalStats(UIOutputFormat.TABLE);

    assertStringIncludes(result, "Global Memory Statistics");
    assertStringIncludes(result, "Total Learnings:");
    assertStringIncludes(result, "2");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: globalStats --format json outputs valid JSON", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const result = await commands.globalStats(UIOutputFormat.JSON);
    const parsed = JSON.parse(result);

    assertEquals(typeof parsed.total_learnings, "number");
    assertEquals(typeof parsed.by_category, "object");
    assertEquals(typeof parsed.by_project, "object");
  } finally {
    await cleanup();
  }
});

// ===== Promote Command Tests =====

Deno.test("MemoryCommands: promote moves learning to global", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    // Create project with pattern using helper
    await createTestProject(memoryBank, "source-app", {
      overview: "Source project",
      patternName: "Repository IPattern",
    });
    // The helper adds "Repository IPattern" by default if patternName is passed? No, look at implementation.
    // implementation: patterns: [{ name: opts.patternName || "Test IPattern", ... }]
    // So "Repository IPattern" will be created.

    await memoryBank.initGlobalMemory();

    // Promote the pattern
    const result = await commands.promote("source-app", {
      type: MemoryType.PATTERN,
      name: "Repository IPattern",
      title: "Repository IPattern (Global)",
      description: "Use repositories for all database access",
      category: LearningCategory.PATTERN,
      tags: ["architecture"],
      confidence: ConfidenceAssessmentLevel.HIGH,
    });

    assertStringIncludes(result, "promoted");

    // Verify in global memory
    const globalMem = await memoryBank.getGlobalMemory();
    assertEquals(globalMem?.learnings.length, 1);
    assertEquals(globalMem?.learnings[0].title, "Repository IPattern (Global)");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: promote non-existent project returns error", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const result = await commands.promote("non-existent", {
      type: MemoryType.PATTERN,
      name: "Test",
      title: "Test",
      description: "Test",
      category: LearningCategory.PATTERN,
      tags: [],
      confidence: ConfidenceAssessmentLevel.MEDIUM,
    });

    assertStringIncludes(result, "Error:");
    assertStringIncludes(result, "not found");
  } finally {
    await cleanup();
  }
});

// ===== Demote Command Tests =====

Deno.test("MemoryCommands: demote moves learning to project", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    // Create target project
    await createTestProject(memoryBank, "target-app", { overview: "Target project" });
    await memoryBank.initGlobalMemory();

    // Add global learning
    const learning = new LearningBuilder()
      .withTitle("ILearning to Demote")
      .withDescription("This will be demoted")
      .withTags(["demote-test"])
      .build();

    await memoryBank.addGlobalLearning(learning);

    // Demote the learning
    const result = await commands.demote(learning.id, "target-app");

    assertStringIncludes(result, "demoted");

    // Verify removed from global
    const globalMem = await memoryBank.getGlobalMemory();
    assertEquals(globalMem?.learnings.length, 0);

    // Verify added to project (1 default + 1 demoted)
    const project = await memoryBank.getProjectMemory("target-app");
    assertEquals(project?.patterns.length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: demote non-existent learning returns error", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await createTestProject(memoryBank, "target-app", { overview: "Target" });
    await memoryBank.initGlobalMemory();

    const result = await commands.demote("non-existent-id", "target-app");

    assertStringIncludes(result, "Error:");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: demote to non-existent project returns error", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const learning = new LearningBuilder().build();
    await memoryBank.addGlobalLearning(learning);

    const result = await commands.demote(learning.id, "non-existent-project");

    assertStringIncludes(result, "Error:");
  } finally {
    await cleanup();
  }
});
