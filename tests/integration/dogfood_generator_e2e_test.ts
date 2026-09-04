/**
 * @module DogfoodGeneratorE2eTest
 * @path tests/integration/dogfood_generator_e2e_test.ts
 * @description Phase 122 Step 5 — full agent role -> skills -> generator E2E test.
 *   Proves the dogfood-developer agent role, gap-analysis/step-execution skills,
 *   and plan_to_requests generator work together on a real plan file.
 *   GAP-12/GAP-13 remediation: uses SkillsService.getSkill for runtime loading
 *   and asserts dogfood metadata line in generated files.
 * @architectural-layer Integration
 * @dependencies [@exaix/schemas, @exaix/core, @std/path]
 * @related-files [scripts/plan_to_requests.ts]
 */

import { assertEquals, assertExists, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import { SkillsService } from "@exaix/core/skills";
import { RequestSchema } from "@exaix/schemas/request.ts";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";
import { initTestDbService } from "@exaix/testing";
import { MemoryScope } from "@exaix/core";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const AGENTS_PATH = join(REPO_ROOT, "Blueprints", "Agents");
const MEMORY_SKILLS_GLOBAL = join(REPO_ROOT, "Memory", "Skills", "global");
const SCRIPTS_PATH = join(REPO_ROOT, "scripts", "plan_to_requests.ts");
const PHASE_120_PLAN = join(REPO_ROOT, "exaix-dev-docs", "planning", "phase-120-dogfooding-a-c.md");

const DOGFOOD_META_RE = /> Dogfood metadata — portal: `([^`]+)`; target_branch: `([^`]+)`/;

Deno.test("[dogfood-e2e] dogfood-developer agent role loads through IBlueprintLoader", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("dogfood-developer");

  assertExists(blueprint, "dogfood-developer must load");
  assertEquals(blueprint.agentRole, "dogfood-developer");
  // This test covers the GENERATOR flow, so it only needs the agent role to load and carry the
  // skill that flow depends on. It used to assert `skills.length === 8`, which broke when the
  // list was legitimately curated and told a reader nothing; skill defaults are `dogfood_agent_role_test.ts`'s concern.
  const skills = blueprint.frontmatter.default_skills ?? [];
  assertEquals(skills.includes("tdd-methodology"), true, "the generator flow assumes TDD guidance is loaded");
});

Deno.test("[dogfood-e2e] gap-analysis and step-execution load through SkillsService.getSkill", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const memoryDir = join(config.system.root, config.paths.memory);
    const skillsDir = join(memoryDir, "Skills");
    const globalDir = join(skillsDir, MemoryScope.GLOBAL);
    await Deno.mkdir(globalDir, { recursive: true });

    for (const slug of ["gap-analysis", "step-execution"]) {
      const src = join(MEMORY_SKILLS_GLOBAL, `${slug}.json`);
      const dst = join(globalDir, `${slug}.json`);
      await Deno.writeTextFile(dst, await Deno.readTextFile(src));
    }

    const service = new SkillsService({ memoryDir }, db);
    await service.initialize();

    for (const slug of ["gap-analysis", "step-execution"]) {
      const skill = await service.getSkill(slug);
      assertExists(skill, `${slug} must hydrate through getSkill`);
      assertEquals(skill.skill_id, slug);
      assertEquals(skill.instructions.length >= 10, true);

      // Secondary SkillSchema validation on the hydrated ISkill object
      const schemaResult = SkillSchema.safeParse(skill);
      assertEquals(schemaResult.success, true, `${slug} hydrated ISkill must match SkillSchema`);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("[dogfood-e2e] plan_to_requests generates valid files from Phase 120 plan", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "dogfood-e2e-" });

  try {
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", SCRIPTS_PATH, PHASE_120_PLAN, "--out-dir", tmpDir],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);

    assertEquals(stderr, "", "no stderr on successful run");
    assertMatch(stdout, /Wrote \d+ request file/);

    // Verify each generated file has valid frontmatter and metadata line
    const entries: string[] = [];
    for await (const entry of Deno.readDir(tmpDir)) {
      if (entry.isFile && entry.name.endsWith(".md")) entries.push(entry.name);
    }

    assertEquals(entries.length > 0, true, "must produce at least one file");

    for (const fileName of entries) {
      const content = await Deno.readTextFile(join(tmpDir, fileName));
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      assertExists(fmMatch, `${fileName} must have frontmatter`);

      const yamlLines = fmMatch[1];
      const parsed: { [key: string]: string | number | boolean | string[] } = {};
      for (const line of yamlLines.split("\n")) {
        const kvMatch = line.match(/^\s*(\w+):\s*(.+)/);
        if (kvMatch) {
          const val = kvMatch[2].trim();
          if (val === "true") parsed[kvMatch[1]] = true;
          else if (/^\d+$/.test(val)) parsed[kvMatch[1]] = parseInt(val, 10);
          else if (val.startsWith('"') && val.endsWith('"')) parsed[kvMatch[1]] = val.slice(1, -1);
          else parsed[kvMatch[1]] = val;
        }
      }

      const result = RequestSchema.safeParse(parsed);
      assertEquals(result.success, true, `${fileName} frontmatter must pass RequestSchema`);
      if (result.success) {
        assertEquals(result.data.status, "pending");
        assertEquals(result.data.priority >= 0 && result.data.priority <= 10, true);
      }

      // Assert dogfood metadata line
      const metaMatch = content.match(DOGFOOD_META_RE);
      assertExists(metaMatch, `${fileName} must have dogfood metadata line`);
      assertEquals(typeof metaMatch[1], "string", `${fileName} portal must be a string`);
      assertEquals(metaMatch[1].length > 0, true, `${fileName} portal must be non-empty`);
      assertEquals(typeof metaMatch[2], "string", `${fileName} target_branch must be a string`);
      assertEquals(metaMatch[2].length > 0, true, `${fileName} target_branch must be non-empty`);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
