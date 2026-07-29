/**
 * @module DelegateOutcomeScenarioLintTest
 * @path tests/scenario_framework/tests/unit/delegate_outcome_scenario_lint_test.ts
 * @description Phase 150 Step 3 — lint-style validation that provider_live delegate
 *   scenarios carry outcome-asserting criteria (not only "session.delegate.reconciled").
 *   Plumbing/safety scenarios (agent_flows) are explicitly retained as-is.
 */
import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { CriterionKind, ScenarioStepType } from "../../schema/step_schema.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const SCENARIOS_DIR = join(REPO_ROOT, "tests/scenario_framework/scenarios");

function hasOutcomeCriteria(steps: ReturnType<typeof ScenarioSchema.parse>["steps"]): boolean {
  for (const step of steps) {
    if (step.type === ScenarioStepType.JOURNAL_ASSERT && step.output_criteria) {
      for (const criterion of step.output_criteria) {
        if (criterion.kind === CriterionKind.JOURNAL_EVENT_EXISTS) {
          // payload_includes on any event qualifies (asserts a specific payload value)
          if (criterion.payload_includes) return true;
          // payload_absent qualifies ONLY when it targets a non-reconciled event
          // (a payload_absent on session.delegate.reconciled is a plumbing assertion)
          if (
            criterion.payload_absent && criterion.event_type && criterion.event_type !== "session.delegate.reconciled"
          ) {
            return true;
          }
        }
      }
    }
    if (
      step.type === ScenarioStepType.FILE_CONTAINS ||
      step.type === ScenarioStepType.JSON_ASSERT ||
      step.type === ScenarioStepType.TRAJECTORY_ASSERT ||
      step.type === ScenarioStepType.FRONTMATTER_ASSERT
    ) {
      return true;
    }
  }
  return false;
}

Deno.test("[delegate-outcome-lint] at least one provider_live delegate scenario carries an outcome criterion", async () => {
  const providerLiveDir = join(SCENARIOS_DIR, "provider_live");
  let foundDelegate = false;
  let foundOutcome = false;

  for await (const file of Deno.readDir(providerLiveDir)) {
    if (!file.name.endsWith(".yaml") || !file.name.includes("session_delegate")) continue;
    foundDelegate = true;
    const filePath = join(providerLiveDir, file.name);
    const raw = await Deno.readTextFile(filePath);
    const parsed = ScenarioSchema.parse(parseYaml(raw));

    if (hasOutcomeCriteria(parsed.steps)) {
      foundOutcome = true;
    }
  }

  assert(foundDelegate, "must find at least one provider_live session_delegate scenario");
  assert(
    foundOutcome,
    "at least one provider_live delegate scenario must carry an outcome criterion " +
      "(file-contains, json-assert, trajectory-assert, frontmatter-assert, " +
      "payload_includes, or payload_absent on a non-reconciled event) — " +
      "currently provided by session_delegate_outcome_live.yaml (file-contains + payload_absent paths_touched)",
  );
});
