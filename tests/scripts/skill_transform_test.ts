/**
 * @module SkillTransformTest
 * @path tests/scripts/skill_transform_test.ts
 * @description Phase 125 Step 3 — verifies the .copilot/skills → sandbox
 *   Memory/Skills transform covers the breadth + no-cross-store-leak guarantee:
 *   every dev skill with an exaix: block transforms into a SkillSchema-valid JSON,
 *   a skill without an exaix block is skipped, and — critically — the transform
 *   never mutates the main repo's committed Memory/Skills/ or Blueprints/Skills/
 *   (the security guarantee that Exaix-dev skills cannot leak into a user portal).
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, @std/fs, @std/crypto, @exaix/schemas]
 * @related-files [scripts/generate_skill_json.ts, scripts/dogfood_bootstrap.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";
import { generateSkillJson } from "../../scripts/generate_skill_json.ts";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const COPILOT_SKILLS = join(REPO_ROOT, ".copilot", "skills");
const REPO_MEMORY_SKILLS = join(REPO_ROOT, "Memory", "Skills");
const REPO_BLUEPRINTS_SKILLS = join(REPO_ROOT, "Blueprints", "Skills");

// Produces a stable, order-independent fingerprint of a directory tree: a sorted list of
// "<relative-path>:<byte-length>:<sha-256>" for every file.
async function fingerprintDir(root: string): Promise<string[]> {
  const entries: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    for await (const e of Deno.readDir(dir)) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const abs = join(dir, e.name);
      if (e.isDirectory) {
        await walk(abs, rel);
      } else if (e.isFile) {
        const bytes = await Deno.readFile(abs);
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
        entries.push(`${rel}:${bytes.length}:${hex}`);
      }
    }
  }
  await walk(root, "");
  return entries.sort();
}

Deno.test("[skill_transform] each dev skill with an exaix block transforms into a SkillSchema-valid JSON", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "skill-transform-breadth-" });
  try {
    const targetDir = join(tempDir, "Memory", "Skills");
    const result = await generateSkillJson(COPILOT_SKILLS, targetDir, tempDir);

    assertEquals(result.success, true, `transform failed: ${result.errors.join("; ")}`);
    assert(result.generated.length >= 1, "at least one skill must transform");

    // Every emitted JSON must satisfy the runtime SkillSchema.
    for await (const e of Deno.readDir(join(targetDir, "global"))) {
      if (!e.isFile || !e.name.endsWith(".json")) continue;
      const content = JSON.parse(await Deno.readTextFile(join(targetDir, "global", e.name)));
      const parsed = SkillSchema.safeParse(content);
      assert(parsed.success, `${e.name} must satisfy SkillSchema: ${parsed.success ? "" : parsed.error.message}`);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[skill_transform] a .copilot skill WITHOUT an exaix block is not transformed", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "skill-transform-skip-" });
  try {
    const skillsDir = join(tempDir, "skills");
    const noExaixDir = join(skillsDir, "no-exaix-skill");
    await ensureDir(noExaixDir);
    await Deno.writeTextFile(
      join(noExaixDir, "SKILL.md"),
      `---\nname: No Exaix\nscope: dev\n---\n\nA body with no exaix block at all.\n`,
    );

    const targetDir = join(tempDir, "Memory", "Skills");
    const result = await generateSkillJson(skillsDir, targetDir, tempDir);

    assertEquals(result.success, true);
    assertEquals(result.generated.length, 0, "no exaix block ⇒ no JSON emitted");
    assert(result.warnings.some((w) => w.includes("no-exaix-skill")), "must warn about the skipped skill");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[skill_transform] the transform leaves the repo Memory/Skills byte-unchanged (no cross-store leak)", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "skill-transform-noleak-mem-" });
  try {
    const before = await fingerprintDir(REPO_MEMORY_SKILLS);

    // Run the real transform against a sandbox target — the repo store is NOT the target.
    const targetDir = join(tempDir, "Memory", "Skills");
    const result = await generateSkillJson(COPILOT_SKILLS, targetDir, tempDir);
    assertEquals(result.success, true, `transform failed: ${result.errors.join("; ")}`);

    const after = await fingerprintDir(REPO_MEMORY_SKILLS);
    assertEquals(after, before, "the main repo's Memory/Skills/ must be byte-unchanged by the transform");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[skill_transform] Blueprints/Skills is untouched by the transform", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "skill-transform-noleak-bp-" });
  try {
    const before = await fingerprintDir(REPO_BLUEPRINTS_SKILLS);

    const targetDir = join(tempDir, "Memory", "Skills");
    const result = await generateSkillJson(COPILOT_SKILLS, targetDir, tempDir);
    assertEquals(result.success, true, `transform failed: ${result.errors.join("; ")}`);

    const after = await fingerprintDir(REPO_BLUEPRINTS_SKILLS);
    assertEquals(after, before, "Blueprints/Skills/ (universal seed set) must be untouched by the transform");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
