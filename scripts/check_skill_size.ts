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
 *   capped (`maxSkillsPerRequest`), but per-skill content size is not. Loads the authored skill
 *   folders through the production loader and reports any skill whose rendered `instructions`
 *   exceed `DEFAULT_SKILL_SIZE_WARNING_CHARS`. Advisory only: mirrors `check_blueprint_integrity.ts`'s
 *   "report, don't auto-fix" convention and does not exit 1 on findings.
 * @architectural-layer Script
 * @dependencies [./skill_catalog_loader.ts]
 * @related-files [tests/scripts/check_skill_size_test.ts, packages/core/src/types/constants.ts]
 */

import { DEFAULT_SKILL_SIZE_WARNING_CHARS } from "@exaix/core";
import { stripExamplesSection } from "@exaix/core/func";
import { loadCatalogRoot } from "./skill_catalog_loader.ts";

/** The render mode whose contribution a finding measures. Full mode is the default
 *  renderer output (instructions carry the complete body, including any Examples
 *  section); trimmed mode is the same body with its Examples section removed. */
export type ISkillSizeMode = "full" | "trimmed";

/** A skill whose rendered contribution (in the measured mode) exceeds the size threshold. */
export interface ISkillSizeFinding {
  /** Root-relative path of the skill's SKILL.md. */
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

/** Loads the skill folders under `root` and reports those whose rendered contribution (in the measured mode) exceeds
 *  the threshold; `"full"` measures the complete body incl. Examples, `"trimmed"` the
 *  Examples-stripped rendering. */
export async function scanSkillSizes(
  root: string,
  thresholdChars: number = DEFAULT_SKILL_SIZE_WARNING_CHARS,
  mode: ISkillSizeMode = "full",
): Promise<ISkillSizeFinding[]> {
  const findings: ISkillSizeFinding[] = [];
  for (const { skill } of await loadCatalogRoot(root)) {
    const instructions = skill.instructions;
    const trimmedLength = stripExamplesSection(instructions).length;
    const length = mode === "full" ? instructions.length : trimmedLength;
    if (length > thresholdChars) {
      findings.push({
        file: `${skill.name}/SKILL.md`,
        skillId: skill.skill_id,
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
  const root = Deno.args[0] ?? "Blueprints/Skills";
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
