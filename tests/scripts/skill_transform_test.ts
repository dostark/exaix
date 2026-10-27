/**
 * @module SkillTransformTest
 * @path tests/scripts/skill_transform_test.ts
 * @description The isolated dogfood skill copy keeps the no-cross-store-leak guarantee: copying the
 *   `.copilot/skills` folders into an arm root writes only that root, never the repository's committed
 *   Memory/Skills or Blueprints/Skills, and a folder without a sidecar is still a valid dogfood skill.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, @exaix/core/skills, tests/scenario_framework/runner/ste100_assets.ts]
 * @related-files [tests/scenario_framework/runner/ste100_assets.ts, scripts/dogfood_bootstrap.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { DEFAULT_BLUEPRINTS_PATH, DEFAULT_MEMORY_PATH, DEFAULT_SKILLS_MEMORY_PATH } from "@exaix/shared";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { SkillRootKind } from "@exaix/core";
import { loadCatalogRoot } from "../../scripts/skill_catalog_loader.ts";
import { runIsolatedGenerator } from "../scenario_framework/runner/ste100_assets.ts";
import { withTempDir } from "@exaix/testing";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const COPILOT_SKILLS = join(REPO_ROOT, ".copilot", "skills");
const REPO_MEMORY_SKILLS = pathBuilders.memoryPath(REPO_ROOT, DEFAULT_SKILLS_MEMORY_PATH);
const REPO_BLUEPRINTS_SKILLS = pathBuilders.blueprintsPath(REPO_ROOT, DEFAULT_SKILLS_MEMORY_PATH);

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

Deno.test("[skill_transform] a .copilot skill without a sidecar is a valid dogfood skill with description triggers", async () => {
  await withTempDir(async (tempDir) => {
    const skillDir = join(tempDir, "skills", "plain-skill");
    await ensureDir(skillDir);
    await Deno.writeTextFile(
      join(skillDir, "SKILL.md"),
      `---\nname: plain-skill\ndescription: Plain skill without any sidecar\nscope: dev\n---\n\nA body with no sidecar at all.\n`,
    );
    const loaded = await loadCatalogRoot(join(tempDir, "skills"), SkillRootKind.DOGFOOD);
    assertEquals(loaded.map((entry) => entry.skill.name), ["plain-skill"]);
    assertEquals(loaded[0].skill.triggers_source, "description");
  }, { prefix: "skill-transform-skip-" });
});

Deno.test("[skill_transform] the isolated copy leaves the repo Memory/Skills and Blueprints/Skills byte-unchanged", async () => {
  await withTempDir(async (tempDir) => {
    const memoryBefore = await fingerprintDir(REPO_MEMORY_SKILLS);
    const blueprintsBefore = await fingerprintDir(REPO_BLUEPRINTS_SKILLS);

    const result = await runIsolatedGenerator({
      kind: "dogfood-skills",
      root: tempDir,
      sourceDir: COPILOT_SKILLS,
      targetDir: join(tempDir, "arm"),
    });
    assertEquals(result.errors, []);
    assertEquals(result.generated.length, 28);

    assertEquals(
      await fingerprintDir(REPO_MEMORY_SKILLS),
      memoryBefore,
      `${DEFAULT_MEMORY_PATH}/Skills must be byte-unchanged`,
    );
    assertEquals(
      await fingerprintDir(REPO_BLUEPRINTS_SKILLS),
      blueprintsBefore,
      `${DEFAULT_BLUEPRINTS_PATH}/Skills must be byte-unchanged`,
    );
  }, { prefix: "skill-transform-noleak-" });
});
