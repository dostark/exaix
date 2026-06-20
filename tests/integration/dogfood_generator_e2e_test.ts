/**
 * @module DogfoodGeneratorE2eTest
 * @path tests/integration/dogfood_generator_e2e_test.ts
 * @description Phase 122 Step 5 — full identity → skills → generator E2E test.
 *   Proves the dogfood-coder identity, gap-analysis/step-execution skills,
 *   and plan_to_requests generator work together on a real plan file.
 * @architectural-layer Integration
 * @dependencies [@exaix/schemas, @exaix/core, @std/path]
 * @related-files [scripts/plan_to_requests.ts]
 */

import { assertEquals, assertExists, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { BlueprintLoader } from "@exaix/core/blueprint";
import { RequestSchema } from "@exaix/schemas/request.ts";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const IDENTITIES_PATH = join(REPO_ROOT, "Blueprints", "Identities");
const MEMORY_SKILLS_GLOBAL = join(REPO_ROOT, "Memory", "Skills", "global");
const SCRIPTS_PATH = join(REPO_ROOT, "scripts", "plan_to_requests.ts");
const PHASE_120_PLAN = join(REPO_ROOT, "exaix-dev-docs", "planning", "phase-120-dogfooding-a-c.md");

Deno.test("[dogfood-e2e] dogfood-coder identity loads through BlueprintLoader", async () => {
  const loader = new BlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-coder");

  assertExists(blueprint, "dogfood-coder must load");
  assertEquals(blueprint.identityId, "dogfood-coder");
  const skills = blueprint.frontmatter.default_skills ?? [];
  assertEquals(skills.length, 5, "must have 5 rigor skills");
  assertEquals(skills.includes("tdd-methodology"), true);
});

Deno.test("[dogfood-e2e] gap-analysis and step-execution hydrate via SkillSchema", async () => {
  for (const slug of ["gap-analysis", "step-execution"]) {
    const raw = await Deno.readTextFile(join(MEMORY_SKILLS_GLOBAL, `${slug}.json`));
    const parsed = SkillSchema.parse(JSON.parse(raw));
    assertExists(parsed.instructions.length >= 10);
    assertEquals(parsed.skill_id, slug);
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

    // Verify each generated file has valid frontmatter
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
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
