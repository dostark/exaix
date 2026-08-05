/**
 * @module BareCellScoringTest
 * @path tests/scenario_framework/tests/unit/bare_cell_scoring_test.ts
 * @description Phase 143 Step 1 — RED-first tests for the bare-delegate baseline cell's
 * template shape. `renderSweTaskBareTemplate` must emit a scenario that scores outcome
 * criteria only: pinned-worktree setup steps (shared with the Exaix template so brief and
 * worktree parity is enforced by construction), a single `bare-delegate` SHELL step bounded
 * by `timeout_sec`, and the unchanged `verify-tests` outcome step. Process/plan steps
 * (daemon, request, plan, approve, review, judge, trajectory) must be structurally absent —
 * bare cells have no journal, so process-channel criteria are excluded from both sides of a
 * lift comparison (Design Decision 1), never scored as 0 against the bare cell. The matrix
 * cells must carry the `harness: bare` marker so the runner records `cell_id: bare/<tool>/<provider>`
 * and the `harness:bare` tag.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_templates.ts, tests/scenario_framework/runner/matrix_expander.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import {
  type ISweTaskTemplateOptions,
  renderSweTaskBareTemplate,
  renderSweTaskTemplate,
  VERIFY_TESTS_STEP_ID,
} from "../../runner/scenario_templates.ts";
import { BARE_DELEGATE_STEP_ID } from "../../runner/matrix_expander.ts";

const FORBIDDEN_PROCESS_STEP_IDS = [
  "start-daemon",
  "add-portal",
  "restart-daemon",
  "wait-for-daemon-ready",
  "submit-request",
  "wait-for-plan",
  "approve-plan",
  "wait-for-execution-completion",
  "approve-review",
  "assert-trajectory",
  "prepare-llm-judge-evidence",
  "judge-quality",
];

const REQUIRED_SETUP_STEP_IDS = [
  "setup-db",
  "setup-portal-repo",
  "setup-blueprints",
  "setup-memory",
];

interface IParsedBareScenarioYaml {
  id: string;
  tags: string[];
  matrix?: { cells?: Array<{ tool: string; provider: string; harness?: string }> };
  steps: Array<{
    id: string;
    type: string;
    command?: string;
    args?: string[];
    timeout_sec?: number;
    output_criteria?: Array<{ id: string; kind: string }>;
  }>;
}

function makeOpts(overrides: Partial<ISweTaskTemplateOptions> = {}): ISweTaskTemplateOptions {
  return {
    id: "swe-test-task",
    title: "Test task",
    requestFixture: "fixtures/requests/swe_tasks/test-task.md",
    cells: [
      {
        tool: "claude-code",
        provider: "$CELL_PROVIDER",
        config: "configs/claude-cli-delegate-all.toml",
        requiresBin: "claude",
      },
      {
        tool: "opencode",
        provider: "ollama",
        config: "configs/ollama-cli-delegate-all.toml",
        requiresBin: "opencode",
      },
    ],
    ...overrides,
  };
}

Deno.test("[BareCellScoring] bare template renders outcome-only steps: setup + delegate + verify-tests, no process steps", () => {
  const yaml = renderSweTaskBareTemplate(makeOpts());
  const parsed = parseYaml(yaml) as IParsedBareScenarioYaml;

  const stepIds = parsed.steps.map((s) => s.id);
  for (const setupId of REQUIRED_SETUP_STEP_IDS) {
    assert(stepIds.includes(setupId), `setup step ${setupId} must be present in bare scenario`);
  }
  assert(stepIds.includes(BARE_DELEGATE_STEP_ID), `delegate step ${BARE_DELEGATE_STEP_ID} must be present`);
  assert(stepIds.includes(VERIFY_TESTS_STEP_ID), `outcome step ${VERIFY_TESTS_STEP_ID} must be present`);

  for (const forbiddenId of FORBIDDEN_PROCESS_STEP_IDS) {
    assert(!stepIds.includes(forbiddenId), `process step ${forbiddenId} must be absent from bare scenario`);
  }
});

Deno.test("[BareCellScoring] bare delegate step is a SHELL step bounded by timeout_sec with an exit-code criterion", () => {
  const yaml = renderSweTaskBareTemplate(makeOpts());
  const parsed = parseYaml(yaml) as IParsedBareScenarioYaml;

  const delegate = parsed.steps.find((s) => s.id === BARE_DELEGATE_STEP_ID);
  assert(delegate !== undefined, "bare-delegate step must exist");
  assertEquals(delegate.type, "shell");
  assert(typeof delegate.timeout_sec === "number", "delegate step must be bounded by timeout_sec");
  const criteria = delegate.output_criteria ?? [];
  assert(
    criteria.some((c) => c.kind === "command-exit-code" && c.id === "delegate-ran"),
    "delegate step must carry a command-exit-code criterion",
  );
});

Deno.test("[BareCellScoring] verify-tests outcome step is present unchanged with its tests-pass criterion", () => {
  const yaml = renderSweTaskBareTemplate(makeOpts());
  const parsed = parseYaml(yaml) as IParsedBareScenarioYaml;

  const verify = parsed.steps.find((s) => s.id === VERIFY_TESTS_STEP_ID);
  assert(verify !== undefined, "verify-tests step must exist");
  const criteria = verify.output_criteria ?? [];
  assert(
    criteria.some((c) => c.id === "tests-pass" && c.kind === "command-exit-code"),
    "verify-tests must keep the tests-pass command-exit-code criterion",
  );
});

Deno.test("[BareCellScoring] matrix cells carry the harness: bare marker for every declared cell", () => {
  const yaml = renderSweTaskBareTemplate(makeOpts());
  const parsed = parseYaml(yaml) as IParsedBareScenarioYaml;

  const cells = parsed.matrix?.cells ?? [];
  assertEquals(cells.length, 2, "one bare cell per declared tool");
  for (const cell of cells) {
    assertEquals(cell.harness, "bare", `cell ${cell.tool} must carry harness: bare`);
  }
});

Deno.test("[BareCellScoring] setup step ids match the Exaix template exactly (parity by construction)", () => {
  const exaixYaml = renderSweTaskTemplate(makeOpts());
  const exaixParsed = parseYaml(exaixYaml) as IParsedBareScenarioYaml;
  const exaixSetupIds = exaixParsed.steps.filter((s) => REQUIRED_SETUP_STEP_IDS.includes(s.id)).map((s) => s.id);

  const bareYaml = renderSweTaskBareTemplate(makeOpts());
  const bareParsed = parseYaml(bareYaml) as IParsedBareScenarioYaml;
  const bareSetupIds = bareParsed.steps.filter((s) => REQUIRED_SETUP_STEP_IDS.includes(s.id)).map((s) => s.id);

  assertEquals(bareSetupIds, exaixSetupIds, "both templates must share the same setup step set");
});
