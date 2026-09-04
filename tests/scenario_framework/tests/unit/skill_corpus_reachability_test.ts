/**
 * @module ScenarioFrameworkSkillCorpusReachabilityTest
 * @path tests/scenario_framework/tests/unit/skill_corpus_reachability_test.ts
 * @description Tests for Phase 158 Step 4's corpus-reachability computation: a skill is
 * corpus-reachable when it is either in the evaluated agent role's default_skills or is
 * matched by the real SkillsService.matchSkills engine against at least one corpus
 * task's request text. Skills reached by neither path go on the non-coverage list with
 * a reason, per the plan's "Publish the non-coverage list with the reason per skill."
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/skill_corpus_reachability.ts]
 */

import { assertEquals } from "@std/assert";
import { computeSkillReachability } from "../../runner/skill_corpus_reachability.ts";
import type {
  IAgentRoleDefaultSkills,
  ICorpusTaskMatch,
  ISkillCatalogEntry,
} from "../../runner/skill_corpus_reachability.ts";

function catalog(...ids: string[]): ISkillCatalogEntry[] {
  return ids.map((skillId) => ({ skillId, critical: false }));
}

Deno.test("[SkillCorpusReachability] a skill in the agent role's default_skills is reachable", () => {
  const result = computeSkillReachability(catalog("tdd-methodology"), ["tdd-methodology"], []);
  assertEquals(result.reachableSkillIds, ["tdd-methodology"]);
  assertEquals(result.nonCoverage.length, 0);
});

Deno.test("[SkillCorpusReachability] a skill matched by at least one corpus task is reachable", () => {
  const matches: ICorpusTaskMatch[] = [
    { taskId: "task-1", matchedSkillIds: [] },
    { taskId: "task-2", matchedSkillIds: ["fix-bug"] },
  ];
  const result = computeSkillReachability(catalog("fix-bug"), [], matches);
  assertEquals(result.reachableSkillIds, ["fix-bug"]);
});

Deno.test("[SkillCorpusReachability] a skill matched by neither default_skills nor any corpus task is non-coverage, with a reason naming the corpus size", () => {
  const matches: ICorpusTaskMatch[] = [
    { taskId: "task-1", matchedSkillIds: [] },
    { taskId: "task-2", matchedSkillIds: [] },
  ];
  const result = computeSkillReachability(catalog("orphan-skill"), ["tdd-methodology"], matches);
  assertEquals(result.reachableSkillIds, []);
  assertEquals(result.nonCoverage.length, 1);
  assertEquals(result.nonCoverage[0].skillId, "orphan-skill");
  assertEquals(result.nonCoverage[0].reason.includes("2"), true);
});

Deno.test("[SkillCorpusReachability] the reachable set is a union across default_skills and every corpus task, without duplicates", () => {
  const matches: ICorpusTaskMatch[] = [
    { taskId: "task-1", matchedSkillIds: ["fix-bug"] },
    { taskId: "task-2", matchedSkillIds: ["fix-bug", "tdd-methodology"] },
  ];
  const result = computeSkillReachability(catalog("fix-bug", "tdd-methodology"), ["tdd-methodology"], matches);
  assertEquals([...result.reachableSkillIds].sort(), ["fix-bug", "tdd-methodology"]);
});

Deno.test("[SkillCorpusReachability] a default_skills entry not present in the catalog is not reported as reachable or non-coverage", () => {
  // Guards against a stale agent-role reference producing a phantom skill in either list.
  const result = computeSkillReachability(catalog("tdd-methodology"), ["tdd-methodology", "retired-skill"], []);
  assertEquals(result.reachableSkillIds, ["tdd-methodology"]);
  assertEquals(result.nonCoverage.find((entry) => entry.skillId === "retired-skill"), undefined);
});

Deno.test("[SkillCorpusReachability] a non-covered skill still declared in another agent role's default_skills gets an enriched reason naming that agent role", () => {
  const agentRoles: IAgentRoleDefaultSkills[] = [
    { agentRole: "qa-engineer", defaultSkillIds: ["response-contract-qa", "tdd-methodology"] },
  ];
  const result = computeSkillReachability(
    catalog("response-contract-qa"),
    ["response-contract"],
    [],
    agentRoles,
  );
  assertEquals(result.reachableSkillIds, []);
  assertEquals(result.nonCoverage.length, 1);
  assertEquals(result.nonCoverage[0].reason.includes("qa-engineer"), true);
  assertEquals(result.nonCoverage[0].reason.includes("not evidence the skill is unused"), true);
});

Deno.test("[SkillCorpusReachability] a non-covered skill declared by multiple agent roles names all of them", () => {
  const agentRoles: IAgentRoleDefaultSkills[] = [
    { agentRole: "quality-judge", defaultSkillIds: ["response-contract-judge", "verdict-rubric"] },
    { agentRole: "voting-judge", defaultSkillIds: ["response-contract-judge", "verdict-rubric"] },
  ];
  const result = computeSkillReachability(
    catalog("response-contract-judge"),
    ["response-contract"],
    [],
    agentRoles,
  );
  assertEquals(result.nonCoverage[0].reason.includes("quality-judge"), true);
  assertEquals(result.nonCoverage[0].reason.includes("voting-judge"), true);
});

Deno.test("[SkillCorpusReachability] a skill genuinely absent from every agent role's default_skills keeps the original, narrower reason", () => {
  const agentRoles: IAgentRoleDefaultSkills[] = [
    { agentRole: "senior-coder", defaultSkillIds: ["tdd-methodology"] },
  ];
  const result = computeSkillReachability(
    catalog("truly-orphaned-skill"),
    ["response-contract"],
    [],
    agentRoles,
  );
  assertEquals(result.nonCoverage.length, 1);
  assertEquals(
    result.nonCoverage[0].reason,
    "not in the evaluated agent role's default_skills and matched by none of the 0 corpus tasks",
  );
});

Deno.test("[SkillCorpusReachability] omitting the agent-role catalog reproduces the original reason exactly", () => {
  const matches: ICorpusTaskMatch[] = [{ taskId: "task-1", matchedSkillIds: [] }];
  const result = computeSkillReachability(catalog("orphan-skill"), ["tdd-methodology"], matches);
  assertEquals(
    result.nonCoverage[0].reason,
    "not in the evaluated agent role's default_skills and matched by none of the 1 corpus tasks",
  );
});
