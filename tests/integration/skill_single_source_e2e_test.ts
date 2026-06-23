/**
 * @module SkillSingleSourceE2eTest
 * @path tests/integration/skill_single_source_e2e_test.ts
 * @description Phase 125 Step 6 — verifies the .copilot/skills/ → sandbox
 *   transform end-to-end: generated skills load through the real SkillsService,
 *   stale indices are rebuilt after generation (GAP-2), and trigger-based
 *   skill matching works for the dogfood daemon path.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @exaix/schemas, @exaix/core/skills, @exaix/testing]
 * @related-files [scripts/generate_skill_json.ts, packages/core/src/skills/skills.ts]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { generateSkillJson } from "../../scripts/generate_skill_json.ts";
import { SkillsService } from "@exaix/core/skills";
import { initTestDbService } from "@exaix/testing";
import { MemoryScope } from "@exaix/core";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const DOT_COPILOT_SKILLS = join(REPO_ROOT, ".copilot", "skills");

Deno.test({
  name: "[skill_single_source_e2e] generated skill loads via real SkillsService",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { db, cleanup: dbCleanup } = await initTestDbService();
    const sandboxRoot = await Deno.makeTempDir({ prefix: "e2e-skills-" });
    try {
      const targetDir = join(sandboxRoot, "Memory", "Skills");
      const result = await generateSkillJson(DOT_COPILOT_SKILLS, targetDir, sandboxRoot);
      assertEquals(result.success, true, "generator must succeed");
      assert(result.generated.length >= 10, `must generate many skills, got ${result.generated.length}`);

      const commitGenerated = result.generated.includes("commit");
      assert(commitGenerated, "commit skill must be generated");

      const memoryDir = join(sandboxRoot, "Memory");
      const service = new SkillsService({ memoryDir }, db);
      await service.initialize();

      const skill = await service.getSkill("commit");
      assertExists(skill, "commit skill must load through SkillsService");
      assertEquals(skill.skill_id, "commit");
      assertEquals(skill.source, "user");
      assert(skill.instructions.length >= 10, "instructions must be non-empty");
      assertExists(skill.triggers, "skill must have triggers");
      assertEquals(skill.triggers.keywords?.includes("commit"), true);
      assertEquals(skill.scope, MemoryScope.GLOBAL);
    } finally {
      await Deno.remove(sandboxRoot, { recursive: true });
      await dbCleanup();
    }
  },
});

Deno.test({
  name: "[skill_single_source_e2e] pre-existing index rebuilt to include new skill after generation",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { db, cleanup: dbCleanup } = await initTestDbService();
    const sandboxRoot = await Deno.makeTempDir({ prefix: "e2e-index-" });
    try {
      const skillsDir = join(sandboxRoot, "Memory", "Skills");
      const globalDir = join(skillsDir, MemoryScope.GLOBAL);
      await Deno.mkdir(globalDir, { recursive: true });

      // Seed a pre-existing index.json that does NOT contain "commit"
      const staleIndex = {
        version: 2,
        updated_at: new Date().toISOString(),
        skills: [
          {
            skill_id: "some-old-skill",
            name: "Some Old Skill",
            version: "1.0.0",
            status: "active",
            scope: "global",
            triggers: { keywords: [], task_types: [], tags: [] },
            path: "global/some-old-skill.json",
          },
        ],
      };
      await Deno.writeTextFile(
        join(skillsDir, "index.json"),
        JSON.stringify(staleIndex, null, 2),
      );
      // Also write a fake old skill file so the index entry has a backing file
      await Deno.writeTextFile(
        join(globalDir, "some-old-skill.json"),
        JSON.stringify(
          {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            source: "user",
            scope: "global",
            status: "active",
            skill_id: "some-old-skill",
            name: "Some Old Skill",
            version: "1.0.0",
            description: "Old skill",
            triggers: { keywords: [], task_types: [], tags: [] },
            instructions: "Do something useful. ".repeat(5),
            usage_count: 0,
          },
          null,
          2,
        ),
      );

      // Run the transform (writes new skills, deletes index.json)
      const result = await generateSkillJson(DOT_COPILOT_SKILLS, skillsDir, sandboxRoot);
      assertEquals(result.success, true, "generator must succeed");
      assert(result.generated.includes("commit"), "commit must be generated");

      // index.json should have been deleted by the generator
      const indexExists = await exists(join(skillsDir, "index.json"));
      assertEquals(indexExists, false, "index.json must be deleted after generation");

      // SkillsService should rebuild the index via buildIndex()
      const memoryDir = join(sandboxRoot, "Memory");
      const service = new SkillsService({ memoryDir }, db);
      await service.initialize();

      // The new skill should be discoverable through the rebuilt index
      const skill = await service.getSkill("commit");
      assertExists(skill, "commit must be discoverable after index rebuild");
      assertEquals(skill.skill_id, "commit");

      // The old skill should also still be discoverable
      const oldSkill = await service.getSkill("some-old-skill");
      assertExists(oldSkill, "old skill must survive index rebuild");
      assertEquals(oldSkill.skill_id, "some-old-skill");
    } finally {
      await Deno.remove(sandboxRoot, { recursive: true });
      await dbCleanup();
    }
  },
});

Deno.test({
  name: "[skill_single_source_e2e] remediate-plan-gaps matches for a remediate-plan-tagged request",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { db, cleanup: dbCleanup } = await initTestDbService();
    const sandboxRoot = await Deno.makeTempDir({ prefix: "e2e-match-" });
    try {
      const targetDir = join(sandboxRoot, "Memory", "Skills");
      const result = await generateSkillJson(DOT_COPILOT_SKILLS, targetDir, sandboxRoot);
      assertEquals(result.success, true);
      assert(result.generated.includes("remediate-plan-gaps"), "remediate-plan-gaps must be generated");

      const memoryDir = join(sandboxRoot, "Memory");
      const service = new SkillsService({ memoryDir }, db);
      await service.initialize();

      const matchResult = await service.matchSkills({
        tags: ["remediate-plan"],
        keywords: ["remediate", "gaps"],
        taskType: "planning",
      });

      assert(matchResult.matches.length > 0, "must have at least one matching skill");
      const remediateMatch = matchResult.matches.find(
        (m) => m.skillId === "remediate-plan-gaps",
      );
      assertExists(
        remediateMatch,
        "remediate-plan-gaps must match for remediate-plan tag",
      );
      assert(
        remediateMatch.confidence >= 0.3,
        `confidence must be >= match threshold, got ${remediateMatch.confidence}`,
      );
    } finally {
      await Deno.remove(sandboxRoot, { recursive: true });
      await dbCleanup();
    }
  },
});
