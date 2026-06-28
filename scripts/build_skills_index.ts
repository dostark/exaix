#!/usr/bin/env -S deno run -A

/**
 * @module BuildSkillsIndex
 * @path scripts/build_skills_index.ts
 * @description Generates the runtime skill store from `Blueprints/Skills/*.skill.md`
 *   (full SkillSchema frontmatter + a markdown body that becomes `instructions`),
 *   routing each to `<target>/<scope>/<skill_id>.json` (GAP-4: project-scoped to
 *   `project/<project>/`). `--check` detects drift without writing. Mirrors
 *   scripts/generate_skill_json.ts (which targets the separate `.copilot/skills`).
 * @architectural-layer Script
 * @dependencies [@std/path, @std/fs, @std/yaml, @exaix/schemas]
 * @related-files [scripts/generate_skill_json.ts, packages/schemas/src/memory_bank.ts, packages/core/src/skills/skills.ts]
 *
 * Usage:
 *   deno run -A scripts/build_skills_index.ts <target-skills-dir> <sandbox-root> [--check]
 *   <target-skills-dir>  Path to the target Memory/Skills directory.
 *   <sandbox-root>       Sandbox root that gates write permissions (path traversal).
 *   --check              Dry-run: validate + detect drift without writing.
 */

import { dirname, join, resolve } from "@std/path";
import { ensureDir } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";
import { type ISkill, SkillSchema } from "@exaix/schemas/memory_bank.ts";
import { MemoryScope } from "@exaix/core/types";

/** Result of a single generator run. */
export interface IBuildSkillsIndexResult {
  success: boolean;
  generated: string[];
  errors: string[];
  warnings: string[];
}

/**
 * Frontmatter parsed from a `.skill.md` file. The keys mirror SkillSchema; values
 * are validated by SkillSchema.parse, so the structural type is intentionally
 * permissive (YAML-sourced). Composed into a concrete ISkill before use.
 */
export interface ISkillMdFrontmatter {
  [key: string]: string | number | boolean | null | ISkillMdFrontmatter | Array<string | ISkillMdFrontmatter>;
}

/** Regeneration-stable fields preserved from an existing generated JSON. */
interface IManagedSkillFields {
  id?: string;
  created_at?: string;
  usage_count?: number;
}

/**
 * Splits a `.skill.md` file into YAML frontmatter and markdown body.
 * The body (trimmed, with its leading H1 retained) becomes `instructions`.
 */
function parseSkillMd(content: string): { frontmatter: ISkillMdFrontmatter; body: string } | null {
  if (!content.startsWith("---\n")) return null;
  const endFmIndex = content.indexOf("\n---\n", 4);
  if (endFmIndex === -1) return null;
  const frontmatterYaml = content.slice(4, endFmIndex);
  const body = content.slice(endFmIndex + 5).trim();
  try {
    const frontmatter = parseYaml(frontmatterYaml) as ISkillMdFrontmatter;
    return { frontmatter, body };
  } catch {
    return null;
  }
}

/**
 * Composes a full SkillSchema object from `.skill.md` frontmatter + body.
 * The frontmatter already carries the SkillSchema fields; `instructions` comes
 * from the markdown body (authored source of truth). `managed` carries
 * regeneration-stable fields (id/created_at/usage_count) preserved from an
 * existing JSON; only its DEFINED values override the frontmatter, so an absent
 * existing file leaves the frontmatter's own id/created_at intact.
 */
function composeSkill(
  frontmatter: ISkillMdFrontmatter,
  body: string,
  managed?: IManagedSkillFields,
): ISkill {
  const overrides: ISkillMdFrontmatter = { instructions: body };
  if (managed?.id !== undefined) overrides.id = managed.id;
  if (managed?.created_at !== undefined) overrides.created_at = managed.created_at;
  if (managed?.usage_count !== undefined) overrides.usage_count = managed.usage_count;
  return SkillSchema.parse({ ...frontmatter, ...overrides });
}

/**
 * Resolves the scope-relative output path for a skill:
 *   global  → <target>/global/<skill_id>.json
 *   project → <target>/project/<project>/<skill_id>.json (GAP-4)
 */
function skillOutputPath(targetDir: string, skill: ISkill): string {
  if (skill.scope === MemoryScope.PROJECT) {
    const project = skill.project ?? "default";
    return join(targetDir, "project", project, `${skill.skill_id}.json`);
  }
  return join(targetDir, String(skill.scope), `${skill.skill_id}.json`);
}

/**
 * Reads an existing generated skill JSON, preserving id/created_at/usage_count
 * so regeneration is stable. Returns null if absent or invalid.
 */
function readExistingSkill(path: string): ISkill | null {
  try {
    const parsed = SkillSchema.safeParse(JSON.parse(Deno.readTextFileSync(path)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Serializes a skill deterministically for write + drift comparison. */
function serializeSkill(skill: ISkill): string {
  return JSON.stringify(skill, null, 2);
}

async function resolveRealPathAncestor(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch {
    const parent = dirname(path);
    if (parent === path || parent === dirname(parent)) {
      throw new Error(`Cannot resolve path: ${path}`);
    }
    return resolveRealPathAncestor(parent);
  }
}

async function validateTargetInsideSandbox(targetDir: string, sandboxRoot: string): Promise<void> {
  const realTarget = await resolveRealPathAncestor(targetDir);
  const realSandbox = await resolveRealPathAncestor(sandboxRoot);
  if (!realTarget.startsWith(realSandbox)) {
    throw new Error(`Target ${realTarget} is outside sandbox root ${realSandbox}`);
  }
}

/**
 * Builds the runtime skill index from `<skillsDir>/*.skill.md` into `<targetDir>`.
 *
 * @param skillsDir   Path to `Blueprints/Skills/`.
 * @param targetDir   Output `Memory/Skills/` directory.
 * @param sandboxRoot Sandbox root for path-traversal validation (writes only).
 * @param options     `check: true` validates + detects drift without writing.
 */
export async function buildSkillsIndex(
  skillsDir: string,
  targetDir: string,
  sandboxRoot: string,
  options?: { check?: boolean },
): Promise<IBuildSkillsIndexResult> {
  const result: IBuildSkillsIndexResult = { success: true, generated: [], errors: [], warnings: [] };

  if (!options?.check) {
    try {
      await validateTargetInsideSandbox(targetDir, sandboxRoot);
    } catch (e) {
      result.success = false;
      result.errors.push(e instanceof Error ? e.message : String(e));
      return result;
    }
  }

  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(skillsDir)].filter((e) => e.isFile && e.name.endsWith(".skill.md"));
  } catch (e) {
    result.success = false;
    result.errors.push(`Cannot read skills dir ${skillsDir}: ${e}`);
    return result;
  }

  for (const entry of entries) {
    const skillPath = join(skillsDir, entry.name);
    const content = Deno.readTextFileSync(skillPath);

    const parsed = parseSkillMd(content);
    if (!parsed) {
      result.errors.push(`Malformed frontmatter in ${entry.name}`);
      result.success = false;
      continue;
    }

    let skill: ISkill;
    try {
      skill = composeSkill(parsed.frontmatter, parsed.body);
    } catch (e) {
      result.errors.push(
        `${entry.name} fails SkillSchema: ${e instanceof Error ? e.message : String(e)}`,
      );
      result.success = false;
      continue;
    }

    const outPath = skillOutputPath(targetDir, skill);

    if (options?.check) {
      // Drift detection: preserve managed fields from the existing JSON the same
      // way a write would, then compare serialized forms.
      const existing = readExistingSkill(outPath);
      const expected = composeSkill(parsed.frontmatter, parsed.body, {
        id: existing?.id,
        created_at: existing?.created_at,
        usage_count: existing?.usage_count,
      });
      const existingContent = existing ? serializeSkill(existing) : null;
      if (existingContent !== serializeSkill(expected)) {
        result.errors.push(
          `Skill ${skill.skill_id} is out of date: generated JSON would differ from ${entry.name} (run without --check)`,
        );
        result.success = false;
      }
      result.generated.push(skill.skill_id);
      continue;
    }

    // Write path: preserve id/created_at/usage_count from any existing JSON.
    const existing = readExistingSkill(outPath);
    const finalSkill = composeSkill(parsed.frontmatter, parsed.body, {
      id: existing?.id,
      created_at: existing?.created_at,
      usage_count: existing?.usage_count,
    });
    const scopeDir = dirname(outPath);
    await ensureDir(scopeDir);
    const tmpPath = `${outPath}.tmp`;
    Deno.writeTextFileSync(tmpPath, serializeSkill(finalSkill));
    Deno.renameSync(tmpPath, outPath);
    result.generated.push(skill.skill_id);
  }

  // Drop stale index files so SkillsService.loadIndex rebuilds them.
  if (!options?.check && result.generated.length > 0) {
    for (const indexPath of [join(targetDir, "index.json"), join(targetDir, "global", "index.json")]) {
      try {
        await Deno.remove(indexPath);
      } catch {
        // ignore if absent
      }
    }
  }

  return result;
}

/** Parsed CLI args; null when fewer than two positionals are supplied. */
export interface IParsedCliArgs {
  targetDir: string;
  sandboxRoot: string;
  check: boolean;
}

export function parseCliArgs(args: string[]): IParsedCliArgs | null {
  const positionals = args.filter((a) => !a.startsWith("--"));
  if (positionals.length < 2) return null;
  return { targetDir: positionals[0], sandboxRoot: positionals[1], check: args.includes("--check") };
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(Deno.args);
  if (parsed === null) {
    console.error("Usage: deno run -A scripts/build_skills_index.ts <target-skills-dir> <sandbox-root> [--check]");
    Deno.exit(1);
  }

  const targetDir = resolve(parsed.targetDir);
  const sandboxRoot = resolve(parsed.sandboxRoot);
  const repoRoot = resolve(join(dirname(new URL(import.meta.url).pathname), ".."));
  const skillsDir = join(repoRoot, "Blueprints", "Skills");

  const result = await buildSkillsIndex(skillsDir, targetDir, sandboxRoot, { check: parsed.check });

  for (const w of result.warnings) console.warn(`WARN: ${w}`);
  for (const e of result.errors) console.error(`ERROR: ${e}`);

  if (result.success) {
    console.log(
      parsed.check
        ? `Check passed: ${result.generated.length} skill(s) in sync.`
        : `Generated ${result.generated.length} skill(s) into ${targetDir}.`,
    );
    Deno.exit(0);
  }
  console.error(`Failed: ${result.errors.length} error(s).`);
  Deno.exit(1);
}

if (import.meta.main) {
  await main();
}
