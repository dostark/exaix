#!/usr/bin/env -S deno run -A
/**
 * @module CheckQwenSkillsSync
 * @path scripts/check_qwen_skills_sync.ts
 * @description Verifies .qwen/settings.json lists every .copilot/skills/ skill
 *   that declares a qwen_skill frontmatter key, and no stale entries exist.
 *
 * Usage:
 *   deno run -A scripts/check_qwen_skills_sync.ts [--fix]
 *
 * Exit code 0 = in sync, 1 = drift found (or write failed).
 */

import { parse as parseYaml } from "@std/yaml";

const SKILLS_DIR = ".copilot/skills";
const QWEN_SETTINGS = ".qwen/settings.json";

function extractFrontmatter(md: string): string | null {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

interface ICheckResult {
  missing: string[]; // in .copilot/skills/ with qwen_skill but not in settings
  stale: string[]; // in settings but no matching .copilot/skills/<name>/
}

function checkSync(): ICheckResult {
  const result: ICheckResult = { missing: [], stale: [] };

  // Read declared qwen skills from .copilot/skills/
  const declared: string[] = [];
  for (const entry of Deno.readDirSync(SKILLS_DIR)) {
    if (!entry.isDirectory) continue;
    const skillMd = `${SKILLS_DIR}/${entry.name}/SKILL.md`;
    try {
      const content = Deno.readTextFileSync(skillMd);
      const fm = extractFrontmatter(content);
      if (!fm) continue;
      const parsed = parseYaml(fm) as { qwen_skill?: string };
      const qwenSkill = parsed?.["qwen_skill"];
      if (qwenSkill && String(qwenSkill).trim()) {
        declared.push(entry.name);
      }
    } catch {
      // SKILL.md not found — skip
    }
  }

  // Read settings.json
  let settings: { skills?: string[] } = {};
  try {
    settings = JSON.parse(Deno.readTextFileSync(QWEN_SETTINGS));
  } catch {
    result.missing = declared;
    return result;
  }

  const registered = (settings.skills ?? []).map((p: string) => {
    const match = p.match(/\.copilot\/skills\/([^/]+)/);
    return match ? match[1] : null;
  }).filter(Boolean) as string[];

  // Missing: declared but not registered
  for (const name of declared) {
    if (!registered.includes(name)) {
      result.missing.push(name);
    }
  }

  // Stale: registered but no longer has a skill directory with qwen_skill
  for (const name of registered) {
    const skillMd = `${SKILLS_DIR}/${name}/SKILL.md`;
    try {
      const content = Deno.readTextFileSync(skillMd);
      const fm = extractFrontmatter(content);
      const parsed = fm ? (parseYaml(fm) as { qwen_skill?: string }) : null;
      if (!parsed?.["qwen_skill"]) {
        result.stale.push(name);
      }
    } catch {
      result.stale.push(name);
    }
  }

  return result;
}

function main() {
  const result = checkSync();
  let exitCode = 0;

  if (result.missing.length > 0) {
    console.error("❌ Skills with qwen_skill frontmatter missing from .qwen/settings.json:");
    for (const name of result.missing.sort()) {
      console.error(`   - ${name}`);
    }
    exitCode = 1;
  }

  if (result.stale.length > 0) {
    console.error("❌ Stale entries in .qwen/settings.json (no matching skill with qwen_skill):");
    for (const name of result.stale.sort()) {
      console.error(`   - ${name}`);
    }
    exitCode = 1;
  }

  if (exitCode === 0) {
    console.log("✅ .qwen/settings.json is in sync with .copilot/skills/ qwen_skill declarations.");
  }

  Deno.exit(exitCode);
}

if (import.meta.main) {
  main();
}
