#!/usr/bin/env -S deno run -A

/**
 * @module CheckArtefactDecisionCoverage
 * @path scripts/check_artefact_decision_coverage.ts
 *
 * Usage:
 *   deno run -A scripts/check_artefact_decision_coverage.ts [blueprints-dir]
 *   [blueprints-dir]  Path to the Blueprints directory (default: ./Blueprints).
 *
 * @description Phase 158 Step 7's live-catalog wiring: reads the real
 *   `Blueprints/{Agents,Skills,Flows}` catalog and asserts every artefact carries
 *   the decision recorded in `exaix-dev-docs/planning/phase-158-artefact-value-evaluation.md`'s
 *   "Step 7 decisions" table (skills/identities: KEEP; the one flow this
 *   phase measured: AWAITING_REMEASUREMENT, since its only result is confounded by
 *   execution strategy — see that phase's Step 6 caveat and Phase 159). This is an
 *   operator-run gate, matching `check_blueprint_integrity.ts`'s pattern for the same
 *   catalog: it is not wired into CI (a catalog addition should not silently fail a
 *   build before someone has decided what to record for it), but it makes "does every
 *   shipped artefact carry a decision" a checkable fact rather than a claim.
 * @architectural-layer Script
 * @dependencies [@std/path]
 * @related-files [tests/scenario_framework/runner/artefact_catalog.ts, tests/scenario_framework/runner/artefact_decision_coverage.ts, scripts/check_blueprint_integrity.ts]
 */

import { loadArtefactCatalog } from "../tests/scenario_framework/runner/artefact_catalog.ts";
import {
  ArtefactDecisionStatus,
  ArtefactKind,
  assertArtefactDecisionCoverage,
  type IArtefactDecisionEntry,
} from "../tests/scenario_framework/runner/artefact_decision_coverage.ts";

function keep(kind: ArtefactKind, artefactId: string, rationale: string): IArtefactDecisionEntry {
  return { kind, artefactId, status: ArtefactDecisionStatus.KEEP, rationale };
}

function nonCoverage(kind: ArtefactKind, artefactId: string, rationale: string): IArtefactDecisionEntry {
  return { kind, artefactId, status: ArtefactDecisionStatus.NON_COVERAGE, rationale };
}

const NO_MEASURABLE_EFFECT_GO_TIER = "abs(Δ) < 0.01 at n=1 on the Go tier; kept without a positive quality claim";
const NOT_CORPUS_REACHABLE = "not matched by any of the 19 swe_tasks corpus tasks run live";
const NOT_EXERCISED_BY_AN_ARM = "not exercised by an arm this run";

/** Skills the live run measured a real effect for (full or screening trials). */
const SKILL_DECISIONS: IArtefactDecisionEntry[] = [
  keep(ArtefactKind.SKILL, "response-contract", "n=3 mean Δ +0.557, cost-neutral to cost-saving"),
  keep(
    ArtefactKind.SKILL,
    "response-contract-security-analysis",
    "n=3 mean Δ +0.330, the one strong Go-tier effect, matches its critical flag",
  ),
  keep(ArtefactKind.SKILL, "security-first", "n=3 mean Δ +0.288"),
  keep(ArtefactKind.SKILL, "typescript-patterns", "n=3 mean Δ +0.289"),
  keep(ArtefactKind.SKILL, "tdd-methodology", NO_MEASURABLE_EFFECT_GO_TIER),
  keep(ArtefactKind.SKILL, "exaix-conventions", NO_MEASURABLE_EFFECT_GO_TIER),
  keep(ArtefactKind.SKILL, "error-handling", NO_MEASURABLE_EFFECT_GO_TIER),
  keep(ArtefactKind.SKILL, "fix-bug", NO_MEASURABLE_EFFECT_GO_TIER),
  keep(ArtefactKind.SKILL, "code-review", NO_MEASURABLE_EFFECT_GO_TIER),
  keep(ArtefactKind.SKILL, "commit-message", NO_MEASURABLE_EFFECT_GO_TIER),
  keep(ArtefactKind.SKILL, "documentation-driven", "Δ −0.004 at n=1, no measurable effect"),
  nonCoverage(
    ArtefactKind.SKILL,
    "response-contract-code-analysis",
    "no corpus task matches this skill (analysis-domain task needed)",
  ),
  nonCoverage(
    ArtefactKind.SKILL,
    "response-contract-judge",
    "no corpus task matches this skill (judge-domain task needed)",
  ),
  nonCoverage(
    ArtefactKind.SKILL,
    "response-contract-performance",
    "no corpus task matches this skill (performance-domain task needed)",
  ),
  nonCoverage(ArtefactKind.SKILL, "response-contract-qa", "no corpus task matches this skill (QA-domain task needed)"),
  nonCoverage(
    ArtefactKind.SKILL,
    "verdict-rubric",
    "no corpus task matches this skill (verdict-domain task needed)",
  ),
  nonCoverage(ArtefactKind.SKILL, "architecture-review", NOT_CORPUS_REACHABLE),
  nonCoverage(ArtefactKind.SKILL, "blueprint-best-practices", NOT_CORPUS_REACHABLE),
  nonCoverage(ArtefactKind.SKILL, "collaborative-flow", NOT_CORPUS_REACHABLE),
  nonCoverage(ArtefactKind.SKILL, "conversational-dialogue", NOT_CORPUS_REACHABLE),
  nonCoverage(ArtefactKind.SKILL, "gap-analysis", NOT_CORPUS_REACHABLE),
  nonCoverage(ArtefactKind.SKILL, "performance-analysis", NOT_CORPUS_REACHABLE),
  nonCoverage(ArtefactKind.SKILL, "portal-grounding", NOT_CORPUS_REACHABLE),
  nonCoverage(ArtefactKind.SKILL, "reflexive-critique", NOT_CORPUS_REACHABLE),
  nonCoverage(ArtefactKind.SKILL, "requirements-analysis", NOT_CORPUS_REACHABLE),
  nonCoverage(ArtefactKind.SKILL, "research-methodology", NOT_CORPUS_REACHABLE),
  nonCoverage(ArtefactKind.SKILL, "step-execution", NOT_CORPUS_REACHABLE),
];

const IDENTITY_DECISIONS: IArtefactDecisionEntry[] = [
  keep(
    ArtefactKind.IDENTITY,
    "senior-coder",
    "statistically indistinguishable from test-engineer on the measured task (Δ +0.002); no measured harm",
  ),
  keep(ArtefactKind.IDENTITY, "test-engineer", "same identity-swap arm; no measured harm"),
  keep(
    ArtefactKind.IDENTITY,
    "code-analyst",
    "prune arm Δ 0.000 — the Phase 142 Step 17 portal-grounding prune neither helped nor hurt; kept pruned",
  ),
  nonCoverage(ArtefactKind.IDENTITY, "code-reviewer", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.IDENTITY, "dogfood-coder", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.IDENTITY, "dogfood-developer", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.IDENTITY, "performance-engineer", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.IDENTITY, "product-manager", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.IDENTITY, "qa-engineer", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.IDENTITY, "quality-judge", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.IDENTITY, "research-synthesizer", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.IDENTITY, "security-expert", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.IDENTITY, "software-architect", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.IDENTITY, "technical-writer", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.IDENTITY, "voting-judge", NOT_EXERCISED_BY_AN_ARM),
];

const FLOW_DECISIONS: IArtefactDecisionEntry[] = [
  {
    kind: ArtefactKind.FLOW,
    artefactId: "feature-development",
    status: ArtefactDecisionStatus.REVISE,
    rationale:
      "Phase 159 Step 8 clean re-measurement (both arms matched on strategy: cli_delegate, opencode-cli/opencode-go-deepseek-v4-flash, add-feature-endpoint task): quality Δ 0.00 (suite 0.996 both arms, n=1), token Δ +11752 (+430%, 2729→14481 prompt tokens), wall-clock Δ +80959ms (+86%, 94.5s→175.5s) — the flow's 6-step decomposition costs meaningfully more for identical measured quality on this task. Not REMOVE (not broken, no quality regression, decomposition may have unmeasured reviewability value) and not KEEP (a real, non-noise cost premium with no offsetting quality gain deserves an explicit flag, unlike a near-zero Δ at noise level — contrast NO_MEASURABLE_EFFECT_GO_TIER's skills). Revise: reconsider whether all 6 steps need strategy: cli_delegate uniformly (Step 7's audit table already flags analyze-requirements/design-architecture as synthesis-only steps under the general rubric; only Step 8's cross-arm-matching requirement forced them to cli_delegate here) once this flow itself gets remeasured outside a strategy-matching study.",
    cleanMeasurement: true,
  },
  nonCoverage(ArtefactKind.FLOW, "analyze-codebase", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "api-design", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "api-documentation", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "bug-investigation", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "code-review", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "consensus-review", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "documentation", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "dogfood-loop", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "dogfood-meta-workflow", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "migration-planning", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "onboarding-docs", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "pr-review", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "refactoring", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "research-synthesis", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "security-audit", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(ArtefactKind.FLOW, "test-generation", NOT_EXERCISED_BY_AN_ARM),
  nonCoverage(
    ArtefactKind.FLOW,
    "strategy-comparison-cli-delegate",
    "Phase 159 mechanism-proof fixture (Step 6), not a production task flow subject to a value decision",
  ),
  nonCoverage(
    ArtefactKind.FLOW,
    "strategy-comparison-react",
    "Phase 159 mechanism-proof fixture (Step 6), not a production task flow subject to a value decision",
  ),
  nonCoverage(
    ArtefactKind.FLOW,
    "strategy-routing-smoke",
    "Phase 159 mechanism-proof fixture (Step 5), not a production task flow subject to a value decision",
  ),
];

/** The live run's recorded decisions. */
export const ARTEFACT_DECISIONS_2026_08_04: IArtefactDecisionEntry[] = [
  ...SKILL_DECISIONS,
  ...IDENTITY_DECISIONS,
  ...FLOW_DECISIONS,
];

if (import.meta.main) {
  const blueprintsDir = Deno.args[0] ?? "./Blueprints";
  const catalog = await loadArtefactCatalog(blueprintsDir);
  try {
    assertArtefactDecisionCoverage(catalog, ARTEFACT_DECISIONS_2026_08_04);
  } catch (error) {
    console.error(`❌ Artefact decision coverage: ${(error as Error).message}`);
    Deno.exit(1);
  }
  console.log(
    `✅ Artefact decision coverage: all ${catalog.length} catalog artefacts (` +
      `${catalog.filter((r) => r.kind === ArtefactKind.IDENTITY).length} identities, ` +
      `${catalog.filter((r) => r.kind === ArtefactKind.SKILL).length} skills, ` +
      `${catalog.filter((r) => r.kind === ArtefactKind.FLOW).length} flows) carry a recorded decision.`,
  );
}
