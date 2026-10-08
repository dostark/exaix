/**
 * @module CodexScopeViolationScenarioTest
 * @path tests/scenario_framework/tests/unit/codex_scope_violation_scenario_test.ts
 * @description Phase 167 Step 4 — structural tests for the Codex-specific negative
 *   scenario session_delegate_codex_scope_violation_live.yaml. Mirrors
 *   scope_violation_scenario_test.ts's role for the opencode negative scenario, adapted
 *   for the trace-scoped `action_type`/`expect_count`/`payload_*` step fields this
 *   scenario uses instead of the older journal-event-exists criterion kind.
 *
 *   LIVE DEVIATION: the real codex-cli PLANNING provider fails closed AT
 *   PLAN TIME for this fixture — it recognizes both writes as out-of-scope and generates
 *   a plan whose only step is read-only, so the delegate is briefed with no write intent
 *   and `session.delegate.scope_violation` never fires. The scenario therefore asserts
 *   the fail-closed guarantees the live path ACTUALLY produces: a reconciled
 *   `changes_made` return with no write paths, scope_violation ABSENT (nothing escaped),
 *   and the external sentinel never landing. The layer-2 checkScope fire path (an
 *   in-worktree write outside permitted_paths -> scope_violation) is proven
 *   authoritatively by the fake-spawn test apps/daemon/tests/codex_session_scope_test.ts —
 *   see the plan doc's Step 4 deviation note. The live runtime assertion is Step 4's
 *   provider-live cutover (see the plan doc's Reachability Ledger row
 *   CODEX-LIVE-GENERATION-QUOTA).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/provider_live/session_delegate_codex_scope_violation_live.yaml, packages/core/src/events/domain_event_types.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parseScenario, REPO_ROOT } from "./helpers/codex_scope_violation_fixture.ts";

Deno.test("[codex_scope_violation_live] the negative scenario parses against ScenarioSchema and is tagged provider-live/safety-gate/security", async () => {
  const scenario = await parseScenario();
  const tags = new Set(scenario.tags);
  assert(tags.has("provider-live"), "must be provider-live (excluded from CI auto-runs)");
  assert(tags.has("safety-gate"), "must be tagged safety-gate (correctness invariant)");
  assert(tags.has("security"), "must be tagged security");
  assert(tags.has("session-delegation"), "must be tagged session-delegation");
});

Deno.test("[codex_scope_violation_live] uses configs/dogfood.codex.toml, not an env-var-override daemon config", async () => {
  const scenario = await parseScenario();
  const startDaemon = scenario.steps.find((s) => s.id === "start-daemon");
  assert(startDaemon, "start-daemon step must exist");
  assertEquals(startDaemon!.env?.EXA_CONFIG_PATH, "$REPO_ROOT/configs/dogfood.codex.toml");
});

Deno.test("[codex_scope_violation_live] the request fixture asks for both an in-worktree forbidden write and an external write", async () => {
  const scenario = await parseScenario();
  const fixturePath = join(REPO_ROOT, "tests/scenario_framework", scenario.request_fixture);
  const body = await Deno.readTextFile(fixturePath);
  assert(body.includes("README.md"), "fixture must target README.md (outside permitted_paths src/**, tests/**)");
  assert(
    body.includes("/tmp/exaix-codex-external-scope-violation-sentinel.txt"),
    "fixture must name the exact external sentinel absolute path the scenario asserts absent",
  );
});
