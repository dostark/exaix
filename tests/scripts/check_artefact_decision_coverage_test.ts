/**
 * @module CheckArtefactDecisionCoverageTest
 * @path tests/scripts/check_artefact_decision_coverage_test.ts
 * @description Regression coverage for scripts/check_artefact_decision_coverage.ts's
 *   migration from a hardcoded TS array to a JSON fixture (scripts/artefact_decisions.json):
 *   proves the fixture parses, and that it still satisfies coverage against the real,
 *   live Blueprints/ catalog — the same "did the refactor lose data" check
 *   check_blueprint_integrity_test.ts's "the live repository catalog passes the gate" runs.
 * @architectural-layer Script (test)
 * @dependencies [@std/assert, @std/path]
 * @related-files [scripts/check_artefact_decision_coverage.ts, tests/scenario_framework/runner/artefact_decision_coverage.ts]
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { loadArtefactCatalog } from "../../tests/scenario_framework/runner/artefact_catalog.ts";
import {
  assertArtefactDecisionCoverage,
  loadArtefactDecisions,
} from "../../tests/scenario_framework/runner/artefact_decision_coverage.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
const DECISIONS_FIXTURE_PATH = join(REPO_ROOT, "scripts", "artefact_decisions.json");
const BLUEPRINTS_DIR = join(REPO_ROOT, "Blueprints");

Deno.test("[check_artefact_decision_coverage] scripts/artefact_decisions.json parses into IArtefactDecisionEntry[]", async () => {
  const decisions = await loadArtefactDecisions(DECISIONS_FIXTURE_PATH);
  assert(decisions.length > 0, "the fixture must contain at least one decision entry");
});

Deno.test("[check_artefact_decision_coverage] the live Blueprints catalog passes coverage against the real fixture", async () => {
  const [catalog, decisions] = await Promise.all([
    loadArtefactCatalog(BLUEPRINTS_DIR),
    loadArtefactDecisions(DECISIONS_FIXTURE_PATH),
  ]);
  // Throws on any gap — the assertion itself is the test.
  assertArtefactDecisionCoverage(catalog, decisions);
});
