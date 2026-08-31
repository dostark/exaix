/**
 * @module ScenarioFrameworkArtefactDecisionCoverageTest
 * @path tests/scenario_framework/tests/unit/artefact_decision_coverage_test.ts
 * @description Tests for Phase 158 Step 7's cross-artefact decision coverage: every
 * catalog artefact (skill, identity, flow) must carry a recorded decision or a
 * non-coverage reason. Flows carry one extra rule the other two kinds do not: a flow
 * decision cannot be remove/revise/keep unless it is backed by a clean (non-confounded)
 * measurement — the flow-ablation result is confounded by execution strategy
 * (see phase-158-artefact-value-evaluation.md Step 6), so it can only ever back
 * AWAITING_REMEASUREMENT until Phase 159 lands.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/artefact_decision_coverage.ts, tests/scenario_framework/runner/skill_value_decision.ts]
 */

import { assertThrows } from "@std/assert";
import {
  ArtefactDecisionStatus,
  ArtefactKind,
  assertArtefactDecisionCoverage,
  type IArtefactDecisionEntry,
  type IArtefactRef,
} from "../../runner/artefact_decision_coverage.ts";

function catalog(...refs: IArtefactRef[]): IArtefactRef[] {
  return refs;
}

Deno.test("[ArtefactDecisionCoverage] every catalog artefact with a recorded entry passes", () => {
  const cat = catalog(
    { kind: ArtefactKind.SKILL, artefactId: "response-contract" },
    { kind: ArtefactKind.IDENTITY, artefactId: "senior-coder" },
    { kind: ArtefactKind.FLOW, artefactId: "feature-development" },
  );
  const entries: IArtefactDecisionEntry[] = [
    {
      kind: ArtefactKind.SKILL,
      artefactId: "response-contract",
      status: ArtefactDecisionStatus.KEEP,
      rationale: "positive effect on both measured tasks",
    },
    {
      kind: ArtefactKind.IDENTITY,
      artefactId: "senior-coder",
      status: ArtefactDecisionStatus.KEEP,
      rationale: "statistically indistinguishable from test-engineer, no measured harm",
    },
    {
      kind: ArtefactKind.FLOW,
      artefactId: "feature-development",
      status: ArtefactDecisionStatus.AWAITING_REMEASUREMENT,
      rationale: "2026-08-04 flow-ablation is confounded by execution strategy; pending Phase 159",
    },
  ];
  assertArtefactDecisionCoverage(cat, entries);
});

Deno.test("[ArtefactDecisionCoverage] a catalog artefact with no entry is rejected, naming the artefact", () => {
  const cat = catalog({ kind: ArtefactKind.SKILL, artefactId: "typescript-patterns" });
  assertThrows(
    () => assertArtefactDecisionCoverage(cat, []),
    Error,
    "typescript-patterns",
  );
});

Deno.test("[ArtefactDecisionCoverage] an entry with an empty rationale is rejected", () => {
  const cat = catalog({ kind: ArtefactKind.IDENTITY, artefactId: "code-analyst" });
  const entries: IArtefactDecisionEntry[] = [
    { kind: ArtefactKind.IDENTITY, artefactId: "code-analyst", status: ArtefactDecisionStatus.KEEP, rationale: "" },
  ];
  assertThrows(() => assertArtefactDecisionCoverage(cat, entries), Error, "rationale");
});

Deno.test("[ArtefactDecisionCoverage] a non-coverage entry satisfies coverage", () => {
  const cat = catalog({ kind: ArtefactKind.SKILL, artefactId: "research-methodology" });
  const entries: IArtefactDecisionEntry[] = [
    {
      kind: ArtefactKind.SKILL,
      artefactId: "research-methodology",
      status: ArtefactDecisionStatus.NON_COVERAGE,
      rationale: "no corpus task matches this skill",
    },
  ];
  assertArtefactDecisionCoverage(cat, entries);
});

Deno.test("[ArtefactDecisionCoverage] a flow decision of KEEP without a clean measurement is rejected", () => {
  const cat = catalog({ kind: ArtefactKind.FLOW, artefactId: "feature-development" });
  const entries: IArtefactDecisionEntry[] = [
    {
      kind: ArtefactKind.FLOW,
      artefactId: "feature-development",
      status: ArtefactDecisionStatus.KEEP,
      rationale: "flow orchestration completes end-to-end",
    },
  ];
  assertThrows(
    () => assertArtefactDecisionCoverage(cat, entries),
    Error,
    "clean measurement",
  );
});

Deno.test("[ArtefactDecisionCoverage] a flow decision of KEEP with cleanMeasurement:true is accepted", () => {
  const cat = catalog({ kind: ArtefactKind.FLOW, artefactId: "feature-development" });
  const entries: IArtefactDecisionEntry[] = [
    {
      kind: ArtefactKind.FLOW,
      artefactId: "feature-development",
      status: ArtefactDecisionStatus.KEEP,
      rationale: "re-measured under strategy: cli_delegate, no confound",
      cleanMeasurement: true,
    },
  ];
  assertArtefactDecisionCoverage(cat, entries);
});

Deno.test("[ArtefactDecisionCoverage] a skill or identity decision of KEEP needs no cleanMeasurement flag", () => {
  const cat = catalog(
    { kind: ArtefactKind.SKILL, artefactId: "security-first" },
    { kind: ArtefactKind.IDENTITY, artefactId: "test-engineer" },
  );
  const entries: IArtefactDecisionEntry[] = [
    {
      kind: ArtefactKind.SKILL,
      artefactId: "security-first",
      status: ArtefactDecisionStatus.KEEP,
      rationale: "positive effect, free-tier screening",
    },
    {
      kind: ArtefactKind.IDENTITY,
      artefactId: "test-engineer",
      status: ArtefactDecisionStatus.KEEP,
      rationale: "no measured harm vs senior-coder",
    },
  ];
  assertArtefactDecisionCoverage(cat, entries);
});

Deno.test("[ArtefactDecisionCoverage] an entry for a different artefact id does not satisfy a different catalog entry", () => {
  const cat = catalog({ kind: ArtefactKind.SKILL, artefactId: "fix-bug" });
  const entries: IArtefactDecisionEntry[] = [
    { kind: ArtefactKind.SKILL, artefactId: "code-review", status: ArtefactDecisionStatus.KEEP, rationale: "n/a" },
  ];
  assertThrows(() => assertArtefactDecisionCoverage(cat, entries), Error, "fix-bug");
});

Deno.test("[ArtefactDecisionCoverage] the same artefact id under a different kind is a distinct catalog entry", () => {
  // Guards against collapsing e.g. a skill and a flow that happen to share an id string.
  const cat = catalog(
    { kind: ArtefactKind.SKILL, artefactId: "code-review" },
    { kind: ArtefactKind.FLOW, artefactId: "code-review" },
  );
  const entries: IArtefactDecisionEntry[] = [
    { kind: ArtefactKind.SKILL, artefactId: "code-review", status: ArtefactDecisionStatus.KEEP, rationale: "measured" },
  ];
  assertThrows(() => assertArtefactDecisionCoverage(cat, entries), Error, "code-review");
});
