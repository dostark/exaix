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

/** criterion `path` values are literal, so a trace-id-named worktree path needs a shell step instead of a file-assert type. */
function assertsProducedContent(steps: ReturnType<typeof ScenarioSchema.parse>["steps"]): boolean {
  for (const step of steps) {
    if (
      step.type === ScenarioStepType.FILE_CONTAINS ||
      step.type === ScenarioStepType.JSON_ASSERT ||
      step.type === ScenarioStepType.TRAJECTORY_ASSERT ||
      step.type === ScenarioStepType.FRONTMATTER_ASSERT
    ) {
      return true;
    }
    // A shell step qualifies only when it reads the delegate's worktree AND asserts
    // on the content it finds there — setup/teardown shell steps do neither.
    if (step.type === ScenarioStepType.SHELL && step.output_criteria) {
      const readsWorktree = (step.args ?? []).some((a) => String(a).includes(".exa/worktrees"));
      const assertsContent = step.output_criteria.some(
        (c) => c.kind === CriterionKind.COMMAND_OUTPUT_CONTAINS && (c.contains?.length ?? 0) > 0,
      );
      if (readsWorktree && assertsContent) return true;
    }
  }
  return false;
}

Deno.test("[delegate-outcome-lint] the outcome scenario asserts delegate-produced content", async () => {
  const path = join(SCENARIOS_DIR, "provider_live/session_delegate_outcome_live.yaml");
  const parsed = ScenarioSchema.parse(parseYaml(await Deno.readTextFile(path)));
  assert(
    assertsProducedContent(parsed.steps),
    "session_delegate_outcome_live.yaml must assert on content the delegate wrote — " +
      "a reconcile/plumbing assertion alone lets a no-op delegation pass",
  );
});

Deno.test("[delegate-outcome-lint] plumbing-only scenarios do not satisfy the outcome check", async () => {
  // The matrix scenario now includes real worktree file-content proof, so it's no longer
  // plumbing-only and legitimately passes the outcome check. Re-pointed this anti-tautology
  // guard at a scenario that remains genuinely plumbing-only.
  const path = join(SCENARIOS_DIR, "provider_live/multi-agent-tui-flow.yaml");
  const parsed = ScenarioSchema.parse(parseYaml(await Deno.readTextFile(path)));
  assert(
    !assertsProducedContent(parsed.steps),
    "multi-agent-tui-flow.yaml asserts content it should not — if it now satisfies the " +
      "outcome check, the check has been loosened to the point of proving nothing",
  );
});
