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
import { stripExamplesSection } from "@exaix/core/func";

/** The render mode whose contribution a finding measures. Full mode is the default
 *  renderer output (instructions carry the complete body, including any Examples
 *  section); trimmed mode is the same body with its Examples section removed. */
export type ISkillSizeMode = "full" | "trimmed";

/** A skill whose rendered contribution (in the measured mode) exceeds the size threshold. */
export interface ISkillSizeFinding {
  /** Repo-relative path of the skill's generated JSON. */
  file: string;
  skillId: string;
  /** Render mode whose contribution the finding measures. */
  mode: ISkillSizeMode;
  /** Rendered contribution length (in chars) in the measured mode. */
  length: number;
  /** Rendered contribution length (in chars) in the opposite mode. */
  otherModeLength: number;
  thresholdChars: number;
}

/** Walks `root` for skill JSONs whose rendered contribution (in the measured mode) exceeds
 *  the threshold; `"full"` measures the complete body incl. Examples, `"trimmed"` the
 *  Examples-stripped rendering. */
export async function scanSkillSizes(
  root: string,
  thresholdChars: number = DEFAULT_SKILL_SIZE_WARNING_CHARS,
  mode: ISkillSizeMode = "full",
): Promise<ISkillSizeFinding[]> {
  const findings: ISkillSizeFinding[] = [];
  for await (const entry of walk(root, { includeDirs: false, exts: [".json"] })) {
    const parsed = SkillSchema.safeParse(JSON.parse(await Deno.readTextFile(entry.path)));
    if (!parsed.success) continue;
    const instructions = parsed.data.instructions;
    const trimmedLength = stripExamplesSection(instructions).length;
    const length = mode === "full" ? instructions.length : trimmedLength;
    if (length > thresholdChars) {
      findings.push({
        file: relative(root, entry.path),
        skillId: parsed.data.skill_id,
        mode,
        length,
        otherModeLength: mode === "full" ? trimmedLength : instructions.length,
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
      `⚠️  ${findings.length} skill(s) exceed the ${DEFAULT_SKILL_SIZE_WARNING_CHARS}-char advisory threshold (measured in ${
        findings[0].mode
      } render mode):`,
    );
    for (const f of findings) {
      console.log(
        `  ${f.file} (${f.skillId}): ${f.length} chars in ${f.mode} mode (${f.otherModeLength} in the other mode)`,
      );
    }
  } else {
    console.log(
      `✅ No skill exceeds the ${DEFAULT_SKILL_SIZE_WARNING_CHARS}-char advisory threshold (full render mode).`,
    );
  }
  Deno.exit(0);
}
