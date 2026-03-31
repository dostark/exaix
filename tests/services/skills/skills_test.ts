/**
 * @module SkillsServiceTest
 * @path tests/services/skills_test.ts
 * @description Verifies the SkillsService, ensuring correct discovery, indexing, and
 * lifecycle management of dynamic agent capabilities from the Skills directory.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  EvaluationCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryScope,
  SkillStatus,
} from "../../../src/shared/enums.ts";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { SkillsService } from "../../../src/services/skills/skills.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { getMemorySkillsDir } from "../../helpers/paths_helper.ts";
import { DEFAULT_GLOBAL_MEMORY_VERSION } from "../../../src/shared/constants.ts";

type TestDbContext = Awaited<ReturnType<typeof initTestDbService>>;

async function withInitializedSkillsService(
  testFn: (context: { service: SkillsService; config: TestDbContext["config"] }) => Promise<void>,
): Promise<void> {
  const { db, config, cleanup } = await initTestDbService();

  try {
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    await service.initialize();
    await testFn({ service, config });
  } finally {
    await cleanup();
  }
}

// ===== Directory Structure Tests =====

Deno.test("SkillsService: initialize creates directory structure", async () => {
  await withInitializedSkillsService(async ({ config }) => {
    const skillsDir = getMemorySkillsDir(config.system.root);
    assertEquals(await exists(skillsDir), true);
    assertEquals(await exists(join(skillsDir, MemoryBankSource.CORE)), true);
    assertEquals(await exists(join(skillsDir, MemoryBankSource.LEARNED)), true);
    assertEquals(await exists(join(skillsDir, MemoryScope.PROJECT)), true);
    assertEquals(await exists(join(skillsDir, "index.json")), true);
  });
});

// ===== CRUD Operations Tests =====

Deno.test("SkillsService: createSkill creates and indexes skill", async () => {
  await withInitializedSkillsService(async ({ service, config }) => {
    const skill = await service.createSkill({
      skill_id: "test-skill",
      name: "Test Skill",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "A test skill",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: {
        keywords: ["test", "example"],
        task_types: ["testing"],
      },
      instructions: "Test instructions here",
    });

    assertExists(skill.id);
    assertEquals(skill.skill_id, "test-skill");
    assertEquals(skill.name, "Test Skill");
    assertEquals(skill.usage_count, 0);

    // Verify file was created
    const skillPath = join(getMemorySkillsDir(config.system.root), "global", "test-skill.json");
    assertEquals(await exists(skillPath), true);
  });
});

Deno.test("SkillsService: getSkill retrieves created skill", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    // Create a skill first
    await service.createSkill({
      skill_id: "get-test-skill",
      name: "Get Test Skill",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "Test get operation",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: {
        keywords: ["get", "test"],
      },
      instructions: "Get test instructions",
    });

    const skill = await service.getSkill("get-test-skill");
    assertExists(skill);
    assertEquals(skill?.name, "Get Test Skill");
    assertEquals(skill?.instructions, "Get test instructions");
  });
});

Deno.test("SkillsService: getSkill returns null for missing skill", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    const skill = await service.getSkill("nonexistent-skill");
    assertEquals(skill, null);
  });
});

Deno.test("SkillsService: listSkills returns all active skills", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    // Create multiple skills
    await service.createSkill({
      skill_id: "list-skill-1",
      name: "List Skill 1",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "First skill",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: { keywords: ["one"] },
      instructions: "Instructions 1",
    });

    await service.createSkill({
      skill_id: "list-skill-2",
      name: "List Skill 2",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "Second skill",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.DRAFT,
      source: MemoryBankSource.USER,
      triggers: { keywords: ["two"] },
      instructions: "Instructions 2",
    });

    const allSkills = await service.listSkills();
    const activeSkills = await service.listSkills({ status: SkillStatus.ACTIVE });
    const draftSkills = await service.listSkills({ status: SkillStatus.DRAFT });

    // Should have at least the skills we created
    const listSkills = allSkills.filter((s) => s.skill_id.startsWith("list-skill"));
    assertEquals(listSkills.length >= 2, true);

    const activeList = activeSkills.filter((s) => s.skill_id.startsWith("list-skill"));
    assertEquals(activeList.length >= 1, true);

    const draftList = draftSkills.filter((s) => s.skill_id.startsWith("list-skill"));
    assertEquals(draftList.length >= 1, true);
  });
});

Deno.test("SkillsService: updateSkill modifies skill", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    await service.createSkill({
      skill_id: "update-test",
      name: "Update Test",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "Before update",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.DRAFT,
      source: MemoryBankSource.USER,
      triggers: { keywords: [MemoryOperation.UPDATE] },
      instructions: "Original instructions",
    });

    const updated = await service.updateSkill("update-test", {
      name: "Updated Name",
      version: "1.1.0",
      instructions: "Updated instructions",
    });

    assertExists(updated);
    assertEquals(updated?.name, "Updated Name");
    assertEquals(updated?.version, "1.1.0");
    assertEquals(updated?.instructions, "Updated instructions");
    assertEquals(updated?.skill_id, "update-test"); // ID unchanged
  });
});

Deno.test("SkillsService: activateSkill changes draft to active", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    await service.createSkill({
      skill_id: "activate-test",
      name: "Activate Test",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "To be activated",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.DRAFT,
      source: MemoryBankSource.USER,
      triggers: { keywords: ["activate"] },
      instructions: "Activation test",
    });

    const result = await service.activateSkill("activate-test");
    assertEquals(result, true);

    const skill = await service.getSkill("activate-test");
    assertEquals(skill?.status, SkillStatus.ACTIVE);
  });
});

Deno.test("SkillsService: deprecateSkill marks skill as deprecated", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    await service.createSkill({
      skill_id: "deprecate-test",
      name: "Deprecate Test",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "To be deprecated",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: { keywords: ["deprecate"] },
      instructions: "Deprecation test",
    });

    const result = await service.deprecateSkill("deprecate-test");
    assertEquals(result, true);

    const skill = await service.getSkill("deprecate-test");
    assertEquals(skill?.status, SkillStatus.DEPRECATED);
  });
});

// ===== Trigger Matching Tests =====

Deno.test("SkillsService: matchSkills returns skills matching keywords", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    await service.createSkill({
      skill_id: "keyword-match",
      name: "Keyword Match",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "Matches keywords",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: {
        keywords: ["implement", "feature", "create"],
      },
      instructions: "Keyword matching test",
    });

    const matches = await service.matchSkills({
      keywords: ["implement", "new", "feature"],
    });

    const matched = matches.find((m) => m.skillId === "keyword-match");
    assertExists(matched);
    assertEquals(matched.confidence > 0, true);
    assertExists(matched.matchedTriggers.keywords);
  });
});

Deno.test("SkillsService: matchSkills returns skills matching task types", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    await service.createSkill({
      skill_id: "tasktype-match",
      name: "Task Type Match",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "Matches task types",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: {
        task_types: ["bugfix", EvaluationCategory.SECURITY],
      },
      instructions: "Task type matching test",
    });

    const matches = await service.matchSkills({
      taskType: "bugfix",
    });

    const matched = matches.find((m) => m.skillId === "tasktype-match");
    assertExists(matched);
    assertEquals(matched.matchedTriggers.task_types, ["bugfix"]);
  });
});

Deno.test("SkillsService: matchSkills returns skills matching file patterns", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    await service.createSkill({
      skill_id: "filepattern-match",
      name: "File IPattern Match",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "Matches file patterns",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: {
        file_patterns: ["*.ts", "src/**/*.js"],
      },
      instructions: "File pattern matching test",
    });

    const matches = await service.matchSkills({
      filePaths: ["test.ts", "other.py"],
    });

    const matched = matches.find((m) => m.skillId === "filepattern-match");
    assertExists(matched);
    assertExists(matched.matchedTriggers.file_patterns);
  });
});

Deno.test("SkillsService: matchSkills excludes non-active skills", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    await service.createSkill({
      skill_id: "draft-skill",
      name: "Draft Skill",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "A draft skill",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.DRAFT,
      source: MemoryBankSource.USER,
      triggers: {
        keywords: [SkillStatus.DRAFT, "exclusive", "unique-keyword-xyz"],
      },
      instructions: "Should not match",
    });

    const matches = await service.matchSkills({
      keywords: [SkillStatus.DRAFT, "exclusive", "unique-keyword-xyz"],
    });

    const matched = matches.find((m) => m.skillId === "draft-skill");
    assertEquals(matched, undefined);
  });
});

Deno.test("SkillsService: matchSkills extracts keywords from request text", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    await service.createSkill({
      skill_id: "text-extract",
      name: "Text Extract",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "Test keyword extraction",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: {
        keywords: ["authentication", "login"],
      },
      instructions: "Text extraction test",
    });

    const matches = await service.matchSkills({
      requestText: "Please implement authentication for the login page",
    });

    const matched = matches.find((m) => m.skillId === "text-extract");
    assertExists(matched);
  });
});

Deno.test("SkillsService: matchSkills respects maxSkillsPerRequest limit", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    // Create many skills with the same trigger
    for (let i = 0; i < 10; i++) {
      await service.createSkill({
        skill_id: `limit-test-${i}`,
        name: `Limit Test ${i}`,
        version: DEFAULT_GLOBAL_MEMORY_VERSION,
        description: "Limit test",
        scope: MemoryScope.GLOBAL,
        status: SkillStatus.ACTIVE,
        source: MemoryBankSource.USER,
        triggers: {
          keywords: ["limitspecial", "testspecial"],
        },
        instructions: `Limit test ${i}`,
      });
    }

    const matches = await service.matchSkills({
      keywords: ["limitspecial", "testspecial"],
    });

    // Default maxSkillsPerRequest is 5
    assertEquals(matches.length <= 5, true);
  });
});

// ===== Skill Context Building Tests =====

Deno.test("SkillsService: buildSkillContext generates markdown context", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    await service.createSkill({
      skill_id: "context-test",
      name: "Context Test Skill",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "For context building",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: { keywords: ["context"] },
      instructions: "Do the context thing step by step",
      constraints: ["Must follow rule 1", "Must follow rule 2"],
      quality_criteria: [
        { name: "Quality", weight: 50 },
        { name: "Speed", weight: 50 },
      ],
    });

    const context = await service.buildSkillContext(["context-test"]);

    assertStringIncludes(context, "APPLICABLE SKILLS");
    assertStringIncludes(context, "Context Test Skill");
    assertStringIncludes(context, "Do the context thing");
  });
});

Deno.test("SkillsService: buildSkillContext handles missing skills", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    const context = await service.buildSkillContext(["nonexistent-1", "nonexistent-2"]);
    assertEquals(context, "");
  });
});

Deno.test("SkillsService: buildSkillContext combines multiple skills", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    await service.createSkill({
      skill_id: "multi-1",
      name: "Multi Skill 1",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "First skill",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: { keywords: ["multi"] },
      instructions: "Instructions for skill 1",
    });

    await service.createSkill({
      skill_id: "multi-2",
      name: "Multi Skill 2",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "Second skill",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: { keywords: ["multi"] },
      instructions: "Instructions for skill 2",
    });

    const context = await service.buildSkillContext(["multi-1", "multi-2"]);

    assertEquals(context.includes("Multi Skill 1"), true);
    assertEquals(context.includes("Multi Skill 2"), true);
    assertEquals(context.includes("Instructions for skill 1"), true);
    assertEquals(context.includes("Instructions for skill 2"), true);
  });
});

// ===== Skill Derivation Tests =====

Deno.test("SkillsService: deriveSkillFromLearnings creates skill with derived_from", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    const learningIds = ["learning-1", "learning-2", "learning-3"];

    const skill = await service.deriveSkillFromLearnings(learningIds, {
      skill_id: "derived-skill",
      name: "Derived Skill",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      source: MemoryBankSource.LEARNED,
      description: "Derived from learnings",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.DRAFT,
      triggers: { keywords: ["derived"] },
      instructions: "Derived instructions",
    });

    assertEquals(skill.source, MemoryBankSource.LEARNED);
    assertEquals(skill.derived_from, learningIds);
    assertEquals(skill.status, SkillStatus.DRAFT); // Always starts as draft
  });
});

// ===== Skill Index Management Tests =====

Deno.test("SkillsService: rebuildIndex scans all skill directories", async () => {
  await withInitializedSkillsService(async ({ service }) => {
    // Create skills in different locations
    await service.createSkill({
      skill_id: "index-learned",
      name: "Learned Index Test",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "In learned dir",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.LEARNED,
      triggers: { keywords: ["index"] },
      instructions: "Index test",
    });

    // Rebuild index
    await service.rebuildIndex();

    const skills = await service.listSkills();
    const found = skills.find((s) => s.skill_id === "index-learned");
    assertExists(found);
  });
});
