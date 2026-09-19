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
 *   `Blueprints/{Agents,Skills,Flows}` catalog and asserts every artefact carries the
 *   decision recorded in `scripts/artefact_decisions.json`. This is an operator-run gate,
 *   matching `check_blueprint_integrity.ts`'s pattern for the same catalog: it is not
 *   wired into CI (a catalog addition should not silently fail a build before someone has
 *   decided what to record for it), but it makes "does every shipped artefact carry a
 *   decision" a checkable fact rather than a claim. Decisions live in the JSON fixture, not
 *   this script, so recording or updating one is a data edit (git-blameable per entry) that
 *   doesn't require passing the full lint/style/arch commit gate a TS source change would.
 * @architectural-layer Script
 * @dependencies [@std/path]
 * @related-files [tests/scenario_framework/runner/artefact_catalog.ts, tests/scenario_framework/runner/artefact_decision_coverage.ts, scripts/check_blueprint_integrity.ts]
 */

import { loadArtefactCatalog } from "../tests/scenario_framework/runner/artefact_catalog.ts";
import {
  ArtefactKind,
  assertArtefactDecisionCoverage,
  loadArtefactDecisions,
} from "../tests/scenario_framework/runner/artefact_decision_coverage.ts";

/** Sibling JSON fixture, resolved against this script's own location so the check works
 *  regardless of the caller's cwd. */
const DECISIONS_FIXTURE_URL = new URL("./artefact_decisions.json", import.meta.url);

if (import.meta.main) {
  const blueprintsDir = Deno.args[0] ?? "./Blueprints";
  const [catalog, decisions] = await Promise.all([
    loadArtefactCatalog(blueprintsDir),
    loadArtefactDecisions(DECISIONS_FIXTURE_URL),
  ]);
  try {
    assertArtefactDecisionCoverage(catalog, decisions);
  } catch (error) {
    console.error(`❌ Artefact decision coverage: ${(error as Error).message}`);
    Deno.exit(1);
  }
  console.log(
    `✅ Artefact decision coverage: all ${catalog.length} catalog artefacts (` +
      `${catalog.filter((r) => r.kind === ArtefactKind.AGENT_ROLE).length} agent roles, ` +
      `${catalog.filter((r) => r.kind === ArtefactKind.SKILL).length} skills, ` +
      `${catalog.filter((r) => r.kind === ArtefactKind.FLOW).length} flows) carry a recorded decision.`,
  );
}
