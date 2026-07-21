/**
 * @module SweCliAllReviewApproveStepTest
 * @path tests/scenario_framework/tests/unit/swe_cli_all_review_approve_step_test.ts
 * @description RED-first tests for the missing approve-review step in
 *   fix-bug-null-guard-cli-all.yaml. PortalExecutionStrategy.WORKTREE (forced for every plan
 *   whose frontmatter carries a portal — packages/execution/src/git_execution_setup_service.ts)
 *   applies to CliDelegateStrategy exactly like every other strategy; without an approve step
 *   between execution and run-tests, the agent's commit lands only in
 *   .exa/worktrees/<portal>/<trace_id>/ and run-tests (which checks the mounted portal) always
 *   sees stale code. Asserts a new "approve-review" step exists, is positioned between
 *   wait-for-execution-completion and run-tests, discovers trace_id from the journal rather
 *   than a hardcoded branch name, and that the scenario's stale "no code_changes delegate
 *   worktree" comment (factually wrong — CliDelegateStrategy gets no exemption from the
 *   WORKTREE-forcing rule) is gone.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/swe_tasks/fix-bug-null-guard-cli-all.yaml, tests/integration/portal_worktree_review_cleanup_e2e_test.ts, tests/scenario_framework/tests/unit/delegate_matrix_scenario_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { resolve } from "@std/path";
import { resolveRunnableSteps } from "../../runner/matrix_expander.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const SCENARIO_PATH = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/swe_tasks/fix-bug-null-guard-cli-all.yaml",
);
const FRAMEWORK_HOME = resolve(fromFileUrl(new URL(".", import.meta.url)), "../..");

async function readRawYaml(): Promise<string> {
  return await Deno.readTextFile(SCENARIO_PATH);
}

async function parseScenario(): Promise<ReturnType<typeof ScenarioSchema.parse>> {
  const raw = await readRawYaml();
  return ScenarioSchema.parse(parseYaml(raw));
}

Deno.test("[swe_cli_all_review_approve] an approve-review step exists between wait-for-execution-completion and run-tests", async () => {
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

Deno.test("[swe_cli_all_review_approve] approve-review discovers trace_id from the journal and calls review approve, not a hardcoded branch", async () => {
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

Deno.test("[swe_cli_all_review_approve] approve-review queries by rowid, not timestamp, to pick the FIRST request.created row deterministically", async () => {
  const scenario = await parseScenario();
  const step = scenario.steps.find((s) => s.id === "approve-review");
  assert(step, "approve-review step must exist");

  const argsText = (step.args ?? []).join(" ");
  // Live-observed: the daemon journals TWO request.created rows for one real request — the
  // CLI submission (request_create_handler.ts) and an independent daemon-side re-detection
  // (packages/request/src/service.ts), both timestamped to the same millisecond. An
  // `ORDER BY timestamp DESC` tiebreak is not deterministic and picked the WRONG, unrelated
  // trace_id in a real run ("Review not found: request-e2f73712" — the real request was
  // f4b95c4d). rowid is monotonic and ties never occur; ASC + LIMIT 1 picks the genuinely
  // first-inserted (CLI-submitted) row.
  assert(
    argsText.includes("rowid"),
    "must order by rowid (monotonic, tie-free) rather than timestamp (two request.created rows can share a millisecond)",
  );
  assert(
    /ORDER BY rowid ASC/.test(argsText) || /ORDER BY rowid\b/.test(argsText),
    "must order by rowid ASC to deterministically select the first-inserted request.created row",
  );
  assert(
    !/ORDER BY timestamp/.test(argsText),
    "must not order by timestamp — ties between the CLI's own request.created and the daemon's independent re-detection event make this non-deterministic",
  );
});

Deno.test("[swe_cli_all_review_approve] approve-review uses POSIX-portable substring extraction, not bash-only ${var:0:8} (dash: 'Bad substitution')", async () => {
  const scenario = await parseScenario();
  const step = scenario.steps.find((s) => s.id === "approve-review");
  assert(step, "approve-review step must exist");

  const argsText = (step.args ?? []).join(" ");
  assert(
    !/\$\{[a-zA-Z_][a-zA-Z0-9_]*:\d/.test(argsText),
    "must not use bash-only ${var:offset:length} substring syntax — the step's command is 'sh', " +
      "which resolves to dash on this system and does not support it (live-observed: 'Bad substitution', exit code 2)",
  );
  assert(
    argsText.includes("cut -c1-8") || argsText.includes("cut -c 1-8"),
    "must extract the 8-char trace_id prefix via a POSIX-portable method (e.g. 'cut -c1-8')",
  );
});

Deno.test("[swe_cli_all_review_approve] approve-review's output_criteria requires review.approved in the command output", async () => {
  const scenario = await parseScenario();
  const step = scenario.steps.find((s) => s.id === "approve-review");
  assert(step, "approve-review step must exist");

  const criteria = step.output_criteria ?? [];
  const matched = criteria.find(
    (c) => c.kind === "command-output-contains" && c.contains?.includes("review.approved"),
  );
  assert(matched, "approve-review must assert 'review.approved' appears in command output");
});

Deno.test("[swe_cli_all_review_approve] the stale 'session_delegate's mechanism' comment is removed from the raw YAML", async () => {
  const raw = await readRawYaml();
  assert(
    !raw.includes("that's session_delegate's mechanism"),
    "the false claim that CliDelegateStrategy is exempt from WORKTREE isolation must be removed — " +
      "GitExecutionSetupService.getExecutionStrategy forces WORKTREE for every portal-scoped plan regardless of execution strategy",
  );
});

Deno.test("[swe_cli_all_review_approve] both matrix cells still resolve correctly with approve-review present (regression guard)", async () => {
  const scenario = await parseScenario();
  const groups = resolveRunnableSteps(scenario, {
    env: {},
    binOnPath: () => true,
    configBaseDir: resolve(FRAMEWORK_HOME, "..", ".."),
  });

  assertEquals(groups.length, 2, "both matrix cells must still resolve");
  const tools = groups.map((g) => g.cell?.tool).sort();
  assertEquals(tools, ["claude-code", "opencode"]);

  // The new step is outside matrix.cells — every group's steps array must include it.
  for (const group of groups) {
    const stepIds = group.steps.map((s) => s.id);
    assert(
      stepIds.includes("approve-review"),
      `cell ${group.cell?.tool} must include the approve-review step`,
    );
  }
});
