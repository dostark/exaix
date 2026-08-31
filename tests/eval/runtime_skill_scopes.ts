/**
 * @module RuntimeSkillScopes
 * @path tests/eval/runtime_skill_scopes.ts
 * @architectural-layer Test
 * @description The scopes `SkillsService` loads the runtime skill catalog from, declared once.
 *
 *   `SkillsService.loadSkills` walks global, core, learned and the project scope
 *   (`packages/core/src/skills/skills.ts`), so any check that asks "does this skill exist at
 *   runtime?" must ask across all four. Two tests in this directory previously answered that
 *   question with two different scope lists — `identity_default_skills_test.ts` read all four
 *   while `skill_seed_runtime_integrity_test.ts` read only `global`, which forced the two
 *   project-scoped skills onto an exclusion list whose stated reason ("no standalone runtime
 *   JSON") was contradicted by the files on disk. One declaration is what stops that recurring.
 * @dependencies []
 * @related-files [tests/eval/skill_seed_runtime_integrity_test.ts, tests/eval/identity_default_skills_test.ts]
 */
import { join } from "@std/path";

// A runtime skill document as it sits on disk. Field-addressable rather than fully typed:
// callers compare a declared set of seed→runtime fields by name, and `SkillSchema` (not this
// type) is what validates the shape.
export interface IRuntimeSkillDocument {
  [field: string]: JsonSkillValue;
}

/** Any value a skill's JSON document may hold. */
export type JsonSkillValue =
  | string
  | number
  | boolean
  | null
  | JsonSkillValue[]
  | { [key: string]: JsonSkillValue };

// Runtime catalog scopes, in the order `SkillsService` reads them. The project scope is
// parameterised by project name upstream; this repository's own catalog ships under `Exaix`,
// which is what the seed skills are generated into.
export const RUNTIME_SKILL_SCOPES: readonly string[] = [
  "global",
  "core",
  "learned",
  join("project", "Exaix"),
] as const;

/** Every runtime skill id present on disk, across every scope. */
export async function readRuntimeSkillIds(memorySkillsDir: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const scope of RUNTIME_SKILL_SCOPES) {
    try {
      for await (const entry of Deno.readDir(join(memorySkillsDir, scope))) {
        if (!entry.isFile || !entry.name.endsWith(".json") || entry.name === "index.json") continue;
        ids.add(entry.name.replace(/\.json$/, ""));
      }
    } catch {
      // A scope directory need not exist — `learned` is empty on a fresh checkout.
    }
  }
  return ids;
}

/** Every runtime skill document on disk, keyed by skill id, across every scope. */
export async function readRuntimeSkills(
  memorySkillsDir: string,
): Promise<Map<string, IRuntimeSkillDocument>> {
  const skills = new Map<string, IRuntimeSkillDocument>();
  for (const scope of RUNTIME_SKILL_SCOPES) {
    try {
      for await (const entry of Deno.readDir(join(memorySkillsDir, scope))) {
        if (!entry.isFile || !entry.name.endsWith(".json") || entry.name === "index.json") continue;
        const raw = await Deno.readTextFile(join(memorySkillsDir, scope, entry.name));
        skills.set(entry.name.replace(/\.json$/, ""), JSON.parse(raw));
      }
    } catch {
      // A scope directory need not exist.
    }
  }
  return skills;
}
