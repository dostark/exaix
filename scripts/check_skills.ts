#!/usr/bin/env -S deno run -A

/**
 * @module CheckSkills
 * @path scripts/check_skills.ts
 * @description Folder validation of the tracked skill catalog. Loads `Blueprints/Skills`, `.copilot/skills` and the
 *   tracked `Memory/Skills/project/Exaix` root through the production SkillFolderLoader and fails on any
 *   invalid, legacy-layout or executable-content entry. Runs behind the retained
 *   `check:skill-index` task. A read-only check: nothing is generated or written.
 * @architectural-layer Script
 * @dependencies [@std/path, @exaix/core, @exaix/core/skills, ./skill_catalog_loader.ts]
 * @related-files [packages/core/src/skills/skill_folder_loader.ts, tests/scripts/check_skills_test.ts]
 *
 * Usage:
 *   deno task check:skill-index
 *   deno run -A scripts/check_skills.ts [repo-root]
 */

import { join } from "@std/path";
import { SkillDiagnosticSeverity, SkillRootKind } from "@exaix/core";
import type { IResolvedSkillRoot, ISkillDiagnostic } from "@exaix/core/skills";
import type { Opt, Reason } from "@exaix/core/types";
import { CATALOG_CONTEXT, createCatalogLoader } from "./skill_catalog_loader.ts";

/** Outcome of validating the authored skill catalog. */
export interface ISkillCatalogCheck {
  ok: boolean;
  /** Valid skill folders found across all roots, whatever their lifecycle status. */
  skillCount: number;
  errors: string[];
}

/** Folder counts a required corpus must have exactly. */
export interface ISkillCorpusCounts {
  /** Blueprint skills plus the tracked project skills. */
  catalog: number;
  dogfood: number;
}

const BLUEPRINT_SKILLS = join("Blueprints", "Skills");
const PROJECT_SKILLS = join("Memory", "Skills", "project");
const TRACKED_PROJECT = "Exaix";
const DOGFOOD_SKILLS = join(".copilot", "skills");
function describe(rootLabel: string, diagnostic: ISkillDiagnostic): string {
  return `${rootLabel}/${diagnostic.safe_path}: ${diagnostic.reason}`;
}

/** The counts the repository's own tracked corpora have today. */
export const REPOSITORY_EXPECTED_COUNTS: ISkillCorpusCounts = { catalog: 27, dogfood: 28 };

/** Validates the tracked authored skill roots. Learned roots, operator portal roots and config are never read. */
export async function checkSkillCatalog(
  repoRoot: string,
  expected: Opt<ISkillCorpusCounts, Reason.OptionalInput> = undefined,
): Promise<ISkillCatalogCheck> {
  const errors: string[] = [];
  const counts = { catalog: 0, dogfood: 0 };
  const roots: Array<{ label: string; group: keyof ISkillCorpusCounts; root: IResolvedSkillRoot }> = [
    {
      label: BLUEPRINT_SKILLS,
      group: "catalog",
      root: { path: join(repoRoot, BLUEPRINT_SKILLS), kind: SkillRootKind.BLUEPRINT, writable: false, project: null },
    },
    {
      label: DOGFOOD_SKILLS,
      group: "dogfood",
      root: { path: join(repoRoot, DOGFOOD_SKILLS), kind: SkillRootKind.DOGFOOD, writable: false, project: null },
    },
    {
      label: join(PROJECT_SKILLS, TRACKED_PROJECT),
      group: "catalog",
      root: {
        path: join(repoRoot, PROJECT_SKILLS, TRACKED_PROJECT),
        kind: SkillRootKind.PROJECT,
        writable: false,
        project: TRACKED_PROJECT,
      },
    },
  ];
  for (const { label, group, root } of roots) {
    const loader = createCatalogLoader(root.path, root.kind, root.project);
    counts[group] += (await loader.listAll(CATALOG_CONTEXT)).length;
    for (const diagnostic of await loader.diagnostics(CATALOG_CONTEXT)) {
      if (diagnostic.severity === SkillDiagnosticSeverity.ERROR) errors.push(describe(label, diagnostic));
    }
  }
  if (expected) {
    if (counts.catalog !== expected.catalog) {
      errors.push(`Blueprint and project skills: expected ${expected.catalog} folders, found ${counts.catalog}`);
    }
    if (counts.dogfood !== expected.dogfood) {
      errors.push(`${DOGFOOD_SKILLS}: expected ${expected.dogfood} folders, found ${counts.dogfood}`);
    }
  }
  return { ok: errors.length === 0, skillCount: counts.catalog + counts.dogfood, errors };
}

if (import.meta.main) {
  const repoRoot = Deno.args[0] ?? Deno.cwd();
  const result = await checkSkillCatalog(repoRoot, REPOSITORY_EXPECTED_COUNTS);
  if (!result.ok) {
    console.error(`❌ Skill folder validation failed (${result.errors.length} problem(s)):`);
    for (const error of result.errors) console.error(`  - ${error}`);
    Deno.exit(1);
  }
  console.log(`Check passed: ${result.skillCount} skill folder(s) valid.`);
}
