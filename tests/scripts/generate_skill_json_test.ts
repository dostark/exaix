/**
 * @module GenerateSkillJsonTest
 * @path tests/scripts/generate_skill_json_test.ts
 * @description Phase 125 Step 2 — verifies the Skill-JSON transform reads
 *   .copilot/skills/ SKILL.md files (glob-pattern under each subdir), validates
 *   via SkillEnvelopeSchema, composes runtime SkillSchema objects, and writes
 *   them atomically to a target dir.
 * @architectural-layer Unit
 * @dependencies [@std/assert, @std/path, @std/fs, @exaix/schemas]
 * @related-files [scripts/generate_skill_json.ts, packages/schemas/src/skill_envelope.ts]
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";
import { generateSkillJson, type IGenerateSkillJsonResult } from "../../scripts/generate_skill_json.ts";

function createFixtureSkill(dir: string, overrides?: Record<string, string>): string {
  const skillDir = join(dir, "test-skill");
  Deno.mkdirSync(skillDir, { recursive: true });
  const body = overrides?.body ??
    "This is the body of the skill. It contains instructions for the agent to follow. It must be at least ten characters long.";
  const exaixBlock = overrides?.exaix ?? `
---
exaix:
  skill_id: test-skill
  triggers:
    keywords: [test, verify]
    task_types: [testing]
  constraints:
    - Write tests first
  output_requirements:
    - Must pass CI
  quality_criteria:
    - name: test_coverage
      description: Tests must cover at least 70%
      weight: 80
---
`;
  const skillMd = `---
name: ${overrides?.name ?? "Test Skill"}
agent: ${overrides?.agent ?? "senior-coder"}
tools:
  - read_file
  - write_file
scope: ${overrides?.scope ?? "dev"}
title: "Test Skill (#test-skill)"
description: A test skill for verifying the JSON generator
short_summary: "Test skill for unit testing"
version: "${overrides?.version ?? "1.0.0"}"
topics: [testing]
qwen_skill: test-skill
---

${body}
${exaixBlock}
`;
  const skillPath = join(skillDir, "SKILL.md");
  Deno.writeTextFileSync(skillPath, skillMd);
  return skillPath;
}

function createEmptySkillsDir(dir: string): string {
  const skillsDir = join(dir, "skills");
  Deno.mkdirSync(skillsDir, { recursive: true });
  return skillsDir;
}

Deno.test("[generate_skill_json] transforms a valid SKILL.md into JSON in temp target", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "gen-skill-test-" });
  try {
    const skillsDir = createEmptySkillsDir(tempDir);
    createFixtureSkill(skillsDir);
    const targetDir = join(tempDir, "target", "Memory", "Skills");
    const sandboxRoot = join(tempDir, "target");

    const result: IGenerateSkillJsonResult = await generateSkillJson(skillsDir, targetDir, sandboxRoot);

    assertEquals(result.success, true);
    assertEquals(result.generated.length, 1);

    const jsonPath = join(targetDir, "global", "test-skill.json");
    const jsonContent = JSON.parse(Deno.readTextFileSync(jsonPath));

    assertEquals(jsonContent.skill_id, "test-skill");
    assertEquals(jsonContent.name, "Test Skill");
    assertEquals(jsonContent.scope, "global");
    assertEquals(jsonContent.status, "active");
    assertEquals(jsonContent.source, "user");

    const parsed = SkillSchema.safeParse(jsonContent);
    assertEquals(parsed.success, true, "generated JSON must satisfy SkillSchema");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[generate_skill_json] generated JSON carries SKILL.md body as instructions", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "gen-skill-body-" });
  try {
    const skillsDir = createEmptySkillsDir(tempDir);
    createFixtureSkill(skillsDir);
    const targetDir = join(tempDir, "target", "Memory", "Skills");
    const sandboxRoot = join(tempDir, "target");

    const result = await generateSkillJson(skillsDir, targetDir, sandboxRoot);
    assertEquals(result.success, true);

    const jsonPath = join(targetDir, "global", "test-skill.json");
    const jsonContent = JSON.parse(Deno.readTextFileSync(jsonPath));

    assertExists(jsonContent.instructions);
    assertEquals(typeof jsonContent.instructions, "string");
    assert(jsonContent.instructions.length >= 10, "instructions must be at least 10 chars");
    assertStringIncludes(jsonContent.instructions, "body of the skill");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[generate_skill_json] re-run preserves id, created_at, usage_count", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "gen-skill-rerun-" });
  try {
    const skillsDir = createEmptySkillsDir(tempDir);
    createFixtureSkill(skillsDir);
    const targetDir = join(tempDir, "target", "Memory", "Skills");
    const sandboxRoot = join(tempDir, "target");

    const result1 = await generateSkillJson(skillsDir, targetDir, sandboxRoot);
    assertEquals(result1.success, true);

    const jsonPath = join(targetDir, "global", "test-skill.json");
    const firstContent = JSON.parse(Deno.readTextFileSync(jsonPath));
    const firstId = firstContent.id;
    const firstCreatedAt = firstContent.created_at;
    const firstUsageCount = firstContent.usage_count;

    const result2 = await generateSkillJson(skillsDir, targetDir, sandboxRoot);
    assertEquals(result2.success, true);

    const secondContent = JSON.parse(Deno.readTextFileSync(jsonPath));
    assertEquals(secondContent.id, firstId, "id must be preserved on re-run");
    assertEquals(secondContent.created_at, firstCreatedAt, "created_at must be preserved on re-run");
    assertEquals(secondContent.usage_count, firstUsageCount, "usage_count must be preserved on re-run");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[generate_skill_json] --check (dry-run) fails on malformed exaix block", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "gen-skill-check-" });
  try {
    const skillsDir = createEmptySkillsDir(tempDir);

    createFixtureSkill(skillsDir, {
      exaix: `
---
exaix:
  skill_id: "bad skill id with spaces"
  triggers:
    keywords: "not-an-array"
---
`,
    });

    const targetDir = join(tempDir, "target", "Memory", "Skills");
    const sandboxRoot = join(tempDir, "target");

    const result = await generateSkillJson(skillsDir, targetDir, sandboxRoot, { check: true });
    assertEquals(result.success, false);
    assertEquals(result.errors.length, 1);
    assertStringIncludes(result.errors[0], "Expected array, received string");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[generate_skill_json] rejects a target outside the sandbox root", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "gen-skill-path-" });
  try {
    const skillsDir = createEmptySkillsDir(tempDir);
    createFixtureSkill(skillsDir);
    const targetDir = join(tempDir, "outside-target", "Memory", "Skills");
    const sandboxRoot = join(tempDir, "sandbox-root");
    Deno.mkdirSync(sandboxRoot, { recursive: true });

    const result = await generateSkillJson(skillsDir, targetDir, sandboxRoot);
    assertEquals(result.success, false);
    assertEquals(result.errors.length, 1);
    assertStringIncludes(result.errors[0], "outside");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[generate_skill_json] deletes index.json after writing so SkillsService rebuilds", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "gen-skill-index-" });
  try {
    const skillsDir = createEmptySkillsDir(tempDir);
    createFixtureSkill(skillsDir);
    const targetDir = join(tempDir, "target", "Memory", "Skills");
    const sandboxRoot = join(tempDir, "target");

    await ensureDir(join(targetDir, "global"));
    Deno.writeTextFileSync(join(targetDir, "global", "index.json"), JSON.stringify({ stale: true }));

    const result = await generateSkillJson(skillsDir, targetDir, sandboxRoot);
    assertEquals(result.success, true);

    const indexPath = join(targetDir, "global", "index.json");
    let indexExists = true;
    try {
      await Deno.stat(indexPath);
    } catch {
      indexExists = false;
    }
    assertEquals(indexExists, false, "index.json must be deleted after generation");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[generate_skill_json] skips skills without an exaix block", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "gen-skill-skip-" });
  try {
    const skillsDir = createEmptySkillsDir(tempDir);
    const noExaixDir = join(skillsDir, "no-exaix-skill");
    Deno.mkdirSync(noExaixDir, { recursive: true });
    Deno.writeTextFileSync(
      join(noExaixDir, "SKILL.md"),
      `---
name: No Exaix Skill
agent: general
scope: dev
title: "No Exaix"
description: A skill without exaix block
version: "1.0"
topics: []
qwen_skill: no-exaix
---

Just a body without an exaix block.
`,
    );

    const targetDir = join(tempDir, "target", "Memory", "Skills");
    const sandboxRoot = join(tempDir, "target");

    const result = await generateSkillJson(skillsDir, targetDir, sandboxRoot);
    assertEquals(result.success, true);
    assertEquals(result.generated.length, 0, "no exaix block means no JSON generated");
    assertEquals(result.warnings.length, 1);
    assertStringIncludes(result.warnings[0], "no-exaix-skill");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
