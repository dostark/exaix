#!/usr/bin/env -S deno run -A

/**
 * @module CheckSkills
 * @path scripts/check_skills.ts
 * @description Folder validation of the authored skill catalog. Loads `Blueprints/Skills` and every
 *   `Memory/Skills/project/<portal>` root through the production SkillFolderLoader and fails on any
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
import { CATALOG_CONTEXT, createCatalogLoader } from "./skill_catalog_loader.ts";

/** Outcome of validating the authored skill catalog. */
export interface ISkillCatalogCheck {
  ok: boolean;
  /** Valid skill folders found across all roots, whatever their lifecycle status. */
  skillCount: number;
  errors: string[];
}

const BLUEPRINT_SKILLS = join("Blueprints", "Skills");
const PROJECT_SKILLS = join("Memory", "Skills", "project");
async function projectRoots(repoRoot: string): Promise<IResolvedSkillRoot[]> {
  const base = join(repoRoot, PROJECT_SKILLS);
  const roots: IResolvedSkillRoot[] = [];
  try {
    for await (const entry of Deno.readDir(base)) {
      if (entry.isDirectory) {
        roots.push({ path: join(base, entry.name), kind: SkillRootKind.PROJECT, writable: false, project: entry.name });
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return roots.sort((a, b) => a.path.localeCompare(b.path));
}

function describe(rootLabel: string, diagnostic: ISkillDiagnostic): string {
  return `${rootLabel}/${diagnostic.safe_path}: ${diagnostic.reason}`;
}

/** Validates every authored skill root of a repository. Reports typed reasons, never skill bodies. */
export async function checkSkillCatalog(repoRoot: string): Promise<ISkillCatalogCheck> {
  const errors: string[] = [];
  let skillCount = 0;
  const roots: Array<{ label: string; root: IResolvedSkillRoot }> = [
    {
      label: BLUEPRINT_SKILLS,
      root: { path: join(repoRoot, BLUEPRINT_SKILLS), kind: SkillRootKind.BLUEPRINT, writable: false, project: null },
    },
    ...(await projectRoots(repoRoot)).map((root) => ({ label: join(PROJECT_SKILLS, root.project ?? ""), root })),
  ];
  for (const { label, root } of roots) {
    const loader = createCatalogLoader(root.path, root.kind, root.project);
    skillCount += (await loader.listAll(CATALOG_CONTEXT)).length;
    for (const diagnostic of await loader.diagnostics(CATALOG_CONTEXT)) {
      if (diagnostic.severity === SkillDiagnosticSeverity.ERROR) errors.push(describe(label, diagnostic));
    }
  }
  return { ok: errors.length === 0, skillCount, errors };
}

if (import.meta.main) {
  const repoRoot = Deno.args[0] ?? Deno.cwd();
  const result = await checkSkillCatalog(repoRoot);
  if (!result.ok) {
    console.error(`❌ Skill folder validation failed (${result.errors.length} problem(s)):`);
    for (const error of result.errors) console.error(`  - ${error}`);
    Deno.exit(1);
  }
  console.log(`Check passed: ${result.skillCount} skill folder(s) valid.`);
}
