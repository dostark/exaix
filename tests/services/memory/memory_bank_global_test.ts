/**
 * @module MemoryBankGlobalTest
 * @path tests/services/memory/memory_bank_global_test.ts
 * @description Verifies the LearningSchema and its application in global memory banks,
 * ensuring context-free knowledge and patterns are correctly validated and persisted.
 */

import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { EvaluationCategory, MemoryReferenceType } from "../../../src/shared/enums.ts";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { MemoryBankService } from "../../../src/services/memory/memory_bank.ts";
import { initTestDbService } from "../../helpers/db.ts";
import {
  GlobalMemorySchema,
  type IGlobalMemory,
  type ILearning,
  type IProjectMemory,
  LearningSchema,
} from "../../../src/shared/schemas/memory_bank.ts";
import {
  ConfidenceAssessmentLevel,
  LearningCategory,
  MemoryBankSource,
  MemoryScope,
  MemoryType,
} from "../../../src/shared/enums.ts";
import { MemoryStatus } from "../../../src/shared/status/memory_status.ts";
import { getMemoryGlobalDir } from "../../helpers/paths_helper.ts";
import { createSampleLearning, createTestMemoryBankWithGlobal } from "../helpers/memory_bank_test_helpers.ts";
import { DEFAULT_GLOBAL_MEMORY_VERSION } from "../../../src/shared/constants.ts";

// ===== ILearning Schema Tests =====

Deno.test("LearningSchema: validates minimal learning", () => {
  const learning = createSampleLearning({
    id: "550e8400-e29b-41d4-a716-446655440000",
    created_at: "2026-01-04T12:00:00Z",
    source: MemoryBankSource.EXECUTION,
    scope: MemoryScope.PROJECT,
    project: "my-app",
    title: "Error handling pattern",
    description: "Always use try-catch with typed errors in async functions",
    category: LearningCategory.PATTERN,
    tags: ["error-handling", "typescript"],
    confidence: ConfidenceAssessmentLevel.HIGH,
    status: MemoryStatus.APPROVED,
  });

  const result = LearningSchema.safeParse(learning);
  assertEquals(result.success, true);
});

Deno.test("LearningSchema: validates global learning without project", () => {
  const learning = createSampleLearning({
    id: "550e8400-e29b-41d4-a716-446655440001",
    created_at: "2026-01-04T12:00:00Z",
    source: MemoryBankSource.USER,
    scope: MemoryScope.GLOBAL,
    title: "Always run tests before commit",
    description: "Ensure all tests pass before committing to avoid CI failures",
    category: LearningCategory.INSIGHT,
    tags: ["testing", "workflow"],
    confidence: ConfidenceAssessmentLevel.HIGH,
    status: MemoryStatus.APPROVED,
  });

  const result = LearningSchema.safeParse(learning);
  assertEquals(result.success, true);
});

Deno.test("LearningSchema: validates pending status with references", () => {
  const learning = createSampleLearning({
    id: "550e8400-e29b-41d4-a716-446655440002",
    created_at: "2026-01-04T12:00:00Z",
    source: MemoryBankSource.IDENTITY,
    source_id: "trace-123",
    scope: MemoryScope.PROJECT,
    project: "my-app",
    title: "Avoid N+1 queries",
    description: "Use joins or batch loading to avoid N+1 query problems",
    category: LearningCategory.ANTI_PATTERN,
    tags: ["database", EvaluationCategory.PERFORMANCE],
    confidence: ConfidenceAssessmentLevel.MEDIUM,
    references: [
      { type: MemoryReferenceType.FILE, path: "src/services/user.ts" },
      { type: MemoryReferenceType.EXECUTION, path: "trace-123" },
    ],
    status: MemoryStatus.PENDING,
  });

  const result = LearningSchema.safeParse(learning);
  assertEquals(result.success, true);
});

Deno.test("LearningSchema: rejects invalid category", () => {
  const learning = createSampleLearning({
    id: "550e8400-e29b-41d4-a716-446655440003",
    created_at: "2026-01-04T12:00:00Z",
    source: MemoryBankSource.USER,
    scope: MemoryScope.GLOBAL,
    title: "Test",
    description: "Test description",
    category: "invalid-category" as Partial<LearningCategory> as LearningCategory, // Invalid
    tags: [],
    confidence: ConfidenceAssessmentLevel.HIGH,
    status: MemoryStatus.APPROVED,
  });

  const result = LearningSchema.safeParse(learning);
  assertEquals(result.success, false);
});

Deno.test("LearningSchema: rejects invalid status", () => {
  const learning: unknown = {
    id: "550e8400-e29b-41d4-a716-446655440003",
    created_at: "2026-01-04T12:00:00Z",
    source: MemoryBankSource.IDENTITY,
    scope: MemoryScope.GLOBAL,
    title: "Test title",
    description: "Test description",
    category: LearningCategory.PATTERN,
    tags: [],
    confidence: ConfidenceAssessmentLevel.HIGH,
    status: "unknown", // Invalid
  };

  const result = LearningSchema.safeParse(learning);
  assertEquals(result.success, false);
});

// ===== GlobalMemory Schema Tests =====

Deno.test("GlobalMemorySchema: validates empty global memory", () => {
  const globalMem: IGlobalMemory = {
    version: DEFAULT_GLOBAL_MEMORY_VERSION,
    updated_at: "2026-01-04T12:00:00Z",
    learnings: [],
    patterns: [],
    anti_patterns: [],
    statistics: {
      total_learnings: 0,
      by_category: {},
      by_project: {},
      last_activity: "2026-01-04T12:00:00Z",
    },
  };

  const result = GlobalMemorySchema.safeParse(globalMem);
  assertEquals(result.success, true);
});

Deno.test("GlobalMemorySchema: validates populated global memory", () => {
  const globalMem = {
    version: DEFAULT_GLOBAL_MEMORY_VERSION,
    updated_at: "2026-01-04T12:00:00Z",
    learnings: [
      createSampleLearning({
        id: "550e8400-e29b-41d4-a716-446655440000",
        created_at: "2026-01-04T12:00:00Z",
        source: MemoryBankSource.USER,
        scope: MemoryScope.GLOBAL,
        title: "Global pattern",
        description: "A global pattern description",
        category: LearningCategory.PATTERN,
        tags: [MemoryScope.GLOBAL],
        confidence: ConfidenceAssessmentLevel.HIGH,
        status: MemoryStatus.APPROVED,
      }),
    ],
    patterns: [
      {
        name: "Error Boundary IPattern",
        description: "Wrap components in error boundaries",
        applies_to: ["all"],
        examples: ["src/components/ErrorBoundary.tsx"],
        tags: ["react", "error-handling"],
      },
    ],
    anti_patterns: [
      {
        name: "God Class",
        description: "A class that does too much",
        reason: "Hard to maintain and test",
        alternative: "Break into smaller, focused classes",
        tags: ["architecture", "oop"],
      },
    ],
    statistics: {
      total_learnings: 1,
      by_category: { pattern: 1 },
      by_project: { "my-app": 1 },
      last_activity: "2026-01-04T12:00:00Z",
    },
  };

  const result = GlobalMemorySchema.safeParse(globalMem);
  assertEquals(result.success, true);
});

// ===== MemoryBankService Global Memory Tests =====

Deno.test("MemoryBankService: getGlobalMemory returns null for new installation", async () => {
  const { db, config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config, db);
    const result = await service.getGlobalMemory();
    assertEquals(result, null);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: initGlobalMemory creates Global directory structure", async () => {
  const { db, config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config, db);
    await service.initGlobalMemory();

    const globalDir = getMemoryGlobalDir(config.system.root);
    assertEquals(await exists(globalDir), true);
    assertEquals(await exists(join(globalDir, "learnings.md")), true);
    assertEquals(await exists(join(globalDir, "learnings.json")), true);
    assertEquals(await exists(join(globalDir, "patterns.md")), true);
    assertEquals(await exists(join(globalDir, "anti-patterns.md")), true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: getGlobalMemory returns initialized memory", async () => {
  const { db, config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config, db);
    await service.initGlobalMemory();

    const globalMem = await service.getGlobalMemory();
    assertExists(globalMem);
    assertEquals(globalMem.version, DEFAULT_GLOBAL_MEMORY_VERSION);
    assertEquals(globalMem.learnings, []);
    assertEquals(globalMem.patterns, []);
    assertEquals(globalMem.anti_patterns, []);
    assertEquals(globalMem.statistics.total_learnings, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: addGlobalLearning creates learning entry", async () => {
  const { service, cleanup } = await createTestMemoryBankWithGlobal();

  try {
    const learning = createSampleLearning({
      id: "550e8400-e29b-41d4-a716-446655440000",
      created_at: "2026-01-04T12:00:00Z",
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "Always validate input",
      description: "Validate all user input at API boundaries",
      category: LearningCategory.PATTERN,
      tags: [EvaluationCategory.SECURITY, "validation"],
      confidence: ConfidenceAssessmentLevel.HIGH,
      status: MemoryStatus.APPROVED,
    });

    await service.addGlobalLearning(learning);

    const globalMem = await service.getGlobalMemory();
    assertExists(globalMem);
    assertEquals(globalMem.learnings.length, 1);
    assertEquals(globalMem.learnings[0].title, "Always validate input");
    assertEquals(globalMem.statistics.total_learnings, 1);
    assertEquals(globalMem.statistics.by_category[LearningCategory.PATTERN], 1);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: addGlobalLearning updates markdown file", async () => {
  const { service, config, cleanup } = await createTestMemoryBankWithGlobal();

  try {
    const learning = createSampleLearning({
      id: "550e8400-e29b-41d4-a716-446655440000",
      created_at: "2026-01-04T12:00:00Z",
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "Input Validation IPattern",
      description: "Always validate user input at API boundaries",
      category: LearningCategory.PATTERN,
      tags: [EvaluationCategory.SECURITY],
      confidence: ConfidenceAssessmentLevel.HIGH,
      status: MemoryStatus.APPROVED,
    });

    await service.addGlobalLearning(learning);

    const mdPath = join(getMemoryGlobalDir(config.system.root), "learnings.md");
    const content = await Deno.readTextFile(mdPath);
    assertStringIncludes(content, "Input Validation IPattern");
    assertStringIncludes(content, "Always validate user input");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: addGlobalLearning logs to IActivity Journal", async () => {
  const { service, db, cleanup } = await createTestMemoryBankWithGlobal();

  try {
    const learning = createSampleLearning({
      id: "550e8400-e29b-41d4-a716-446655440000",
      created_at: "2026-01-04T12:00:00Z",
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "Test learning",
      description: "Test description",
      category: LearningCategory.INSIGHT,
      tags: [],
      confidence: ConfidenceAssessmentLevel.MEDIUM,
      status: MemoryStatus.APPROVED,
    });

    await service.addGlobalLearning(learning);

    // Wait for batch flush
    await db.waitForFlush();

    // Check IActivity Journal
    const activities = db.instance.prepare(
      "SELECT action_type, target FROM activity WHERE action_type = 'memory.global.learning.added'",
    ).all() as Array<{ action_type: string; target: string }>;
    assertEquals(activities.length, 1);
    assertEquals(activities[0].target, MemoryScope.GLOBAL);
  } finally {
    await cleanup();
  }
});

// ===== Promote ILearning Tests =====

Deno.test("MemoryBankService: promoteLearning moves from project to global", async () => {
  const { db, config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config, db);

    // Create project with a pattern/decision that could be promoted
    const projectMem: IProjectMemory = {
      portal: "my-app",
      overview: "Test project",
      patterns: [
        {
          name: "Repository IPattern",
          description: "All database access through repositories",
          examples: ["src/repos/user.ts"],
          tags: ["architecture"],
        },
      ],
      decisions: [],
      references: [],
    };
    await service.createProjectMemory(projectMem);
    await service.initGlobalMemory();

    // Promote the pattern as a learning
    const learningId = await service.promoteLearning("my-app", {
      type: MemoryType.PATTERN,
      name: "Repository IPattern",
      title: "Repository IPattern (Promoted)",
      description: "All database access through repositories - promoted from my-app",
      category: LearningCategory.PATTERN,
      tags: ["architecture", "database"],
      confidence: ConfidenceAssessmentLevel.HIGH,
    });

    assertExists(learningId);

    // Check it was added to global memory
    const globalMem = await service.getGlobalMemory();
    assertExists(globalMem);
    assertEquals(globalMem.learnings.length, 1);
    assertEquals(globalMem.learnings[0].title, "Repository IPattern (Promoted)");
    assertEquals(globalMem.learnings[0].project, "my-app");
    assertEquals(globalMem.statistics.by_project["my-app"], 1);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: promoteLearning logs to IActivity Journal", async () => {
  const { db, config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config, db);

    const projectMem: IProjectMemory = {
      portal: "my-app",
      overview: "Test project",
      patterns: [],
      decisions: [
        {
          date: "2026-01-04",
          decision: "Use TypeScript",
          rationale: "Better type safety",
          tags: ["language"],
        },
      ],
      references: [],
    };
    await service.createProjectMemory(projectMem);
    await service.initGlobalMemory();

    await service.promoteLearning("my-app", {
      type: MemoryType.DECISION,
      name: "Use TypeScript",
      title: "TypeScript for all projects",
      description: "Use TypeScript for better type safety",
      category: LearningCategory.DECISION,
      tags: ["language"],
      confidence: ConfidenceAssessmentLevel.HIGH,
    });

    // Wait for batch flush
    await db.waitForFlush();

    const activities = db.instance.prepare(
      "SELECT action_type, target, payload FROM activity WHERE action_type = 'memory.learning.promoted'",
    ).all() as Array<{ action_type: string; target: string; payload: string }>;
    assertEquals(activities.length, 1);
    assertEquals(activities[0].target, "my-app");
    assertStringIncludes(activities[0].payload, MemoryScope.GLOBAL);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: promoteLearning from non-existent project throws", async () => {
  const { db, config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config, db);
    await service.initGlobalMemory();

    await assertRejects(
      async () => {
        await service.promoteLearning("non-existent", {
          type: MemoryType.PATTERN,
          name: "Test",
          title: "Test",
          description: "Test",
          category: LearningCategory.PATTERN,
          tags: [],
          confidence: ConfidenceAssessmentLevel.MEDIUM,
        });
      },
      Error,
      "Project memory not found",
    );
  } finally {
    await cleanup();
  }
});

// ===== Demote ILearning Tests =====

Deno.test("MemoryBankService: demoteLearning moves from global to project", async () => {
  const { service, cleanup } = await createTestMemoryBankWithGlobal({
    title: "Test IPattern",
    description: "A test pattern for demotion",
  });

  try {
    // Create target project for demotion
    const projectMem: IProjectMemory = {
      portal: "target-app",
      overview: "Target project",
      patterns: [],
      decisions: [],
      references: [],
    };
    await service.createProjectMemory(projectMem);

    // Get the learning ID from the helper-created learning
    const globalMem = await service.getGlobalMemory();
    assertExists(globalMem);
    assertEquals(globalMem.learnings.length, 1);
    const learningId = globalMem.learnings[0].id;

    // Demote to project
    await service.demoteLearning(learningId, "target-app");

    // Verify removed from global
    const updatedGlobalMem = await service.getGlobalMemory();
    assertExists(updatedGlobalMem);
    assertEquals(updatedGlobalMem.learnings.length, 0);

    // Verify added to project patterns
    const project = await service.getProjectMemory("target-app");
    assertExists(project);
    assertEquals(project.patterns.length, 1);
    assertEquals(project.patterns[0].name, "Test IPattern");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: demoteLearning removes from global index", async () => {
  const { db, config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config, db);

    const projectMem: IProjectMemory = {
      portal: "target-app",
      overview: "Target",
      patterns: [],
      decisions: [],
      references: [],
    };
    await service.createProjectMemory(projectMem);
    await service.initGlobalMemory();

    // Add two learnings
    const learning1 = createSampleLearning({
      id: "550e8400-e29b-41d4-a716-446655440001",
      created_at: "2026-01-04T12:00:00Z",
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "ILearning 1",
      description: "First learning",
      category: LearningCategory.PATTERN,
      tags: [],
      confidence: ConfidenceAssessmentLevel.HIGH,
      status: MemoryStatus.APPROVED,
    });
    const learning2 = createSampleLearning({
      id: "550e8400-e29b-41d4-a716-446655440002",
      created_at: "2026-01-04T12:00:00Z",
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "ILearning 2",
      description: "Second learning",
      category: LearningCategory.INSIGHT,
      tags: [],
      confidence: ConfidenceAssessmentLevel.MEDIUM,
      status: MemoryStatus.APPROVED,
    });
    await service.addGlobalLearning(learning1);
    await service.addGlobalLearning(learning2);

    // Demote learning 1
    await service.demoteLearning(learning1.id, "target-app");

    // Global should have only learning 2
    const globalMem = await service.getGlobalMemory();
    assertExists(globalMem);
    assertEquals(globalMem.learnings.length, 1);
    assertEquals(globalMem.learnings[0].id, learning2.id);
    assertEquals(globalMem.statistics.total_learnings, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: demoteLearning non-existent learning throws", async () => {
  const { db, config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config, db);

    const projectMem: IProjectMemory = {
      portal: "target-app",
      overview: "Target",
      patterns: [],
      decisions: [],
      references: [],
    };
    await service.createProjectMemory(projectMem);
    await service.initGlobalMemory();

    await assertRejects(
      async () => {
        await service.demoteLearning("non-existent-id", "target-app");
      },
      Error,
      "Learning not found",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: demoteLearning to non-existent project throws", async () => {
  const { service, cleanup } = await createTestMemoryBankWithGlobal();

  try {
    const learning = createSampleLearning({
      id: "550e8400-e29b-41d4-a716-446655440000",
      created_at: "2026-01-04T12:00:00Z",
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "Test",
      description: "Test",
      category: LearningCategory.PATTERN,
      tags: [],
      confidence: ConfidenceAssessmentLevel.HIGH,
      status: MemoryStatus.APPROVED,
    });
    await service.addGlobalLearning(learning);

    await assertRejects(
      async () => {
        await service.demoteLearning(learning.id, "non-existent-project");
      },
      Error,
      "Project memory not found",
    );
  } finally {
    await cleanup();
  }
});

// ===== Global Stats Tests =====

Deno.test("MemoryBankService: getGlobalStats returns accurate statistics", async () => {
  const { db, config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config, db);
    await service.initGlobalMemory();

    // Add learnings with different categories
    const learnings: ILearning[] = [
      createSampleLearning({
        id: "550e8400-e29b-41d4-a716-446655440001",
        created_at: "2026-01-04T12:00:00Z",
        source: MemoryBankSource.USER,
        scope: MemoryScope.GLOBAL,
        project: "app-a",
        title: "IPattern 1",
        description: "Desc 1",
        category: LearningCategory.PATTERN,
        tags: [],
        confidence: ConfidenceAssessmentLevel.HIGH,
        status: MemoryStatus.APPROVED,
      }),
      createSampleLearning({
        id: "550e8400-e29b-41d4-a716-446655440002",
        created_at: "2026-01-04T12:00:00Z",
        source: MemoryBankSource.USER,
        scope: MemoryScope.GLOBAL,
        project: "app-a",
        title: "IPattern 2",
        description: "Desc 2",
        category: LearningCategory.PATTERN,
        tags: [],
        confidence: ConfidenceAssessmentLevel.MEDIUM,
        status: MemoryStatus.APPROVED,
      }),
      createSampleLearning({
        id: "550e8400-e29b-41d4-a716-446655440003",
        created_at: "2026-01-04T12:00:00Z",
        source: MemoryBankSource.IDENTITY,
        scope: MemoryScope.GLOBAL,
        project: "app-b",
        title: "Insight 1",
        description: "Desc 3",
        category: LearningCategory.INSIGHT,
        tags: [],
        confidence: ConfidenceAssessmentLevel.LOW,
        status: MemoryStatus.APPROVED,
      }),
    ];

    for (const learning of learnings) {
      await service.addGlobalLearning(learning);
    }

    const globalMem = await service.getGlobalMemory();
    assertExists(globalMem);
    assertEquals(globalMem.statistics.total_learnings, 3);
    assertEquals(globalMem.statistics.by_category[LearningCategory.PATTERN], 2);
    assertEquals(globalMem.statistics.by_category[LearningCategory.INSIGHT], 1);
    assertEquals(globalMem.statistics.by_project["app-a"], 2);
    assertEquals(globalMem.statistics.by_project["app-b"], 1);
  } finally {
    await cleanup();
  }
});
