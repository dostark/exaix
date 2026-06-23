#!/usr/bin/env -S deno run -A

/**
 * @module GenerateSkillJson
 * @path scripts/generate_skill_json.ts
 * @description Reads each .copilot/skills/<n>/SKILL.md, validates frontmatter +
 *   exaix block via SkillEnvelopeSchema, composes a full runtime SkillSchema
 *   object, and writes atomically to <target-dir>/<scope>/<skill_id>.json.
 *   In --check mode, validates without writing. Deletes index.json after writes
 *   so SkillsService.loadIndex rebuilds it.
 * @architectural-layer Script
 * @dependencies [@std/path, @std/fs, @std/yaml, @exaix/schemas]
 * @related-files [packages/schemas/src/skill_envelope.ts, packages/schemas/src/memory_bank.ts]
 *
 * Usage:
 *   deno run -A scripts/generate_skill_json.ts <target-skills-dir> <sandbox-root> [--check]
 *
 *   <target-skills-dir>  Absolute or relative path to the target Memory/Skills directory.
 *   <sandbox-root>       Absolute path to the sandbox root that gates write permissions.
 *   --check              Dry-run mode: validate envelopes without writing any files.
 *
 * @lint-suppress no-explicit-any (YAML data parsed from SKILL.md is inherently untyped)
 */

import { dirname, join, resolve } from "@std/path";
import { ensureDir } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";
import { type ISkillEnvelope, SkillEnvelopeSchema } from "@exaix/schemas/skill_envelope.ts";
import { type ISkill, SkillSchema } from "@exaix/schemas/memory_bank.ts";
import { MemoryBankSource, MemoryScope, SkillStatus } from "@exaix/core/types";

/**
 * Dynamic data extracted from SKILL.md YAML (frontmatter or exaix block).
 * Field names are validated by SkillEnvelopeSchema at runtime.
 */
export interface ISkillMdData {
  [key: string]: string | number | boolean | ISkillMdData | string[] | ISkillMdData[];
}

/**
 * Result of a single generator run.
 */
export interface IGenerateSkillJsonResult {
  success: boolean;
  generated: string[];
  errors: string[];
  warnings: string[];
}

/**
 * Resolves the real path of a path that may not exist yet by walking up
 * to the nearest existing ancestor.
 */
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

/**
 * Validates that targetDir is inside sandboxRoot by resolving both
 * through real paths (or their nearest existing ancestors).
 */
async function validateTargetInsideSandbox(targetDir: string, sandboxRoot: string): Promise<void> {
  const realTarget = await resolveRealPathAncestor(targetDir);
  const realSandbox = await resolveRealPathAncestor(sandboxRoot);
  if (!realTarget.startsWith(realSandbox)) {
    throw new Error(
      `Target ${realTarget} is outside sandbox root ${realSandbox}`,
    );
  }
}

/**
 * Parses a SKILL.md file and returns frontmatter, body, and exaix block.
 *
 * `exaixError` is set when an `exaix:` fence is present but cannot be parsed
 * (GAP-19): the caller must treat that as a hard error rather than silently
 * skipping the skill. `exaixBlock: null` with no `exaixError` means the skill
 * legitimately has no `exaix:` block (a benign skip).
 */
function parseSkillMd(content: string): {
  frontmatter: ISkillMdData;
  body: string;
  exaixBlock: ISkillMdData | null;
  exaixError: string | null;
} {
  if (!content.startsWith("---\n")) {
    return { frontmatter: {}, body: content.trim(), exaixBlock: null, exaixError: null };
  }

  const endFmIndex = content.indexOf("\n---\n", 4);
  if (endFmIndex === -1) {
    return { frontmatter: {}, body: content.trim(), exaixBlock: null, exaixError: null };
  }

  const frontmatterYaml = content.slice(4, endFmIndex);
  const afterFm = content.slice(endFmIndex + 5);

  let frontmatter: ISkillMdData;
  try {
    frontmatter = parseYaml(frontmatterYaml) as ISkillMdData;
  } catch {
    frontmatter = {};
  }

  const bodyBeforeExaix = afterFm.replace(/\n?---\nexaix:[\s\S]*?\n---\s*$/, "").trim();
  const exaixMatch = afterFm.match(/\n---\nexaix:\n([\s\S]*?)\n---/);

  // Detect a present-but-malformed exaix fence: an `exaix:` marker exists in a
  // trailing block but the strict shape above did not match (GAP-19).
  if (!exaixMatch) {
    const hasExaixMarker = /\n---\s*\nexaix\s*:/.test(afterFm);
    return {
      frontmatter,
      body: afterFm.trim(),
      exaixBlock: null,
      exaixError: hasExaixMarker ? "an exaix: block is present but malformed (unexpected fence/indentation)" : null,
    };
  }

  try {
    const exaixYaml = `exaix:\n${exaixMatch[1]}`;
    const parsed = parseYaml(exaixYaml) as ISkillMdData;
    const exaixBlock = (parsed.exaix as ISkillMdData) ?? null;
    if (exaixBlock === null) {
      return {
        frontmatter,
        body: bodyBeforeExaix,
        exaixBlock: null,
        exaixError: "exaix: block is empty or not a mapping",
      };
    }
    return { frontmatter, body: bodyBeforeExaix, exaixBlock, exaixError: null };
  } catch (e) {
    return {
      frontmatter,
      body: bodyBeforeExaix,
      exaixBlock: null,
      exaixError: `exaix: block YAML parse failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Reads an existing skill JSON if present (for preserving id/created_at/usage_count).
 * Returns a parsed ISkill if the file exists and validates, else null. A present
 * but invalid file is treated as absent (fresh identity will be minted).
 */
function readExistingSkill(path: string): ISkill | null {
  try {
    const parsed = SkillSchema.safeParse(JSON.parse(Deno.readTextFileSync(path)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Composes a full runtime SkillSchema object from envelope + body + managed fields.
 * Preserves id/created_at/usage_count from an existing skill if provided.
 */
function composeSkillSchema(
  envelope: ISkillEnvelope,
  body: string,
  existing?: ISkill | null,
): ISkill {
  return {
    id: existing?.id ?? crypto.randomUUID(),
    created_at: existing?.created_at ?? new Date().toISOString(),
    source: MemoryBankSource.USER,
    scope: MemoryScope.GLOBAL,
    status: SkillStatus.ACTIVE,
    skill_id: envelope.skill_id,
    name: envelope.name,
    version: envelope.version ?? "1.0.0",
    description: envelope.description ?? envelope.name,
    triggers: envelope.triggers ?? {},
    instructions: body,
    constraints: envelope.constraints ?? [],
    output_requirements: envelope.output_requirements ?? [],
    quality_criteria: envelope.quality_criteria ?? [],
    compatible_with: {
      agents: envelope.agent ? [envelope.agent] : ["*"],
    },
    usage_count: existing?.usage_count ?? 0,
  };
}

/**
 * Generates skill JSON files from .copilot/skills/ source SKILL.md files.
 *
 * @param skillsDir - Path to the .copilot/skills/ directory
 * @param targetDir - Output directory (e.g., <sandbox>/Memory/Skills)
 * @param sandboxRoot - Sandbox root for path traversal validation
 * @param options - Optional flags (check = dry-run mode)
 */
export async function generateSkillJson(
  skillsDir: string,
  targetDir: string,
  sandboxRoot: string,
  options?: { check?: boolean },
): Promise<IGenerateSkillJsonResult> {
  const result: IGenerateSkillJsonResult = {
    success: true,
    generated: [],
    errors: [],
    warnings: [],
  };

  if (!options?.check) {
    try {
      await validateTargetInsideSandbox(targetDir, sandboxRoot);
    } catch (e) {
      result.success = false;
      result.errors.push(e instanceof Error ? e.message : String(e));
      return result;
    }
  }

  let skillDirs: string[];
  try {
    skillDirs = [...Deno.readDirSync(skillsDir)]
      .filter((e) => e.isDirectory)
      .map((e) => join(skillsDir, e.name));
  } catch (e) {
    result.success = false;
    result.errors.push(`Cannot read skills dir ${skillsDir}: ${e}`);
    return result;
  }

  for (const skillDir of skillDirs) {
    const skillPath = join(skillDir, "SKILL.md");
    let content: string;
    try {
      content = Deno.readTextFileSync(skillPath);
    } catch {
      result.warnings.push(`No SKILL.md found in ${skillDir}`);
      continue;
    }

    const { frontmatter, body, exaixBlock, exaixError } = parseSkillMd(content);

    if (exaixError) {
      result.errors.push(`Malformed exaix block in ${skillDir}: ${exaixError}`);
      result.success = false;
      continue;
    }

    if (!exaixBlock) {
      result.warnings.push(`No exaix block in ${skillDir}`);
      continue;
    }

    const envelopeInput = { ...frontmatter, ...exaixBlock };
    const envelopeResult = SkillEnvelopeSchema.safeParse(envelopeInput);

    if (!envelopeResult.success) {
      result.errors.push(
        `Invalid envelope in ${skillDir}: ${envelopeResult.error.issues.map((i) => i.message).join("; ")}`,
      );
      result.success = false;
      continue;
    }

    const envelope = envelopeResult.data;
    const skillObject = composeSkillSchema(envelope, body);

    const schemaResult = SkillSchema.safeParse(skillObject);
    if (!schemaResult.success) {
      result.errors.push(
        `Composed skill ${envelope.skill_id} fails SkillSchema validation: ${
          schemaResult.error.issues.map((i) => i.message).join("; ")
        }`,
      );
      result.success = false;
      continue;
    }

    if (options?.check) {
      result.generated.push(envelope.skill_id);
      continue;
    }

    const scopeDir = join(targetDir, "global");
    const jsonPath = join(scopeDir, `${envelope.skill_id}.json`);

    const existing = readExistingSkill(jsonPath);
    const finalObject = composeSkillSchema(envelope, body, existing);
    const finalSchemaResult = SkillSchema.safeParse(finalObject);
    if (!finalSchemaResult.success) {
      result.errors.push(
        `Final skill ${envelope.skill_id} fails SkillSchema: ${
          finalSchemaResult.error.issues.map((i) => i.message).join("; ")
        }`,
      );
      result.success = false;
      continue;
    }

    const jsonContent = JSON.stringify(finalObject, null, 2);

    await ensureDir(scopeDir);

    const tmpPath = join(scopeDir, `${envelope.skill_id}.json.tmp`);
    Deno.writeTextFileSync(tmpPath, jsonContent);
    Deno.renameSync(tmpPath, jsonPath);

    result.generated.push(envelope.skill_id);
  }

  if (!options?.check && result.generated.length > 0) {
    const indexPathsToDelete = [
      join(targetDir, "index.json"),
      join(targetDir, "global", "index.json"),
    ];
    for (const indexPath of indexPathsToDelete) {
      try {
        await Deno.remove(indexPath);
      } catch {
        // ignore if file doesn't exist
      }
    }
  }

  return result;
}

/**
 * Parsed CLI arguments. Returns null when the required positionals are absent.
 */
export interface IParsedCliArgs {
  targetDir: string;
  sandboxRoot: string;
  check: boolean;
}

/**
 * Parses CLI args, requiring exactly two positional arguments
 * (<target-skills-dir> <sandbox-root>) regardless of flag presence.
 * Flags (those starting with "--") are excluded from the positional count, so
 * `<dir> --check` is rejected (one positional) rather than treating "--check"
 * as the sandbox root (GAP-16). Returns null when fewer than two positionals.
 */
export function parseCliArgs(args: string[]): IParsedCliArgs | null {
  const positionals = args.filter((a) => !a.startsWith("--"));
  if (positionals.length < 2) return null;
  return {
    targetDir: positionals[0],
    sandboxRoot: positionals[1],
    check: args.includes("--check"),
  };
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(Deno.args);
  if (parsed === null) {
    console.error("Usage: deno run -A scripts/generate_skill_json.ts <target-skills-dir> <sandbox-root> [--check]");
    Deno.exit(1);
  }

  const targetDir = resolve(parsed.targetDir);
  const sandboxRoot = resolve(parsed.sandboxRoot);
  const check = parsed.check;

  const repoRoot = resolve(join(dirname(new URL(import.meta.url).pathname), ".."));
  const skillsDir = join(repoRoot, ".copilot", "skills");

  const result = await generateSkillJson(skillsDir, targetDir, sandboxRoot, { check });

  for (const w of result.warnings) console.warn(`WARN: ${w}`);
  for (const e of result.errors) console.error(`ERROR: ${e}`);

  if (result.success) {
    if (check) {
      console.log(`Check passed: ${result.generated.length} skill(s) valid.`);
    } else {
      console.log(`Generated ${result.generated.length} skill(s) into ${targetDir}:`);
      for (const id of result.generated) console.log(`  - ${id}`);
    }
    Deno.exit(0);
  } else {
    console.error(`Failed: ${result.errors.length} error(s), ${result.warnings.length} warning(s).`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
