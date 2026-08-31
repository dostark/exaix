/**
 * @module ScenarioFrameworkArtefactDecisionCoverage
 * @path tests/scenario_framework/runner/artefact_decision_coverage.ts
 * @description Phase 158 Step 7's cross-artefact decision coverage: every catalog
 * artefact (skill, identity, flow) must carry a recorded decision or a non-coverage
 * reason, so no measured or unmeasured artefact is silently left unaddressed. Flows
 * carry one extra rule the other two kinds do not: a flow decision cannot be
 * remove/revise/keep unless `cleanMeasurement` is set, because the only flow-ablation
 * result this phase produced (feature-development, 2026-08-04) is confounded by
 * execution strategy — see phase-158-artefact-value-evaluation.md's Step 6 caveat.
 * A flow can only be AWAITING_REMEASUREMENT until a Phase-159-clean re-run backs a real
 * decision.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/artefact_decision_coverage_test.ts, tests/scenario_framework/runner/skill_value_decision.ts]
 */

export enum ArtefactKind {
  SKILL = "skill",
  IDENTITY = "identity",
  FLOW = "flow",
}

export enum ArtefactDecisionStatus {
  KEEP = "keep",
  REVISE = "revise",
  REMOVE = "remove",
  AWAITING_REMEASUREMENT = "awaiting-remeasurement",
  NON_COVERAGE = "non-coverage",
}

export interface IArtefactRef {
  kind: ArtefactKind;
  artefactId: string;
}

export interface IArtefactDecisionEntry extends IArtefactRef {
  status: ArtefactDecisionStatus;
  rationale: string;
  /** Required to back a FLOW entry whose status is KEEP/REVISE/REMOVE — a flow decision claiming a real verdict must be backed by a measurement not confounded by execution strategy. */
  cleanMeasurement?: boolean;
}

const CATALOG_KEY_SEPARATOR = "::";

function catalogKey(ref: IArtefactRef): string {
  return `${ref.kind}${CATALOG_KEY_SEPARATOR}${ref.artefactId}`;
}

const DECISION_BACKED_STATUSES = new Set<ArtefactDecisionStatus>([
  ArtefactDecisionStatus.KEEP,
  ArtefactDecisionStatus.REVISE,
  ArtefactDecisionStatus.REMOVE,
]);

/** Throws if any catalog artefact lacks a matching decision entry, if an entry's rationale is empty, or if a FLOW entry claims KEEP/REVISE/REMOVE without `cleanMeasurement: true`. */
export function assertArtefactDecisionCoverage(
  catalog: IArtefactRef[],
  entries: IArtefactDecisionEntry[],
): void {
  const entryByKey = new Map(entries.map((entry) => [catalogKey(entry), entry]));

  for (const ref of catalog) {
    const entry = entryByKey.get(catalogKey(ref));
    if (!entry) {
      throw new Error(
        `Artefact "${ref.artefactId}" (${ref.kind}) has no recorded decision or non-coverage reason.`,
      );
    }
    if (entry.rationale.trim().length === 0) {
      throw new Error(`Artefact "${ref.artefactId}" (${ref.kind})'s decision has an empty rationale.`);
    }
    if (
      ref.kind === ArtefactKind.FLOW &&
      DECISION_BACKED_STATUSES.has(entry.status) &&
      entry.cleanMeasurement !== true
    ) {
      throw new Error(
        `Flow "${ref.artefactId}" cannot record a ${entry.status} decision without a clean measurement ` +
          `(not confounded by execution strategy) — record it as ${ArtefactDecisionStatus.AWAITING_REMEASUREMENT} ` +
          `until a Phase 159 re-run backs a real verdict.`,
      );
    }
  }
}
