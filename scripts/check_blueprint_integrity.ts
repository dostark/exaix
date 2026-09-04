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
 *   facets across Blueprints/{Agents,Skills,Flows}, all fail-closed:
 *     1. dangling-agent-role — every flow `agent_role:` resolves to an agent role file.
 *     2. dangling-skill      — every agent role `default_skills` entry resolves to a
 *        `Blueprints/Skills/<id>.skill.md` file.
 *     3. orphan-agent-role   — every agent role is referenced by >=1 flow. System
 *        agent roles (`default`, `dogfood-developer`, or any with a `mock:` model) are
 *        exempt: they are invoked directly (global fallback / CI fixture / CLI
 *        `--agent-role`), not via flows.
 *     4. orphan-skill        — every skill is referenced by >=1 agent role's
 *        default_skills, trigger-matched, or explicitly programmatic.
 * @architectural-layer Script
 * @dependencies [@std/path, @std/yaml]
 * @related-files [scripts/build_skills_index.ts, tests/blueprints/flow_agent_resolution_test.ts]
 */

import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

/** A single integrity violation. */
export interface IIntegrityViolation {
  kind: "dangling-agent-role" | "dangling-skill" | "orphan-agent-role" | "orphan-skill";
  detail: string;
}

/** Result of a catalog integrity check. */
export interface IIntegrityResult {
  ok: boolean;
  violations: IIntegrityViolation[];
}

/** Skills exempt from the orphan-skill rule (trigger-matched, not in default_skills). */
const TRIGGER_MATCHED_SKILLS: string[] = [
  "fix-bug",
  "portal-grounding",
  "commit-message",
  "gap-analysis",
  "code-review",
  "error-handling",
];

/** Skills loaded directly by background services rather than through agent-role defaults or request matching. */
const PROGRAMMATIC_SKILLS: ReadonlySet<string> = new Set([
  "memory-extraction-content-policy",
]);

/** Agent roles exempt from the orphan-agent-role rule (invoked directly, not via flows). */
const EXEMPT_AGENT_ROLE_IDS: ReadonlySet<string> = new Set(["default", "dogfood-developer"]);

interface IAgentRoleRecord {
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

/** Load every active agent role (top-level `*.md`, excluding README). */
function loadAgentRoles(agentRolesDir: string): IAgentRoleRecord[] {
  const out: IAgentRoleRecord[] = [];
  for (const e of Deno.readDirSync(agentRolesDir)) {
    if (!e.isFile || !e.name.endsWith(".md") || e.name === "README.md") continue;
    const fm = readFrontmatter(join(agentRolesDir, e.name));
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

/** Real agent roles referenced by any flow file (recursively, `*.flow.yaml` and
 * `*.flow.template.yaml`); `{{placeholder}}` agent slots are skipped. */
function loadFlowAgentRoleRefs(flowsDir: string): Set<string> {
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
        // Bare agent-role identifier only; `{{placeholder}}` slots never match.
        for (const m of text.matchAll(/^\s*agent_role:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/gm)) {
          refs.add(m[1]);
        }
      }
    }
  }

  walk(flowsDir);
  return refs;
}

/** A system agent role is invoked directly, not via flows, so it is orphan-exempt. */
function isExemptAgentRole(rec: IAgentRoleRecord): boolean {
  return EXEMPT_AGENT_ROLE_IDS.has(rec.id) || rec.model.startsWith("mock:");
}

/**
 * Run the four-facet integrity check against a Blueprints directory.
 */
export function checkBlueprintIntegrity(blueprintsDir: string): IIntegrityResult {
  const agentRoleRecords = loadAgentRoles(join(blueprintsDir, "Agents"));
  const skillIds = loadSkillIds(join(blueprintsDir, "Skills"));
  const flowRefs = loadFlowAgentRoleRefs(join(blueprintsDir, "Flows"));
  const agentRoles = new Set(agentRoleRecords.map((i) => i.id));

  const violations: IIntegrityViolation[] = [];

  // 1. dangling-agent-role: flow → agent role must exist.
  for (const ref of flowRefs) {
    if (!agentRoles.has(ref)) {
      violations.push({
        kind: "dangling-agent-role",
        detail: `flow references agent role "${ref}" which has no .md file`,
      });
    }
  }

  // 2. dangling-skill: agent role default_skills → skill must exist.
  const usedSkills = new Set<string>();
  for (const rec of agentRoleRecords) {
    for (const s of rec.defaultSkills) {
      usedSkills.add(s);
      if (!skillIds.has(s)) {
        violations.push({
          kind: "dangling-skill",
          detail: `agent role "${rec.id}" references skill "${s}" which has no .skill.md file`,
        });
      }
    }
  }

  // 3. orphan-agent-role: every (non-exempt) agent role must appear in >=1 flow.
  for (const rec of agentRoleRecords) {
    if (isExemptAgentRole(rec)) continue;
    if (!flowRefs.has(rec.id)) {
      violations.push({
        kind: "orphan-agent-role",
        detail:
          `agent role "${rec.id}" is not referenced by any flow (wire it into a Blueprints/Flows/ flow or justify an exemption)`,
      });
    }
  }

  // 4. orphan-skill: every skill must be agent-role-referenced, trigger-matched, or programmatic.
  for (const id of skillIds) {
    if (TRIGGER_MATCHED_SKILLS.includes(id) || PROGRAMMATIC_SKILLS.has(id)) continue;
    if (!usedSkills.has(id)) {
      violations.push({
        kind: "orphan-skill",
        detail: `skill "${id}" is not referenced by agent-role defaults, trigger matching, or a programmatic consumer`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

if (import.meta.main) {
  const blueprintsDir = Deno.args[0] ?? "./Blueprints";
  const result = checkBlueprintIntegrity(blueprintsDir);
  if (result.ok) {
    console.log(
      "✅ Blueprint catalog integrity: no violations (agent roles ↔ flows, skills ↔ agent roles all resolve).",
    );
    Deno.exit(0);
  }
  console.error(`❌ Blueprint catalog integrity: ${result.violations.length} violation(s):`);
  for (const v of result.violations) {
    console.error(`  [${v.kind}] ${v.detail}`);
  }
  Deno.exit(1);
}
