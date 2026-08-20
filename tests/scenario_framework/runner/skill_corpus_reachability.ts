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

/** One shipped identity's declared `default_skills`, independent of whether the corpus
 *  run under measurement ever selected that identity. Supplied so a non-coverage reason
 *  can distinguish "genuinely absent from every identity's defaults" from "outside this
 *  run's identity coverage" — see `computeSkillReachability`'s docstring. */
export interface IIdentityDefaultSkills {
  identityId: string;
  defaultSkillIds: string[];
}

/**
 * Unions default_skills with every corpus task's matched skill ids to find the
 * corpus-reachable set. Catalog skills reached by neither path are published on the
 * non-coverage list with a reason naming the corpus size, so a reader can tell "no
 * task ever needed this skill" apart from "the corpus doesn't exist yet". A
 * default_skills entry that names a skill outside the catalog (e.g. a stale identity
 * reference) is silently ignored rather than reported, since it is not one of the
 * skills this report is evaluating.
 *
 * `allIdentityDefaultSkills` (optional, catalog-wide — every shipped identity, not
 * just the one(s) this run exercised) enriches a non-coverage reason when the skill is
 * still another identity's declared default: "not reached by this run" and "unused by
 * the catalog" are different findings, and GitHub issue #2 conflated them for
 * `response-contract-code-analysis`/`-judge`/`-performance`/`-qa`/`verdict-rubric` —
 * each is the default output contract for a real identity
 * (`code-analyst`/`quality-judge`+`voting-judge`/`performance-engineer`/`qa-engineer`)
 * the 19-task SWE corpus simply never routes to. Omitting this parameter (or passing
 * `[]`) reproduces the original, narrower reason exactly.
 */
export function computeSkillReachability(
  catalog: ISkillCatalogEntry[],
  defaultSkillIds: string[],
  corpusMatches: ICorpusTaskMatch[],
  allIdentityDefaultSkills: IIdentityDefaultSkills[] = [],
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

    const wiredElsewhere = allIdentityDefaultSkills.filter((identity) =>
      identity.defaultSkillIds.includes(entry.skillId)
    );

    nonCoverage.push({
      skillId: entry.skillId,
      reason: wiredElsewhere.length > 0
        ? `not matched by any of the ${corpusMatches.length} corpus tasks and not this run's active ` +
          `identity default; still the declared default_skills of ` +
          `${wiredElsewhere.map((identity) => `"${identity.identityId}"`).join(", ")} — outside this run's ` +
          `identity coverage, not evidence the skill is unused`
        : `not in the evaluated identity's default_skills and matched by none of the ${corpusMatches.length} corpus tasks`,
    });
  }

  return { reachableSkillIds, nonCoverage };
}
