/**
 * @module ScenarioFrameworkSkillCorpusReachability
 * @path tests/scenario_framework/runner/skill_corpus_reachability.ts
 * @description Phase 158 Step 4's corpus-reachability computation: a skill is
 * corpus-reachable when it is either in the evaluated agent role's default_skills or
 * matched by the real SkillsService.matchSkills engine against at least one corpus
 * task's request text. Pure computation only, matching arm_comparison.ts's pattern —
 * loading the skill catalog, the agent role's default_skills, and running the real
 * matcher per corpus task is the caller's concern; this module only aggregates
 * already-computed matches into a reachable set and a non-coverage list.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/skill_corpus_reachability_test.ts, packages/core/src/skills/skills.ts]
 */

/** A skill from the catalog, reduced to what reachability and planning need. */
export interface ISkillCatalogEntry {
  skillId: string;
  /** ISkill.critical (protected-prompt-segment flag), reused here to flag "whose value claim is
   *  load-bearing". */
  critical: boolean;
}

/** The skill ids `SkillsService.matchSkills` matched for one corpus task's request text. */
export interface ICorpusTaskMatch {
  taskId: string;
  matchedSkillIds: string[];
}

export interface INonCoverageEntry {
  skillId: string;
  reason: string;
}

export interface ISkillReachabilityResult {
  reachableSkillIds: string[];
  nonCoverage: INonCoverageEntry[];
}

/** One shipped agent role's declared `default_skills`, independent of whether the corpus run
 *  under measurement selected that agent role — lets a non-coverage reason distinguish "absent
 *  from every agent role's defaults" from "outside this run's agent-role coverage". */
export interface IAgentRoleDefaultSkills {
  agentRole: string;
  defaultSkillIds: string[];
}

// Unions default_skills with every corpus match to find the corpus-reachable set; a default_skills
// entry naming a skill outside the catalog is silently ignored rather than reported.
// `allAgentRoleDefaultSkills` distinguishes "not reached by this run" from "unused by the catalog".
export function computeSkillReachability(
  catalog: ISkillCatalogEntry[],
  defaultSkillIds: string[],
  corpusMatches: ICorpusTaskMatch[],
  allAgentRoleDefaultSkills: IAgentRoleDefaultSkills[] = [],
): ISkillReachabilityResult {
  const reached = new Set<string>(defaultSkillIds);
  for (const match of corpusMatches) {
    for (const skillId of match.matchedSkillIds) {
      reached.add(skillId);
    }
  }

  const reachableSkillIds: string[] = [];
  const nonCoverage: INonCoverageEntry[] = [];

  for (const entry of catalog) {
    if (reached.has(entry.skillId)) {
      reachableSkillIds.push(entry.skillId);
      continue;
    }

    const wiredElsewhere = allAgentRoleDefaultSkills.filter((agentRole) =>
      agentRole.defaultSkillIds.includes(entry.skillId)
    );

    nonCoverage.push({
      skillId: entry.skillId,
      reason: wiredElsewhere.length > 0
        ? `not matched by any of the ${corpusMatches.length} corpus tasks and not this run's active ` +
          `agent-role default; still the declared default_skills of ` +
          `${wiredElsewhere.map((agentRole) => `"${agentRole.agentRole}"`).join(", ")} — outside this run's ` +
          `agent-role coverage, not evidence the skill is unused`
        : `not in the evaluated agent role's default_skills and matched by none of the ${corpusMatches.length} corpus tasks`,
    });
  }

  return { reachableSkillIds, nonCoverage };
}
