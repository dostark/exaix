#!/usr/bin/env -S deno run -A
/**
 * @module GeneratePrompt
 * @path scripts/generate_prompt.ts
 * @description Generates thin .prompt.md wrapper files in .copilot/prompts/ for each skill
 * in .copilot/skills/. Each wrapper has the same format as .qwen/skills/ routing
 * wrappers: name + description frontmatter, plus a canonical routing body.
 *
 * Usage:
 *   deno run -A scripts/generate_prompt.ts --all
 *   deno run -A scripts/generate_prompt.ts --skill fix
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

const SKILLS_DIR = ".copilot/skills";
const PROMPTS_DIR = ".copilot/prompts";

interface SkillFrontmatter {
  description?: string;
  title?: string;
}

function parseFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  try {
    return parseYaml(match[1]) as SkillFrontmatter;
  } catch {
    return {};
  }
}

/** Pure wrapper template — exported for tests and reuse. Routing obligations (read the
 *  canonical source before proceeding, follow its constraints, read what it directs)
 *  stay verbatim; the surrounding prose follows Exaix STE Extension v1. */
export function generatePromptContent(skillName: string, description: string): string {
  return `---
name: ${skillName}
description: "${description.replace(/"/g, '\\"')}"
---

# Routing prompt — canonical source

> Auto-generated routing prompt.
> Canonical source: \`.copilot/skills/${skillName}/SKILL.md\`

## Instructions

1. Do not execute from this file.
1. Read the canonical source before proceeding.
1. Read \`.copilot/skills/${skillName}/SKILL.md\` for the full workflow.
1. Follow all instructions and constraints in the canonical source.
1. Read any additional files or blueprints the canonical source directs.
`;
}

async function generateForSkill(skillName: string): Promise<void> {
  const skillPath = join(SKILLS_DIR, skillName, "SKILL.md");
  let content = "";
  try {
    content = await Deno.readTextFile(skillPath);
  } catch {
    console.error(`ERROR: Cannot read ${skillPath}`);
    Deno.exit(1);
  }

  const frontmatter = parseFrontmatter(content);
  const description = frontmatter.description ??
    frontmatter.title ??
    `Routing wrapper for ${skillName} skill.`;

  await ensureDir(PROMPTS_DIR);
  const outputPath = join(PROMPTS_DIR, `${skillName}.prompt.md`);
  const promptContent = generatePromptContent(skillName, String(description));
  await Deno.writeTextFile(outputPath, promptContent);
  console.log(`Generated: ${outputPath}`);
}

async function generateAll(): Promise<void> {
  const skills: string[] = [];
  for await (const entry of Deno.readDir(SKILLS_DIR)) {
    if (entry.isDirectory) {
      skills.push(entry.name);
    }
  }
  skills.sort();
  for (const skill of skills) {
    await generateForSkill(skill);
  }
  console.log(`\nGenerated ${skills.length} prompt wrappers in ${PROMPTS_DIR}/`);
}

if (import.meta.main) {
  // Parse CLI args
  const args = Deno.args;
  const allFlag = args.includes("--all");
  const skillIdx = args.indexOf("--skill");
  const skillArg = skillIdx !== -1 ? args[skillIdx + 1] : undefined;

  if (allFlag) {
    await generateAll();
  } else if (skillArg) {
    await generateForSkill(skillArg);
  } else {
    console.error("Usage:");
    console.error(
      "  deno run --allow-read --allow-write scripts/generate_prompt.ts --all",
    );
    console.error(
      "  deno run --allow-read --allow-write scripts/generate_prompt.ts --skill <name>",
    );
    Deno.exit(1);
  }
}
