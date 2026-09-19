/**
 * @module ScenarioFrameworkArtefactDecisionCoverageTest
 * @path tests/scenario_framework/tests/unit/artefact_decision_coverage_test.ts
 * @description Tests for Phase 158 Step 7's cross-artefact decision coverage: every
 * catalog artefact (skill, agent role, flow) must carry a recorded decision or a
 * non-coverage reason. Flows carry one extra rule the other two kinds do not: a flow
 * decision cannot be remove/revise/keep unless it is backed by a clean (non-confounded)
 * measurement — the flow-ablation result is confounded by execution strategy
 * (see phase-158-artefact-value-evaluation.md Step 6), so it can only ever back
 * AWAITING_REMEASUREMENT until Phase 159 lands.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/artefact_decision_coverage.ts, tests/scenario_framework/runner/skill_value_decision.ts]
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  ArtefactDecisionStatus,
  ArtefactKind,
  assertArtefactDecisionCoverage,
  type IArtefactDecisionEntry,
  type IArtefactRef,
  loadArtefactDecisions,
} from "../../runner/artefact_decision_coverage.ts";

async function withFixtureFile(content: string, fn: (path: string) => Promise<void>): Promise<void> {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(path, content);
    await fn(path);
  } finally {
    await Deno.remove(path);
  }
}

function catalog(...refs: IArtefactRef[]): IArtefactRef[] {
  return refs;
}

Deno.test("[ArtefactDecisionCoverage] every catalog artefact with a recorded entry passes", () => {
  const cat = catalog(
    { kind: ArtefactKind.SKILL, artefactId: "response-contract" },
    { kind: ArtefactKind.AGENT_ROLE, artefactId: "senior-coder" },
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
      kind: ArtefactKind.AGENT_ROLE,
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
  const cat = catalog({ kind: ArtefactKind.AGENT_ROLE, artefactId: "code-analyst" });
  const entries: IArtefactDecisionEntry[] = [
    { kind: ArtefactKind.AGENT_ROLE, artefactId: "code-analyst", status: ArtefactDecisionStatus.KEEP, rationale: "" },
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

Deno.test("[ArtefactDecisionCoverage] a skill or agent role decision of KEEP needs no cleanMeasurement flag", () => {
  const cat = catalog(
    { kind: ArtefactKind.SKILL, artefactId: "security-first" },
    { kind: ArtefactKind.AGENT_ROLE, artefactId: "test-engineer" },
  );
  const entries: IArtefactDecisionEntry[] = [
    {
      kind: ArtefactKind.SKILL,
      artefactId: "security-first",
      status: ArtefactDecisionStatus.KEEP,
      rationale: "positive effect, free-tier screening",
    },
    {
      kind: ArtefactKind.AGENT_ROLE,
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

// loadArtefactDecisions — JSON fixture loader, so recording/updating a decision is a
// data edit (git-blameable per entry) instead of a TS source edit + full CI gate.

Deno.test("[loadArtefactDecisions] parses a valid JSON fixture into IArtefactDecisionEntry[]", async () => {
  await withFixtureFile(
    JSON.stringify([
      { kind: "skill", artefactId: "response-contract", status: "keep", rationale: "n=3 mean Δ +0.557" },
      {
        kind: "flow",
        artefactId: "feature-development",
        status: "revise",
        rationale: "cost premium, no quality gain",
        cleanMeasurement: true,
      },
    ]),
    async (path) => {
      const entries = await loadArtefactDecisions(path);
      assertEquals(entries.length, 2);
      assertEquals(entries[0], {
        kind: ArtefactKind.SKILL,
        artefactId: "response-contract",
        status: ArtefactDecisionStatus.KEEP,
        rationale: "n=3 mean Δ +0.557",
      });
      assertEquals(entries[1].cleanMeasurement, true);
    },
  );
});

Deno.test("[loadArtefactDecisions] rejects an entry with an invalid status enum value", async () => {
  await withFixtureFile(
    JSON.stringify([{ kind: "skill", artefactId: "x", status: "maybe-keep", rationale: "n/a" }]),
    async (path) => {
      await assertRejects(() => loadArtefactDecisions(path));
    },
  );
});

Deno.test("[loadArtefactDecisions] rejects an entry missing artefactId", async () => {
  await withFixtureFile(
    JSON.stringify([{ kind: "skill", status: "keep", rationale: "n/a" }]),
    async (path) => {
      await assertRejects(() => loadArtefactDecisions(path));
    },
  );
});

Deno.test("[loadArtefactDecisions] rejects malformed JSON", async () => {
  await withFixtureFile("{ not valid json", async (path) => {
    await assertRejects(() => loadArtefactDecisions(path));
  });
});
