#!/usr/bin/env -S deno run -A

/**
 * @module CheckBlueprintIntegrity
 * @path scripts/check_blueprint_integrity.ts
 *
 * Usage:
 *   deno run -A scripts/check_blueprint_integrity.ts [blueprints-dir]
 *   [blueprints-dir]  Path to the Blueprints directory (default: ./Blueprints).
 *
 * @description Catalog referential-integrity + anti-bloat gate. Validates four
 *   facets across Blueprints/{Identities,Skills,Flows}, all fail-closed:
 *     1. dangling-identity — every flow `identity:` resolves to an identity file.
 *     2. dangling-skill    — every identity `default_skills` entry resolves to a
 *        `Blueprints/Skills/<id>.skill.md` file.
 *     3. orphan-identity   — every identity is referenced by >=1 flow. System
 *        identities (`default`, or any with a `mock:` model) are exempt: they are
 *        invoked directly (global fallback / CI fixture), not via flows.
 *     4. orphan-skill      — every skill is referenced by >=1 identity's
 *        default_skills.
 * @architectural-layer Script
 * @dependencies [@std/path, @std/yaml]
 * @related-files [scripts/build_skills_index.ts, tests/blueprints/flow_agent_resolution_test.ts]
 */

import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

/** A single integrity violation. */
export interface IIntegrityViolation {
  kind: "dangling-identity" | "dangling-skill" | "orphan-identity" | "orphan-skill";
  detail: string;
}

/** Result of a catalog integrity check. */
export interface IIntegrityResult {
  ok: boolean;
  violations: IIntegrityViolation[];
}

/** Identities exempt from the orphan-identity rule (invoked directly, not via flows). */
const EXEMPT_IDENTITY_IDS: ReadonlySet<string> = new Set(["default"]);

interface IIdentityRecord {
  id: string;
  model: string;
  defaultSkills: string[];
}

function readFrontmatter(filePath: string): { model?: string; default_skills?: string[] } | null {
  const content = Deno.readTextFileSync(filePath);
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  return parseYaml(m[1]) as { model?: string; default_skills?: string[] };
}

/** Load every active identity (top-level `*.md`, excluding README). */
function loadIdentities(identitiesDir: string): IIdentityRecord[] {
  const out: IIdentityRecord[] = [];
  for (const e of Deno.readDirSync(identitiesDir)) {
    if (!e.isFile || !e.name.endsWith(".md") || e.name === "README.md") continue;
    const fm = readFrontmatter(join(identitiesDir, e.name));
    if (!fm) continue;
    out.push({
      id: e.name.replace(/\.md$/, ""),
      model: fm.model ?? "",
      defaultSkills: Array.isArray(fm.default_skills) ? fm.default_skills.map(String) : [],
    });
  }
  return out;
}

/** Skill ids that exist on disk (`<id>.skill.md`). */
function loadSkillIds(skillsDir: string): Set<string> {
  const ids = new Set<string>();
  for (const e of Deno.readDirSync(skillsDir)) {
    if (e.isFile && e.name.endsWith(".skill.md")) ids.add(e.name.replace(/\.skill\.md$/, ""));
  }
  return ids;
}

/**
 * Real identities referenced by ANY flow file (recursively): both runnable
 * `*.flow.yaml` and `*.flow.template.yaml` pattern templates. `{{placeholder}}`
 * agent slots in templates are NOT identity references and are skipped (the
 * `identity:` regex only matches bare identifiers, never `{{…}}`).
 */
function loadFlowIdentityRefs(flowsDir: string): Set<string> {
  const refs = new Set<string>();

  function walk(dir: string): void {
    let entries: Iterable<Deno.DirEntry>;
    try {
      entries = Deno.readDirSync(dir);
    } catch {
      return; // missing directory
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isDirectory) {
        walk(path);
      } else if (e.isFile && (e.name.endsWith(".flow.yaml") || e.name.endsWith(".flow.template.yaml"))) {
        const text = Deno.readTextFileSync(path);
        // Bare identity identifier only; `{{placeholder}}` slots never match.
        for (const m of text.matchAll(/^\s*identity:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/gm)) {
          refs.add(m[1]);
        }
      }
    }
  }

  walk(flowsDir);
  return refs;
}

/** A system identity is invoked directly, not via flows, so it is orphan-exempt. */
function isExemptIdentity(rec: IIdentityRecord): boolean {
  return EXEMPT_IDENTITY_IDS.has(rec.id) || rec.model.startsWith("mock:");
}

/**
 * Run the four-facet integrity check against a Blueprints directory.
 */
export function checkBlueprintIntegrity(blueprintsDir: string): IIntegrityResult {
  const identities = loadIdentities(join(blueprintsDir, "Identities"));
  const skillIds = loadSkillIds(join(blueprintsDir, "Skills"));
  const flowRefs = loadFlowIdentityRefs(join(blueprintsDir, "Flows"));
  const identityIds = new Set(identities.map((i) => i.id));

  const violations: IIntegrityViolation[] = [];

  // 1. dangling-identity: flow → identity must exist.
  for (const ref of flowRefs) {
    if (!identityIds.has(ref)) {
      violations.push({ kind: "dangling-identity", detail: `flow references identity "${ref}" which has no .md file` });
    }
  }

  // 2. dangling-skill: identity default_skills → skill must exist.
  const usedSkills = new Set<string>();
  for (const rec of identities) {
    for (const s of rec.defaultSkills) {
      usedSkills.add(s);
      if (!skillIds.has(s)) {
        violations.push({
          kind: "dangling-skill",
          detail: `identity "${rec.id}" references skill "${s}" which has no .skill.md file`,
        });
      }
    }
  }

  // 3. orphan-identity: every (non-exempt) identity must appear in >=1 flow.
  for (const rec of identities) {
    if (isExemptIdentity(rec)) continue;
    if (!flowRefs.has(rec.id)) {
      violations.push({
        kind: "orphan-identity",
        detail:
          `identity "${rec.id}" is not referenced by any flow (wire it into a Blueprints/Flows/ flow or justify an exemption)`,
      });
    }
  }

  // 4. orphan-skill: every skill must be referenced by >=1 identity.
  for (const id of skillIds) {
    if (!usedSkills.has(id)) {
      violations.push({
        kind: "orphan-skill",
        detail:
          `skill "${id}" is not referenced by any identity's default_skills (attach it to an identity or remove it)`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

if (import.meta.main) {
  const blueprintsDir = Deno.args[0] ?? "./Blueprints";
  const result = checkBlueprintIntegrity(blueprintsDir);
  if (result.ok) {
    console.log("✅ Blueprint catalog integrity: no violations (identities ↔ flows, skills ↔ identities all resolve).");
    Deno.exit(0);
  }
  console.error(`❌ Blueprint catalog integrity: ${result.violations.length} violation(s):`);
  for (const v of result.violations) {
    console.error(`  [${v.kind}] ${v.detail}`);
  }
  Deno.exit(1);
}
