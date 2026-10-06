/**
 * @module SkillsServiceTest
 * @path packages/core/tests/skills_test.ts
 * @description Verifies SkillsService trigger matching and prompt-context building over skill
 *   folders: keyword, task type, file pattern and tag scoring, ranking, status filtering, the
 *   per-request cap and context assembly. The draft lifecycle is covered in
 *   tests/skills/skills_service_test.ts.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { EvaluationCategory, SkillStatus } from "@exaix/core";
import { join } from "@std/path";
import { type ISkillsConfig, SkillsService } from "@exaix/core/skills";
import type { ISkillSidecar } from "@exaix/schemas/skill_folder.ts";
import { initTestDbService, type ISkillFolderSeed, writeSkillFolder } from "@exaix/testing";

interface ISkillSeedInput {
  name: string;
  description?: string;
  instructions?: string;
  triggers?: Record<string, string[]>;
  extra?: ISkillSidecar;
}

async function withSeededSkillsService(
  seeds: ISkillSeedInput[],
  testFn: (service: SkillsService) => Promise<void>,
  skillsConfig?: Partial<ISkillsConfig>,
): Promise<void> {
  const { db, config, cleanup } = await initTestDbService();
  const blueprintSkillsDir = await Deno.makeTempDir({ prefix: "skills-test-" });
  try {
    for (const seed of seeds) {
      const folder: ISkillFolderSeed = {
        name: seed.name,
        description: seed.description ?? `${seed.name} skill`,
        instructions: seed.instructions ?? `Instructions for ${seed.name}`,
        sidecar: { ...(seed.triggers ? { triggers: seed.triggers } : {}), ...seed.extra },
      };
      await writeSkillFolder(blueprintSkillsDir, folder);
    }
    const service = new SkillsService(
      { memoryDir: join(config.system.root, config.paths.memory), blueprintSkillsDir },
      db,
      skillsConfig,
    );
    await service.initialize();
    await testFn(service);
  } finally {
    await Deno.remove(blueprintSkillsDir, { recursive: true });
    await cleanup();
  }
}

const BUGFIX_REQUEST_TEXT =
  "Fix the null-safety bugs in src/utils.ts: formatAssignee crashes when a task has no assignee. Add null checks so the function returns an empty string instead of crashing.";

Deno.test("SkillsService: matchSkills returns skills matching keywords", async () => {
  await withSeededSkillsService([
    { name: "keyword-match", triggers: { keywords: ["implement", "feature", "create"] } },
  ], async (service) => {
    const { matches } = await service.matchSkills({ keywords: ["implement", "new", "feature"] });
    const matched = matches.find((m) => m.skillId === "keyword-match");
    assertExists(matched);
    assertEquals(matched.confidence > 0, true);
    assertExists(matched.matchedTriggers.keywords);
  });
});

Deno.test("fix(skills): matchSkills does not penalize a partial match against a long trigger keyword list below the match threshold", async () => {
  // Mirrors tdd-methodology: 8 keywords, only 2 relevant. Confidence must not divide by the total
  // keyword count, or a broad-but-relevant skill scores below the 0.3 default matchThreshold.
  await withSeededSkillsService([
    {
      name: "broad-trigger-list",
      triggers: { keywords: ["implement", "feature", "add", "create", "build", "fix", "bugfix", "develop"] },
    },
  ], async (service) => {
    const { matches } = await service.matchSkills({
      requestText: BUGFIX_REQUEST_TEXT,
      keywords: ["fix", "null", "safety", "bugs", "crashes", "assignee", "add", "checks", "crashing"],
    });
    assertExists(
      matches.find((m) => m.skillId === "broad-trigger-list"),
      "expected a partial keyword match against a long trigger list to clear matchThreshold",
    );
  });
});

Deno.test("fix-bug skill outranks tdd-methodology for a bugfix request", async () => {
  // Mirrors two real global skills: fix-bug has tight bug-focused triggers, tdd-methodology has broad
  // implement/feature keywords plus bugfix in task_types. The specialized skill must rank first.
  await withSeededSkillsService([
    {
      name: "fix-bug",
      triggers: {
        keywords: [
          "fix",
          "bug",
          "bugs",
          "bugfix",
          "defect",
          "crash",
          "crashes",
          "crashing",
          "error",
          "fails",
          "failing",
          "regression",
          "broken",
          "reproduce",
        ],
        task_types: ["bugfix"],
        tags: ["bugfix", "debugging"],
      },
    },
    {
      name: "tdd-methodology",
      triggers: {
        keywords: ["implement", "feature", "add", "create", "build", "fix", "bugfix", "develop"],
        task_types: ["feature", "bugfix", "refactor", "implementation"],
        tags: ["development", "testing", "tdd"],
      },
    },
  ], async (service) => {
    const { matches } = await service.matchSkills({
      requestText: BUGFIX_REQUEST_TEXT,
      keywords: ["fix", "null", "safety", "bugs", "crashes", "assignee", "add", "checks", "crashing"],
      taskType: "bugfix",
      tags: ["bugfix"],
    });

    const fixBug = matches.find((m) => m.skillId === "fix-bug");
    const tdd = matches.find((m) => m.skillId === "tdd-methodology");
    assertExists(fixBug, "fix-bug skill should match a bugfix request");
    assertExists(tdd, "tdd-methodology should still match (broad triggers)");
    assertEquals(
      matches[0].skillId,
      "fix-bug",
      `expected fix-bug to rank first, got order: ${
        matches.map((m) => `${m.skillId}(${m.confidence.toFixed(2)})`).join(", ")
      }`,
    );
    assertEquals(fixBug.confidence > tdd.confidence, true);

    // AgentRunner passes keywords, task type, file paths and tags. Fix-bug must rank first for that signal too.
    const { matches: analysisMatches } = await service.matchSkills({
      keywords: ["fix", "null", "safety", "bugs", "crashes", "add", "checks"],
      taskType: "bugfix",
      filePaths: ["src/utils.ts"],
      tags: ["bugfix"],
    });
    assertEquals(analysisMatches[0]?.skillId, "fix-bug");
  });
});

Deno.test("SkillsService: matchSkills returns skills matching task types", async () => {
  await withSeededSkillsService([
    { name: "tasktype-match", triggers: { task_types: ["bugfix", EvaluationCategory.SECURITY] } },
  ], async (service) => {
    const { matches } = await service.matchSkills({ taskType: "bugfix" });
    const matched = matches.find((m) => m.skillId === "tasktype-match");
    assertExists(matched);
    assertEquals(matched.matchedTriggers.task_types, ["bugfix"]);
  });
});

Deno.test("SkillsService: matchSkills returns skills matching file patterns", async () => {
  await withSeededSkillsService([
    { name: "filepattern-match", triggers: { file_patterns: ["*.ts", "src/**/*.js"] } },
  ], async (service) => {
    const { matches } = await service.matchSkills({ filePaths: ["test.ts", "other.py"] });
    const matched = matches.find((m) => m.skillId === "filepattern-match");
    assertExists(matched);
    assertExists(matched.matchedTriggers.file_patterns);
  });
});

Deno.test("SkillsService: matchSkills excludes non-active skills", async () => {
  await withSeededSkillsService([
    {
      name: "draft-skill",
      triggers: { keywords: [SkillStatus.DRAFT, "exclusive", "unique-keyword-xyz"] },
      extra: { status: SkillStatus.DRAFT },
    },
  ], async (service) => {
    const { matches } = await service.matchSkills({
      keywords: [SkillStatus.DRAFT, "exclusive", "unique-keyword-xyz"],
    });
    assertEquals(matches.find((m) => m.skillId === "draft-skill"), undefined);
  });
});

Deno.test("SkillsService: matchSkills extracts keywords from request text", async () => {
  await withSeededSkillsService([
    { name: "text-extract", triggers: { keywords: ["authentication", "login"] } },
  ], async (service) => {
    const { matches } = await service.matchSkills({
      requestText: "Please implement authentication for the login page",
    });
    assertExists(matches.find((m) => m.skillId === "text-extract"));
  });
});

Deno.test("SkillsService: matchSkills respects maxSkillsPerRequest limit", async () => {
  const seeds = Array.from({ length: 10 }, (_, i) => ({
    name: `limit-test-${i}`,
    triggers: { keywords: ["limitspecial", "testspecial"] },
  }));
  await withSeededSkillsService(seeds, async (service) => {
    const { matches, totalAvailable } = await service.matchSkills({ keywords: ["limitspecial", "testspecial"] });
    assertEquals(matches.length, 5, "the default cap is 5");
    assertEquals(totalAvailable, 10);
  });
  await withSeededSkillsService(seeds, async (service) => {
    const { matches } = await service.matchSkills({ keywords: ["limitspecial", "testspecial"] });
    assertEquals(matches.length, 2, "an explicit cap overrides the default");
  }, { maxSkillsPerRequest: 2 });
});

Deno.test("SkillsService: buildSkillContext generates markdown context", async () => {
  await withSeededSkillsService([
    {
      name: "context-test",
      description: "For context building",
      instructions: "Do the context thing step by step",
      triggers: { keywords: ["context"] },
      extra: {
        title: "Context Test Skill",
        constraints: ["Must follow rule 1", "Must follow rule 2"],
        quality_criteria: [{ name: "Quality", weight: 50 }, { name: "Speed", weight: 50 }],
      },
    },
  ], async (service) => {
    const context = await service.buildSkillContext(["context-test"]);
    assertStringIncludes(context, "APPLICABLE SKILLS");
    assertStringIncludes(context, "Context Test Skill");
    assertStringIncludes(context, "Do the context thing");
    assertStringIncludes(context, "Must follow rule 1");
  });
});

Deno.test("SkillsService: buildSkillContext handles missing skills", async () => {
  await withSeededSkillsService([], async (service) => {
    assertEquals(await service.buildSkillContext(["nonexistent-1", "nonexistent-2"]), "");
  });
});

Deno.test("SkillsService: buildSkillContext combines multiple skills", async () => {
  await withSeededSkillsService([
    { name: "multi-1", instructions: "Instructions for skill 1", extra: { title: "Multi Skill 1" } },
    { name: "multi-2", instructions: "Instructions for skill 2", extra: { title: "Multi Skill 2" } },
  ], async (service) => {
    const context = await service.buildSkillContext(["multi-1", "multi-2"]);
    for (const expected of ["Multi Skill 1", "Multi Skill 2", "Instructions for skill 1", "Instructions for skill 2"]) {
      assertStringIncludes(context, expected);
    }
  });
});

Deno.test("SkillsService: buildSkillContext drops a skill that overflows the context budget", async () => {
  await withSeededSkillsService([
    { name: "big-skill", instructions: "x".repeat(5_000), extra: { title: "Big Skill" } },
  ], async (service) => {
    const context = await service.buildSkillContext(["big-skill"]);
    assertStringIncludes(context, "excluded due to context budget");
    assertEquals(context.includes("Big Skill"), false);
  });
});
