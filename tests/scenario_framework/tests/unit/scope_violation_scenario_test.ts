/**
 * @module ScenarioFrameworkScopeViolationScenarioTest
 * @path tests/scenario_framework/tests/unit/scope_violation_scenario_test.ts
 * @description Phase 127 Step 3 — RED-first tests for the worktree-isolation assertion
 *   layer. Step 3 adds NO new scenario step kind: it asserts the production journal events
 *   (session.delegate.reconciled / session.delegate.scope_violation) the scope guard already
 *   emits (reconcile.ts:78 -> session_return_watcher.ts). This test guards against literal
 *   drift — every session.delegate.* event_type the negative scenario asserts must equal a
 *   real DomainEventType value. The live runtime assertions (clean cell journals reconciled;
 *   out-of-scope edit journals scope_violation) run in the Step 5 provider-live cutover.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/provider_live/session_delegate_scope_violation_live.yaml, packages/core/src/events/domain_event_types.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { DomainEventType } from "@exaix/core/events";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { CriterionKind, ScenarioStepType } from "../../schema/step_schema.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const SCOPE_VIOLATION_SCENARIO = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/provider_live/session_delegate_scope_violation_live.yaml",
);

const SESSION_DELEGATE_EVENT_PREFIX = "session.delegate.";

const KNOWN_DOMAIN_EVENT_VALUES = new Set<string>(Object.values(DomainEventType));

/** Collect every journal-event-exists `event_type` literal declared in a scenario. */
function journalEventTypes(scenario: ReturnType<typeof ScenarioSchema.parse>): string[] {
  const found: string[] = [];
  for (const step of scenario.steps) {
    if (step.type !== ScenarioStepType.JOURNAL_ASSERT) continue;
    for (const criterion of step.output_criteria ?? []) {
      if (criterion.kind === CriterionKind.JOURNAL_EVENT_EXISTS && criterion.event_type) {
        found.push(criterion.event_type);
      }
    }
  }
  return found;
}

Deno.test("[scope_violation_live] the negative scenario parses against ScenarioSchema and is tagged provider-live", async () => {
  const raw = await Deno.readTextFile(SCOPE_VIOLATION_SCENARIO);
  const scenario = ScenarioSchema.parse(parseYaml(raw));
  assert(
    scenario.tags.includes("provider-live"),
    "scope-violation scenario must be provider-live (excluded from CI auto-runs)",
  );
  assert(
    scenario.tags.includes("safety-gate"),
    "scope-violation scenario must be tagged safety-gate (correctness invariant)",
  );
});

Deno.test("[scope_violation_live] the scenario asserts session.delegate.scope_violation via journal-event-exists", async () => {
  const raw = await Deno.readTextFile(SCOPE_VIOLATION_SCENARIO);
  const scenario = ScenarioSchema.parse(parseYaml(raw));
  const events = journalEventTypes(scenario);
  assert(
    events.includes(DomainEventType.SessionDelegateScopeViolation),
    `scenario must assert ${DomainEventType.SessionDelegateScopeViolation}; found ${JSON.stringify(events)}`,
  );
});

Deno.test("[delegate_matrix] the journal-assert steps reference the exact DomainEventType strings (no literal drift)", async () => {
  const raw = await Deno.readTextFile(SCOPE_VIOLATION_SCENARIO);
  const scenario = ScenarioSchema.parse(parseYaml(raw));
  const events = journalEventTypes(scenario);
  assert(events.length > 0, "scenario must declare at least one journal-event-exists criterion");
  for (const evt of events) {
    if (!evt.startsWith(SESSION_DELEGATE_EVENT_PREFIX)) continue;
    assertEquals(
      KNOWN_DOMAIN_EVENT_VALUES.has(evt),
      true,
      `event_type "${evt}" is not a real DomainEventType value (literal drift)`,
    );
  }
});

Deno.test("[scope_violation_live] the exact event-string constants are stable (mirror of domain_event_types.ts)", () => {
  // Guards the Step 3 / Step 5 assertions against an upstream rename of the events.
  assertEquals(DomainEventType.SessionDelegateScopeViolation, "session.delegate.scope_violation");
  assertEquals(DomainEventType.SessionDelegateReconciled, "session.delegate.reconciled");
});
