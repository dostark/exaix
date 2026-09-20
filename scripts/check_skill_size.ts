#!/usr/bin/env -S deno run -A

/**
 * @module CheckSkillSize
 * @path scripts/check_skill_size.ts
 *
 * Usage:
 *   deno task check:skill-size   # the registered form
 *   deno run -A scripts/check_skill_size.ts [root]  # direct; always exits 0 (advisory)
 *
 * @description Skill content-size governance. Skill *count* per request is already
 *   capped (`maxSkillsPerRequest`), but per-skill content size is not — the `priority: 50`
 *   skill-context segment is compactable but never actually compacted at runtime.
 *   Walks the generated runtime skill store (`Memory/Skills/**\/*.json`, not the authored
 *   `Blueprints/Skills/*.skill.md` sources — a skill's rendered `instructions` field is the
 *   content actually injected into a prompt, and generation-time processing can make the
 *   two differ) and reports any skill whose `instructions` length exceeds
 *   `DEFAULT_SKILL_SIZE_WARNING_CHARS`. Advisory only — mirrors `check_blueprint_integrity.ts`'s
 *   "report, don't auto-fix" convention; unlike that script, this one does not exit 1 on
 *   findings, since the plan explicitly scopes this step to reporting, not blocking.
 * @architectural-layer Script
 * @dependencies [@std/fs, @std/path]
 * @related-files [tests/scripts/check_skill_size_test.ts, packages/core/src/types/constants.ts, scripts/build_skills_index.ts]
 */

import { walk } from "@std/fs";
import { relative } from "@std/path";
import { DEFAULT_SKILL_SIZE_WARNING_CHARS } from "@exaix/core";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";

/** A skill whose rendered `instructions` length exceeds the size threshold. */
export interface ISkillSizeFinding {
  /** Repo-relative path of the skill's generated JSON. */
  file: string;
  skillId: string;
  length: number;
  thresholdChars: number;
}

/** Walks `root` for skill JSON files and reports every skill whose `instructions`
 *  length exceeds `thresholdChars` (default: `DEFAULT_SKILL_SIZE_WARNING_CHARS`). */
export async function scanSkillSizes(
  root: string,
  thresholdChars: number = DEFAULT_SKILL_SIZE_WARNING_CHARS,
): Promise<ISkillSizeFinding[]> {
  const findings: ISkillSizeFinding[] = [];
  for await (const entry of walk(root, { includeDirs: false, exts: [".json"] })) {
    const parsed = SkillSchema.safeParse(JSON.parse(await Deno.readTextFile(entry.path)));
    if (!parsed.success) continue;
    const length = parsed.data.instructions.length;
    if (length > thresholdChars) {
      findings.push({
        file: relative(root, entry.path),
        skillId: parsed.data.skill_id,
        length,
        thresholdChars,
      });
    }
  }
  return findings;
}

if (import.meta.main) {
  const root = Deno.args[0] ?? "Memory/Skills";
  const findings = await scanSkillSizes(root);
  if (findings.length > 0) {
    console.log(
      `⚠️  ${findings.length} skill(s) exceed the ${DEFAULT_SKILL_SIZE_WARNING_CHARS}-char advisory threshold:`,
    );
    for (const f of findings) {
      console.log(`  ${f.file} (${f.skillId}): ${f.length} chars`);
    }
  } else {
    console.log(`✅ No skill exceeds the ${DEFAULT_SKILL_SIZE_WARNING_CHARS}-char advisory threshold.`);
  }
  Deno.exit(0);
}
