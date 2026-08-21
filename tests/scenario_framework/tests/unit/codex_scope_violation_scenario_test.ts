/**
 * @module CodexScopeViolationScenarioTest
 * @path tests/scenario_framework/tests/unit/codex_scope_violation_scenario_test.ts
 * @description Phase 167 Step 4 — structural tests for the Codex-specific negative
 *   scenario session_delegate_codex_scope_violation_live.yaml. Mirrors
 *   scope_violation_scenario_test.ts's role for the opencode negative scenario, adapted
 *   for the trace-scoped `action_type`/`expect_count`/`payload_*` step fields this
 *   scenario uses instead of the older journal-event-exists criterion kind. No new
 *   scenario step kind is introduced; this guards against literal drift and proves the
 *   scenario asserts BOTH scope-enforcement layers (workspace-write sandbox confinement
 *   for the external write, post-hoc checkScope for the in-worktree forbidden write)
 *   under the same request trace. The live runtime assertion is Step 4's non-deferrable
 *   provider-live cutover (deferred pending Codex account quota — see the plan doc's
 *   Reachability Ledger row CODEX-LIVE-GENERATION-QUOTA).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/provider_live/session_delegate_codex_scope_violation_live.yaml, packages/core/src/events/domain_event_types.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { DomainEventType } from "@exaix/core/events";
import { type IScenario, ScenarioSchema } from "../../schema/scenario_schema.ts";
import { CriterionKind, ScenarioStepType } from "../../schema/step_schema.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const SCENARIO_PATH = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/provider_live/session_delegate_codex_scope_violation_live.yaml",
);

async function parseScenario(): Promise<IScenario> {
  const raw = await Deno.readTextFile(SCENARIO_PATH);
  return ScenarioSchema.parse(parseYaml(raw));
}

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
  assertEquals(startDaemon!.env?.EXA_CONFIG_PATH, "$FRAMEWORK_HOME/../../configs/dogfood.codex.toml");
});

Deno.test("[codex_scope_violation_live][security] asserts session.delegate.scope_violation, trace-scoped, real DomainEventType string", async () => {
  const scenario = await parseScenario();
  const step = scenario.steps.find((s) => s.id === "assert-scope-violation-journalled");
  assert(step, "assert-scope-violation-journalled step must exist");
  assertEquals(step!.type, ScenarioStepType.JOURNAL_ASSERT);
  assertEquals(step!.trace_scoped, true);
  assertEquals(step!.action_type, DomainEventType.SessionDelegateScopeViolation);
  assertEquals(step!.action_type, "session.delegate.scope_violation");
});

Deno.test("[codex_scope_violation_live][security] asserts session.delegate.reconciled is ABSENT (expect_count: 0) for this trace — the wait was never resumed", async () => {
  const scenario = await parseScenario();
  const step = scenario.steps.find((s) => s.id === "assert-wait-not-resumed");
  assert(step, "assert-wait-not-resumed step must exist");
  assertEquals(step!.type, ScenarioStepType.JOURNAL_ASSERT);
  assertEquals(step!.trace_scoped, true);
  assertEquals(step!.action_type, DomainEventType.SessionDelegateReconciled);
  assertEquals(step!.expect_count, 0);
});

Deno.test("[codex_scope_violation_live][security] asserts the external sentinel is absent via an absolute file-not-exists path outside the workspace", async () => {
  const scenario = await parseScenario();
  const step = scenario.steps.find((s) => s.id === "assert-external-sentinel-absent");
  assert(step, "assert-external-sentinel-absent step must exist");
  assertEquals(step!.type, ScenarioStepType.FILE_CONTAINS);
  const criterion = (step!.output_criteria ?? []).find((c) => c.kind === CriterionKind.FILE_NOT_EXISTS);
  assert(criterion, "must carry a file-not-exists criterion");
  assertEquals(
    "path" in criterion! ? criterion.path : undefined,
    "/tmp/exaix-codex-external-scope-violation-sentinel.txt",
  );
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
