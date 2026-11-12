#!/usr/bin/env -S deno run -A

/**
 * @module CheckSkills
 * @path scripts/check_skills.ts
 * @description Validates the tracked skill folders through the production loader and compares
 *   each root with the membership lock. `--update` regenerates the lock; the check writes nothing.
 * @architectural-layer Script
 * @dependencies [@std/path, @exaix/core, @exaix/core/skills, ./skill_catalog_loader.ts]
 * @related-files [packages/core/src/skills/skill_folder_loader.ts, scripts/config/skill_catalog.lock.json]
 *
 * Usage:
 *   deno task check:skill-index
 *   deno run -A scripts/check_skills.ts [repo-root]
 *   deno run -A scripts/check_skills.ts [repo-root] --update
 */

import { dirname, join } from "@std/path";
import { SkillDiagnosticSeverity, SkillRootKind } from "@exaix/core";
import type { IResolvedSkillRoot, ISkillDiagnostic } from "@exaix/core/skills";
import type { Opt, Reason } from "@exaix/core/types";
import { CATALOG_CONTEXT, createCatalogLoader } from "./skill_catalog_loader.ts";

/** The reviewed membership contract: every tracked root and its sorted folder names. */
export interface ISkillCatalogLock {
  version: string;
  roots: Record<string, string[]>;
}

/** Folder names found per root, plus any loader errors. */
export interface ISkillCatalogSnapshot {
  roots: Record<string, string[]>;
  errors: string[];
}

/** Outcome of validating the authored skill catalog. */
export interface ISkillCatalogCheck {
  ok: boolean;
  /** Valid skill folders found across all roots, whatever their lifecycle status. */
  skillCount: number;
  errors: string[];
}

/** One tracked corpus root and the folder name each skill must have. */
interface ISkillCatalogRoot {
  label: string;
  kind: SkillRootKind;
  path: readonly string[];
  project: string | null;
}

/** Every tracked root. Order is the lock's key order. */
const ROOTS: readonly ISkillCatalogRoot[] = [
  { label: "Blueprints/Skills", kind: SkillRootKind.BLUEPRINT, path: ["Blueprints", "Skills"], project: null },
  { label: ".copilot/skills", kind: SkillRootKind.DOGFOOD, path: [".copilot", "skills"], project: null },
  {
    label: "Memory/Skills/project/Exaix",
    kind: SkillRootKind.PROJECT,
    path: ["Memory", "Skills", "project", "Exaix"],
    project: "Exaix",
  },
];

/** Repo-relative location of the membership lock. */
const SKILL_CATALOG_LOCK_PATH = join("scripts", "config", "skill_catalog.lock.json");

function describe(rootLabel: string, diagnostic: ISkillDiagnostic): string {
  return `${rootLabel}/${diagnostic.safe_path}: ${diagnostic.reason}`;
}

function resolveRoot(repoRoot: string, root: ISkillCatalogRoot): IResolvedSkillRoot {
  return {
    path: join(repoRoot, ...root.path),
    kind: root.kind,
    writable: false,
    project: root.project,
  };
}

function orderedLabels(extra: Iterable<string>): string[] {
  const labels = ROOTS.map((root) => root.label);
  for (const label of [...extra].sort()) if (!labels.includes(label)) labels.push(label);
  return labels;
}

/** Loads every tracked root and reports the sorted folder names per root. Missing roots give []. */
export async function buildSkillCatalogSnapshot(repoRoot: string): Promise<ISkillCatalogSnapshot> {
  const roots: Record<string, string[]> = {};
  const errors: string[] = [];
  for (const root of ROOTS) {
    const loader = createCatalogLoader(resolveRoot(repoRoot, root).path, root.kind, root.project);
    roots[root.label] = (await loader.listAll(CATALOG_CONTEXT)).map((loaded) => loaded.skill.name).sort();
    for (const diagnostic of await loader.diagnostics(CATALOG_CONTEXT)) {
      if (diagnostic.severity === SkillDiagnosticSeverity.ERROR) errors.push(describe(root.label, diagnostic));
    }
  }
  return { roots, errors };
}

/** Names every added and removed folder. A root missing from either side is its own finding. */
function compareSkillCatalog(
  actual: ISkillCatalogSnapshot["roots"],
  expected: ISkillCatalogLock["roots"],
): string[] {
  const errors: string[] = [];
  for (const label of orderedLabels([...Object.keys(actual), ...Object.keys(expected)])) {
    const found = new Set(actual[label] ?? []);
    const locked = new Set(expected[label] ?? []);
    if (expected[label] === undefined) {
      errors.push(`${label}: no lock entry`);
      continue;
    }
    if (actual[label] === undefined) {
      errors.push(`${label}: root missing`);
      continue;
    }
    const added = [...found].filter((name) => !locked.has(name)).sort();
    const removed = [...locked].filter((name) => !found.has(name)).sort();
    if (added.length > 0) errors.push(`${label}: added ${added.join(", ")}`);
    if (removed.length > 0) errors.push(`${label}: removed ${removed.join(", ")}`);
  }
  return errors;
}

/** Reads the membership lock. A missing or malformed lock is an error naming the update command. */
export async function loadSkillCatalogLock(repoRoot: string): Promise<ISkillCatalogLock> {
  const path = join(repoRoot, SKILL_CATALOG_LOCK_PATH);
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch {
    throw new Error(`${SKILL_CATALOG_LOCK_PATH} is missing. Regenerate it with --update.`);
  }
  let parsed: Partial<ISkillCatalogLock> | undefined;
  try {
    parsed = JSON.parse(raw) as Partial<ISkillCatalogLock>;
  } catch {
    throw new Error(`${SKILL_CATALOG_LOCK_PATH} is malformed. Regenerate it with --update.`);
  }
  if (parsed?.version !== "1" || typeof parsed.roots !== "object" || parsed.roots === null) {
    throw new Error(`${SKILL_CATALOG_LOCK_PATH} is malformed. Regenerate it with --update.`);
  }
  for (const [label, names] of Object.entries(parsed.roots)) {
    if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
      throw new Error(`${SKILL_CATALOG_LOCK_PATH} root "${label}" is not a string array. Regenerate it with --update.`);
    }
    if (names.length !== new Set(names).size) {
      throw new Error(`${SKILL_CATALOG_LOCK_PATH} root "${label}" has duplicate names. Regenerate it with --update.`);
    }
  }
  return { version: "1", roots: parsed.roots as Record<string, string[]> };
}

/** Writes the lock in stable order so a corpus change is a one-line diff. */
export async function writeSkillCatalogLock(repoRoot: string, snapshot: ISkillCatalogSnapshot): Promise<void> {
  const roots: Record<string, string[]> = {};
  for (const label of orderedLabels(Object.keys(snapshot.roots))) {
    roots[label] = [...(snapshot.roots[label] ?? [])].sort();
  }
  const path = join(repoRoot, SKILL_CATALOG_LOCK_PATH);
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, `${JSON.stringify({ version: "1", roots }, null, 2)}\n`);
}

/** Validates the tracked roots and, when a lock is supplied, their membership. */
export async function checkSkillCatalog(
  repoRoot: string,
  expected: Opt<ISkillCatalogLock, Reason.OptionalInput> = undefined,
): Promise<ISkillCatalogCheck> {
  const snapshot = await buildSkillCatalogSnapshot(repoRoot);
  const errors = [...snapshot.errors];
  if (expected) errors.push(...compareSkillCatalog(snapshot.roots, expected.roots));
  const skillCount = Object.values(snapshot.roots).reduce((total, names) => total + names.length, 0);
  return { ok: errors.length === 0, skillCount, errors };
}

if (import.meta.main) {
  const args = Deno.args.filter((arg) => !arg.startsWith("--"));
  const update = Deno.args.includes("--update");
  const repoRoot = args[0] ?? Deno.cwd();
  if (update) {
    const snapshot = await buildSkillCatalogSnapshot(repoRoot);
    if (snapshot.errors.length > 0) {
      console.error(`❌ Refusing to write the lock: ${snapshot.errors.length} invalid folder(s):`);
      for (const error of snapshot.errors) console.error(`  - ${error}`);
      Deno.exit(1);
    }
    await writeSkillCatalogLock(repoRoot, snapshot);
    const total = Object.values(snapshot.roots).reduce((sum, names) => sum + names.length, 0);
    console.log(`Updated ${SKILL_CATALOG_LOCK_PATH}: ${total} folder(s) across ${ROOTS.length} root(s).`);
    Deno.exit(0);
  }
  let lock: ISkillCatalogLock;
  try {
    lock = await loadSkillCatalogLock(repoRoot);
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    Deno.exit(1);
  }
  const result = await checkSkillCatalog(repoRoot, lock);
  if (!result.ok) {
    console.error(`❌ Skill folder validation failed (${result.errors.length} problem(s)):`);
    for (const error of result.errors) console.error(`  - ${error}`);
    Deno.exit(1);
  }
  console.log(`Check passed: ${result.skillCount} skill folder(s) valid.`);
}
