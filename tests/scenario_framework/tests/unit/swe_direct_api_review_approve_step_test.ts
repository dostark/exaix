/**
 * @module SweDirectApiReviewApproveStepTest
 * @path tests/scenario_framework/tests/unit/swe_direct_api_review_approve_step_test.ts
 * @description Phase 140a Step 6 (POST-GAP-2) — RED-first tests for the missing approve-review
 *   step in fix-bug-null-guard.yaml (the direct-Anthropic-API cell). Step 5 fixed
 *   ToolRegistry.resolvePath so a portal-scoped `@alias` write now correctly lands in the git
 *   worktree PortalExecutionStrategy.WORKTREE sets up, rather than bypassing it. Without an
 *   approve-review step between execution and run-tests, the agent's real fix now lands only in
 *   .exa/worktrees/<portal>/<trace_id>/ and run-tests (which checks the mounted portal) sees
 *   stale, unfixed code — mirroring the identical fix already applied to
 *   fix-bug-null-guard-cli-all.yaml. Asserts a new "approve-review" step exists, is positioned
 *   between wait-for-execution-completion and run-tests, discovers trace_id from the journal
 *   rather than a hardcoded branch name, and that the scenario's stale "no code_changes delegate
 *   worktree is created" comment (factually wrong per Step 5's finding) is gone.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/swe_tasks/fix-bug-null-guard.yaml, tests/scenario_framework/scenarios/swe_tasks/fix-bug-null-guard-cli-all.yaml, tests/scenario_framework/tests/unit/swe_cli_all_review_approve_step_test.ts]
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const SCENARIO_PATH = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/swe_tasks/fix-bug-null-guard.yaml",
);

async function readRawYaml(): Promise<string> {
  return await Deno.readTextFile(SCENARIO_PATH);
}

async function parseScenario(): Promise<ReturnType<typeof ScenarioSchema.parse>> {
  const raw = await readRawYaml();
  return ScenarioSchema.parse(parseYaml(raw));
}

Deno.test("[swe_direct_api_review_approve] an approve-review step exists between wait-for-execution-completion and run-tests", async () => {
  const scenario = await parseScenario();
  const ids = scenario.steps.map((s) => s.id);

  const approveIndex = ids.indexOf("approve-review");
  const waitIndex = ids.indexOf("wait-for-execution-completion");
  const runTestsIndex = ids.indexOf("run-tests");

  assert(approveIndex !== -1, "an 'approve-review' step must exist");
  assert(waitIndex !== -1, "'wait-for-execution-completion' step must exist");
  assert(runTestsIndex !== -1, "'run-tests' step must exist");
  assert(
    waitIndex < approveIndex,
    `approve-review (index ${approveIndex}) must come after wait-for-execution-completion (index ${waitIndex})`,
  );
  assert(
    approveIndex < runTestsIndex,
    `approve-review (index ${approveIndex}) must come before run-tests (index ${runTestsIndex})`,
  );
});

Deno.test("[swe_direct_api_review_approve] approve-review discovers trace_id from the journal and calls review approve, not a hardcoded branch", async () => {
  const scenario = await parseScenario();
  const step = scenario.steps.find((s) => s.id === "approve-review");
  assert(step, "approve-review step must exist");
  assert(step.type === "shell", "approve-review must be a shell step");

  const argsText = (step.args ?? []).join(" ");
  assert(argsText.includes("review approve"), "must invoke 'review approve'");
  assert(
    argsText.includes("trace_id") && argsText.includes("request.created"),
    "must derive the branch/request identity from a live journal lookup (trace_id / request.created), not a hardcoded value",
  );
});

Deno.test("[swe_direct_api_review_approve] approve-review's output_criteria requires review.approved in the command output", async () => {
  const scenario = await parseScenario();
  const step = scenario.steps.find((s) => s.id === "approve-review");
  assert(step, "approve-review step must exist");

  const criteria = step.output_criteria ?? [];
  const matched = criteria.find(
    (c) => c.kind === "command-output-contains" && c.contains?.includes("review.approved"),
  );
  assert(matched, "approve-review must assert 'review.approved' appears in command output");
});

Deno.test("[swe_direct_api_review_approve] the stale 'no code_changes delegate worktree is created' comment is removed from the raw YAML", async () => {
  const raw = await readRawYaml();
  assert(
    !raw.includes("no code_changes delegate worktree is created"),
    "the false claim that this execution path is exempt from worktree isolation must be removed — " +
      "GitExecutionSetupService.getExecutionStrategy forces WORKTREE for every portal-scoped plan regardless of session_delegate.enabled",
  );
});

Deno.test("[swe_direct_api_review_approve] the single matrix cell still resolves correctly with approve-review present (regression guard)", async () => {
  const scenario = await parseScenario();
  const cellTools = scenario.matrix?.cells.map((c) => c.tool) ?? [];
  assert(cellTools.includes("exactl"), "the direct-API matrix cell must still resolve");

  const stepIds = scenario.steps.map((s) => s.id);
  assert(
    stepIds.includes("approve-review"),
    "the scenario's step list must include the new approve-review step",
  );
});
