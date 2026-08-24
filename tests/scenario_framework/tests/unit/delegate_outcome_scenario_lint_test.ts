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

/**
 * The outcome scenario asserts the delegate's produced change. It must assert on
 * CONTENT the delegate wrote, not on plumbing events. Phase 150 LIVE-RT tightened
 * this twice: a `payload_absent` filter on `session.delegate.reconciled` is a
 * plumbing assertion (the first live run showed a scenario reconciling green while
 * touching zero files), and the content assertion now runs as a `shell` step
 * because the delegate's worktree path is named for the run's trace id and
 * criterion `path` values are literal — so a bare "is there a shell step" check
 * would be satisfied by every scenario's setup and prove nothing.
 */
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
  // Phase 167 Step 4 / GAP-30 added the real worktree file-content proof to the matrix
  // scenario (assert-codex-worktree-change), so it is no longer plumbing-only — it now
  // legitimately passes the outcome check. Re-point this anti-tauntology guard at a scenario
  // that remains genuinely plumbing-only (a TUI flow with no delegate-content assertion).
  const path = join(SCENARIOS_DIR, "provider_live/multi-agent-tui-flow.yaml");
  const parsed = ScenarioSchema.parse(parseYaml(await Deno.readTextFile(path)));
  assert(
    !assertsProducedContent(parsed.steps),
    "multi-agent-tui-flow.yaml asserts content it should not — if it now satisfies the " +
      "outcome check, the check has been loosened to the point of proving nothing",
  );
});
