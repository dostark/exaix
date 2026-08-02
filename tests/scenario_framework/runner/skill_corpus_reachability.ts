/**
 * @module ScenarioFrameworkSkillCorpusReachability
 * @path tests/scenario_framework/runner/skill_corpus_reachability.ts
 * @description Phase 158 Step 4's corpus-reachability computation: a skill is
 * corpus-reachable when it is either in the evaluated identity's default_skills or
 * matched by the real SkillsService.matchSkills engine against at least one corpus
 * task's request text. Pure computation only, matching arm_comparison.ts's pattern —
 * loading the skill catalog, the identity's default_skills, and running the real
 * matcher per corpus task is the caller's concern; this module only aggregates
 * already-computed matches into a reachable set and a non-coverage list.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/skill_corpus_reachability_test.ts, packages/core/src/skills/skills.ts]
 */

/** A skill from the catalog, reduced to what reachability and planning need. */
export interface ISkillCatalogEntry {
  skillId: string;
  /** ISkill.critical (Phase 131 W16's protected-prompt-segment flag), reused here per
   *  Step 4's Actions as "whose value claim is load-bearing". */
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

/**
 * Unions default_skills with every corpus task's matched skill ids to find the
 * corpus-reachable set. Catalog skills reached by neither path are published on the
 * non-coverage list with a reason naming the corpus size, so a reader can tell "no
 * task ever needed this skill" apart from "the corpus doesn't exist yet". A
 * default_skills entry that names a skill outside the catalog (e.g. a stale identity
 * reference) is silently ignored rather than reported, since it is not one of the
 * skills this report is evaluating.
 */
export function computeSkillReachability(
  catalog: ISkillCatalogEntry[],
  defaultSkillIds: string[],
  corpusMatches: ICorpusTaskMatch[],
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
    } else {
      nonCoverage.push({
        skillId: entry.skillId,
        reason:
          `not in the evaluated identity's default_skills and matched by none of the ${corpusMatches.length} corpus tasks`,
      });
    }
  }

  return { reachableSkillIds, nonCoverage };
}
