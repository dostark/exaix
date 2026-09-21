/**
 * @module BuildSkillsIndexTest
 * @path tests/scripts/build_skills_index_test.ts
 * @description Tests for scripts/build_skills_index.ts — the generator that turns
 *   Blueprints/Skills/*.skill.md (full SkillSchema frontmatter + markdown body)
 *   into loadable Memory/Skills/<scope>/<skill_id>.json files. Covers schema
 *   validity, per-skill scope routing (GAP-4: global vs project/<project>/), and
 *   --check no-drift detection.
 * @architectural-layer Script (test)
 * @dependencies [@std/assert, @std/fs, @std/path]
 * @related-files [scripts/build_skills_index.ts, packages/schemas/src/memory_bank.ts]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { ensureDir, walk } from "@std/fs";
import { join, resolve } from "@std/path";
import {
  buildSkillsIndex,
  SKILL_EXAMPLES_HEADING,
  splitInstructionsAndExamples,
  stripExamplesSection,
} from "../../scripts/build_skills_index.ts";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";
import { SkillsService } from "@exaix/core/skills";
import { initTestDbService } from "@exaix/testing";

const FIXTURE_DIR = resolve(new URL("../fixtures/build_skills_index/", import.meta.url).pathname);
const GLOBAL_SKILL = Deno.readTextFileSync(join(FIXTURE_DIR, "test-global-skill.skill.md"));
const PROJECT_SKILL = Deno.readTextFileSync(join(FIXTURE_DIR, "test-project-skill.skill.md"));

async function makeFixture(): Promise<
  { skillsDir: string; targetDir: string; sandboxRoot: string; cleanup: () => void }
> {
  const sandboxRoot = await Deno.makeTempDir({ prefix: "build_skills_idx_" });
  const skillsDir = join(sandboxRoot, "Blueprints", "Skills");
  const targetDir = join(sandboxRoot, "Memory", "Skills");
  await ensureDir(skillsDir);
  Deno.writeTextFileSync(join(skillsDir, "test-global-skill.skill.md"), GLOBAL_SKILL);
  Deno.writeTextFileSync(join(skillsDir, "test-project-skill.skill.md"), PROJECT_SKILL);
  return {
    skillsDir,
    targetDir,
    sandboxRoot,
    cleanup: () => Deno.removeSync(sandboxRoot, { recursive: true }),
  };
}

Deno.test("[build_skills_index] generates one valid SkillSchema JSON per .skill.md", async () => {
  const { skillsDir, targetDir, sandboxRoot, cleanup } = await makeFixture();
  try {
    const result = await buildSkillsIndex(skillsDir, targetDir, sandboxRoot);
    assert(result.success, `expected success, errors: ${result.errors.join("; ")}`);
    assertEquals(result.generated.sort(), ["test-global-skill", "test-project-skill"]);

    const globalJson = JSON.parse(
      Deno.readTextFileSync(join(targetDir, "global", "test-global-skill.json")),
    );
    const parsed = SkillSchema.safeParse(globalJson);
    assert(parsed.success, "generated global JSON must satisfy SkillSchema");
    assertEquals(parsed.data!.instructions.includes("procedural instructions"), true);
  } finally {
    cleanup();
  }
});

Deno.test("[build_skills_index] generated JSON ends with a trailing newline (deno fmt-clean)", async () => {
  const { skillsDir, targetDir, sandboxRoot, cleanup } = await makeFixture();
  try {
    await buildSkillsIndex(skillsDir, targetDir, sandboxRoot);
    const raw = Deno.readTextFileSync(join(targetDir, "global", "test-global-skill.json"));
    assert(
      raw.endsWith("}\n"),
      "generated skill JSON must end with a trailing newline so deno fmt does not report it dirty",
    );
    assertEquals(raw.endsWith("}\n\n"), false, "must have exactly one trailing newline, not two");
  } finally {
    cleanup();
  }
});

// Schema-defined examples field, split from instructions at generation time.

Deno.test("[splitInstructionsAndExamples] a body with a trailing Examples section keeps instructions byte-identical and separates examples", () => {
  const body = "Do the thing.\n\n## Examples\n\nHere is an example.";
  const { instructions, examples } = splitInstructionsAndExamples(body);
  assertEquals(
    instructions,
    body,
    "instructions must be the byte-identical full body (ordering is part of the compatibility contract)",
  );
  assertEquals(examples, "Here is an example.");
});

Deno.test("[splitInstructionsAndExamples] a body with no canonical heading is a lossless no-op", () => {
  const body = "Do the thing.\n\n## API Reference\n\nMore stuff.";
  const { instructions, examples } = splitInstructionsAndExamples(body);
  assertEquals(instructions, body);
  assertEquals(examples, undefined);
});

Deno.test("[splitInstructionsAndExamples] the examples section runs to end-of-document when it is the last heading", () => {
  const body = "Do the thing.\n\n## Examples\n\nHere is an example.\nAnd more.";
  const { instructions, examples } = splitInstructionsAndExamples(body);
  assertEquals(instructions, body, "full body must be preserved verbatim even with a trailing Examples section");
  assertEquals(examples, "Here is an example.\nAnd more.");
});

Deno.test("[splitInstructionsAndExamples] SKILL_EXAMPLES_HEADING is the exported canonical marker", () => {
  assertEquals(SKILL_EXAMPLES_HEADING, "## Examples");
});

Deno.test("[composeSkill via buildSkillsIndex] a skill with a canonical ## Examples heading produces a populated examples field and byte-identical instructions", async () => {
  const sandboxRoot = await Deno.makeTempDir({ prefix: "build_skills_idx_examples_" });
  const skillsDir = join(sandboxRoot, "Blueprints", "Skills");
  const targetDir = join(sandboxRoot, "Memory", "Skills");
  await ensureDir(skillsDir);
  try {
    Deno.writeTextFileSync(
      join(skillsDir, "with-examples.skill.md"),
      `---
id: "22222222-2222-4222-8222-222222222222"
created_at: "2026-01-01T00:00:00.000Z"
skill_id: with-examples
name: With Examples
version: "1.0.0"
description: A skill with an examples section.
triggers: {}
scope: global
source: user
status: active
---
Do the thing carefully.

## Examples

Example one.
`,
    );

    const result = await buildSkillsIndex(skillsDir, targetDir, sandboxRoot);
    assert(result.success, `expected success, errors: ${result.errors.join("; ")}`);

    const generated = JSON.parse(Deno.readTextFileSync(join(targetDir, "global", "with-examples.json")));
    const parsed = SkillSchema.parse(generated);
    assertEquals(
      parsed.instructions,
      "Do the thing carefully.\n\n## Examples\n\nExample one.",
      "instructions must keep the Examples section in its authored position (byte-identical full body)",
    );
    assertEquals(parsed.examples, "Example one.");
  } finally {
    await Deno.remove(sandboxRoot, { recursive: true });
  }
});

Deno.test("[composeSkill via buildSkillsIndex] a skill with no examples heading produces examples: undefined (lossless no-op)", async () => {
  const { skillsDir, targetDir, sandboxRoot, cleanup } = await makeFixture();
  try {
    const result = await buildSkillsIndex(skillsDir, targetDir, sandboxRoot);
    assert(result.success);
    const generated = JSON.parse(Deno.readTextFileSync(join(targetDir, "global", "test-global-skill.json")));
    const parsed = SkillSchema.parse(generated);
    assertEquals(parsed.examples, undefined);
  } finally {
    cleanup();
  }
});

Deno.test("[splitInstructionsAndExamples] a body whose Examples section is followed by more headings keeps the full body byte-identical", () => {
  const body = "Do the thing.\n\n## Examples\n\nHere is an example.\n\n## Later Section\n\nTrailing content survives.";
  const { instructions, examples } = splitInstructionsAndExamples(body);
  assertEquals(instructions, body, "full body must be preserved verbatim regardless of Examples position");
  assertEquals(examples, "Here is an example.");
  assert(
    instructions.includes("## Later Section\n\nTrailing content survives."),
    "content after the Examples section must not be silently dropped",
  );
  assert(
    instructions.includes("## Examples"),
    "the Examples section stays in instructions for full-mode byte-identity",
  );
});

Deno.test("[splitInstructionsAndExamples] regeneration is byte-identical with the Examples section for every real Blueprints/Skills/*.skill.md body", async () => {
  const REPO_ROOT = resolve(new URL("../../", import.meta.url).pathname);
  const skillsDir = join(REPO_ROOT, "Blueprints", "Skills");
  for await (const entry of walk(skillsDir, { includeDirs: false, exts: [".skill.md"] })) {
    const content = Deno.readTextFileSync(entry.path);
    const endFmIndex = content.indexOf("\n---\n", 4);
    const body = content.slice(endFmIndex + 5).trim();
    const { instructions } = splitInstructionsAndExamples(body);
    assertEquals(instructions, body, `instructions must be byte-identical to the authored body for ${entry.path}`);
  }
});

Deno.test("[stripExamplesSection] removes only the Examples section from a middle-section body, keeping surrounding order", () => {
  const body = "Do the thing.\n\n## Examples\n\nExample one.\n\n## Later Section\n\nTrailing content survives.";
  const stripped = stripExamplesSection(body);
  assert(!stripped.includes("Example one."), "examples content must be removed");
  assert(!stripped.includes("## Examples"), "the Examples heading must be removed");
  assert(stripped.includes("Do the thing."), "content before Examples survives");
  assert(
    stripped.includes("## Later Section\n\nTrailing content survives."),
    "content after Examples survives in order",
  );
  assertEquals(
    stripped.indexOf("## Later Section") > stripped.indexOf("Do the thing."),
    true,
    "surrounding sections keep their relative order in trimmed mode",
  );
});

Deno.test("[stripExamplesSection] a trailing Examples section removes only that section", () => {
  const body = "Do the thing.\n\n## Examples\n\nExample one.";
  const stripped = stripExamplesSection(body);
  assertEquals(stripped, "Do the thing.");
});

Deno.test("[stripExamplesSection] a body with no Examples heading is a lossless no-op", () => {
  const body = "Do the thing.\n\n## API Reference\n\nMore stuff.";
  assertEquals(stripExamplesSection(body), body);
});

Deno.test("[build_skills_index] routes scope:project skills under project/<project>/ (GAP-4)", async () => {
  const { skillsDir, targetDir, sandboxRoot, cleanup } = await makeFixture();
  try {
    await buildSkillsIndex(skillsDir, targetDir, sandboxRoot);
    // project-scoped → project/Exaix/, NOT global/
    const projectPath = join(targetDir, "project", "Exaix", "test-project-skill.json");
    assertExists(
      Deno.statSync(projectPath),
      "project-scoped skill must be written under project/<project>/",
    );
    // it must NOT be written to global/
    let inGlobal = true;
    try {
      Deno.statSync(join(targetDir, "global", "test-project-skill.json"));
    } catch {
      inGlobal = false;
    }
    assertEquals(inGlobal, false, "project-scoped skill must not be in global/");
  } finally {
    cleanup();
  }
});

Deno.test("[build_skills_index] --check fails when a generated JSON would drift from source", async () => {
  const { skillsDir, targetDir, sandboxRoot, cleanup } = await makeFixture();
  try {
    // First generate the JSON, then mutate the source so --check detects drift.
    await buildSkillsIndex(skillsDir, targetDir, sandboxRoot);
    const drifted = GLOBAL_SKILL.replace(
      "These are the procedural instructions for the global test skill.",
      "These instructions have changed and now drift from the generated JSON.",
    );
    Deno.writeTextFileSync(join(skillsDir, "test-global-skill.skill.md"), drifted);

    const check = await buildSkillsIndex(skillsDir, targetDir, sandboxRoot, { check: true });
    assertEquals(check.success, false, "--check must fail when source drifts from generated JSON");
    assert(
      check.errors.some((e) => e.includes("test-global-skill")),
      "drift error must name the drifted skill",
    );
  } finally {
    cleanup();
  }
});

Deno.test("[build_skills_index] --check passes when generated JSON matches source", async () => {
  const { skillsDir, targetDir, sandboxRoot, cleanup } = await makeFixture();
  try {
    await buildSkillsIndex(skillsDir, targetDir, sandboxRoot);
    const check = await buildSkillsIndex(skillsDir, targetDir, sandboxRoot, { check: true });
    assert(check.success, `--check must pass when in sync, errors: ${check.errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

/** Count the authored `.skill.md` files on disk — the catalog's source of truth. */
function countSkillSourceFiles(skillsDir: string): number {
  let n = 0;
  for (const e of Deno.readDirSync(skillsDir)) {
    if (e.isFile && e.name.endsWith(".skill.md")) n++;
  }
  return n;
}

Deno.test(
  "[build_skills_index][integration] every Blueprints/Skills source generates and SkillsService loads them all (incl. project-scoped + previously-JSON-only)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const repoRoot = resolve(new URL("../../", import.meta.url).pathname);
    const realSkillsDir = join(repoRoot, "Blueprints", "Skills");
    // Derive the expected count from the filesystem so the test tracks the catalog
    // automatically (mirrors the dynamic `check:skill-index` gate; no magic literal).
    const expectedCount = countSkillSourceFiles(realSkillsDir);
    assert(expectedCount > 0, "expected at least one .skill.md source file");

    const { db, config, cleanup } = await initTestDbService();
    try {
      const memoryDir = join(config.system.root, config.paths.memory);
      const targetDir = join(memoryDir, "Skills");
      const result = await buildSkillsIndex(realSkillsDir, targetDir, config.system.root);
      assert(result.success, `generation failed: ${result.errors.join("; ")}`);
      assertEquals(
        result.generated.length,
        expectedCount,
        `every .skill.md must generate (expected ${expectedCount} from disk, got ${result.generated.length})`,
      );

      const svc = new SkillsService({ memoryDir, portal: "Exaix" }, db);
      const skills = await svc.listSkills();
      const ids = skills.map((s) => s.skill_id).sort();
      assertEquals(
        skills.length,
        expectedCount,
        `SkillsService should load ${expectedCount} skills, got ${skills.length}: ${ids.join(", ")}`,
      );
      // The two previously JSON-only skills still load (now from generated JSON).
      assert(ids.includes("gap-analysis"), "gap-analysis must still load");
      assert(ids.includes("step-execution"), "step-execution must still load");
      // A project-scoped skill loads too.
      assert(ids.includes("portal-grounding"), "project-scoped portal-grounding must load");
    } finally {
      await cleanup();
    }
  },
);
