/**
 * @module ScenarioFrameworkArtefactCatalog
 * @path tests/scenario_framework/runner/artefact_catalog.ts
 * @description Phase 158 Step 7's live-catalog reader: enumerates
 * `Blueprints/{Agents,Skills,Flows}` into the `IArtefactRef[]` shape
 * `assertArtefactDecisionCoverage` consumes. Reuses the exclusions Phase 158 has used
 * throughout its live runs — README files are not artefacts, `mock-agent`/`default`
 * are non-curated agent roles excluded from every count in the phase doc, and a flow's
 * id is read from its declared `id:` field rather than its filename (the two have
 * drifted before — `flow_eval_parity_test.ts` documents the `api_design` vs
 * `api-design` incident this mirrors the fix for).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/artefact_catalog_test.ts, tests/scenario_framework/runner/artefact_decision_coverage.ts, scripts/check_blueprint_integrity.ts]
 */

import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { ArtefactKind, type IArtefactRef } from "./artefact_decision_coverage.ts";

/** Files in `Blueprints/Agents/` that are not curated, measured agent roles. */
const NON_CURATED_AGENT_ROLE_IDS: ReadonlySet<string> = new Set(["mock-agent", "default"]);

async function loadAgentRoleRefs(agentRolesDir: string): Promise<IArtefactRef[]> {
  const refs: IArtefactRef[] = [];
  for await (const entry of Deno.readDir(agentRolesDir)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const artefactId = entry.name.replace(/\.md$/, "");
    if (artefactId === "README" || NON_CURATED_AGENT_ROLE_IDS.has(artefactId)) continue;
    refs.push({ kind: ArtefactKind.AGENT_ROLE, artefactId });
  }
  return refs;
}

async function loadSkillRefs(skillsDir: string): Promise<IArtefactRef[]> {
  const refs: IArtefactRef[] = [];
  for await (const entry of Deno.readDir(skillsDir)) {
    if (!entry.isFile || !entry.name.endsWith(".skill.md")) continue;
    refs.push({ kind: ArtefactKind.SKILL, artefactId: entry.name.replace(/\.skill\.md$/, "") });
  }
  return refs;
}

async function loadFlowRefs(flowsDir: string): Promise<IArtefactRef[]> {
  const refs: IArtefactRef[] = [];
  for await (const entry of Deno.readDir(flowsDir)) {
    if (!entry.isFile || !entry.name.endsWith(".flow.yaml")) continue;
    const parsed = parseYaml(await Deno.readTextFile(join(flowsDir, entry.name))) as { id?: string };
    if (parsed?.id) refs.push({ kind: ArtefactKind.FLOW, artefactId: parsed.id });
  }
  return refs;
}

/** Reads the real `Blueprints/` catalog (agent roles, skills, flows) into the flat `IArtefactRef[]` shape `assertArtefactDecisionCoverage` compares against. `blueprintsDir` is `Blueprints/` itself, not its parent. */
export async function loadArtefactCatalog(blueprintsDir: string): Promise<IArtefactRef[]> {
  const [agentRoles, skills, flows] = await Promise.all([
    loadAgentRoleRefs(join(blueprintsDir, "Agents")),
    loadSkillRefs(join(blueprintsDir, "Skills")),
    loadFlowRefs(join(blueprintsDir, "Flows")),
  ]);
  return [...agentRoles, ...skills, ...flows];
}
