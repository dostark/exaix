/**
 * @module DelegateMatrixScenarioTest
 * @path tests/scenario_framework/tests/unit/delegate_matrix_scenario_test.ts
 * @description Phase 127 Step 4 — RED-first tests for the parametrized
 *   session_delegate_matrix_live.yaml. Asserts the YAML parses against ScenarioSchema,
 *   enumerates exactly 4 cells, each cell selects the intended (tool, provider) pair
 *   via config preset + EXA_SESSION_DELEGATE_TOOL, and every cell terminates in
 *   journal-assert steps asserting session.delegate.reconciled (positive) with no
 *   session.delegate.scope_violation assertion. The live runtime assertions run in
 *   the Step 5 cutover against real delegates; this test proves the scenario structure.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/provider_live/session_delegate_matrix_live.yaml, tests/scenario_framework/runner/matrix_expander.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { expandMatrix, MatrixSchema } from "../../runner/matrix_expander.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { CriterionKind, ScenarioStepType } from "../../schema/step_schema.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const MATRIX_SCENARIO = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/provider_live/session_delegate_matrix_live.yaml",
);

/**
 * Read and parse the matrix scenario YAML, returning the parsed scenario.
 * Used by every test in this module.
 */
async function parseMatrixScenario(): Promise<ReturnType<typeof ScenarioSchema.parse>> {
  const raw = await Deno.readTextFile(MATRIX_SCENARIO);
  return ScenarioSchema.parse(parseYaml(raw));
}

/**
 * Collect every journal-event-exists event_type declared in the steps array.
 */
function journalEventTypes(
  steps: ReturnType<typeof ScenarioSchema.parse>["steps"],
): string[] {
  const found: string[] = [];
  for (const step of steps) {
    if (step.type !== ScenarioStepType.JOURNAL_ASSERT) continue;
    for (const criterion of step.output_criteria ?? []) {
      if (criterion.kind === CriterionKind.JOURNAL_EVENT_EXISTS && criterion.event_type) {
        found.push(criterion.event_type);
      }
    }
  }
  return found;
}

Deno.test("[delegate_matrix] the matrix scenario parses and enumerates exactly 4 cells", async () => {
  const scenario = await parseMatrixScenario();
  assert(scenario.matrix, "scenario must have a matrix block");
  assertEquals(scenario.matrix.cells.length, 4, "matrix must have exactly 4 cells");
  const tags = new Set(scenario.tags);
  assert(tags.has("provider-live"), "must be tagged provider-live");
  assert(tags.has("session-delegation"), "must be tagged session-delegation");
  assert(tags.has("safety-gate"), "must be tagged safety-gate (correctness invariant)");
});

Deno.test("[delegate_matrix] each cell's config preset + EXA_SESSION_DELEGATE_TOOL select the intended (tool, provider) pair", async () => {
  const scenario = await parseMatrixScenario();
  assert(scenario.matrix, "scenario must have a matrix block");
  const expected: Record<string, { config: string; bin: string; hasKey?: string; hasOptin?: string }> = {
    "opencode/direct": {
      config: "configs/dogfood.toml",
      bin: "opencode",
      hasOptin: "EXA_MATRIX_OPENCODE",
    },
    "opencode/openrouter": {
      config: "configs/dogfood.openrouter.toml",
      bin: "opencode",
      hasKey: "OPENROUTER_API_KEY",
      hasOptin: "EXA_MATRIX_OPENCODE",
    },
    "claude-code/direct": {
      config: "configs/dogfood.claude.toml",
      bin: "claude",
      hasKey: "ANTHROPIC_API_KEY",
    },
    "claude-code/openrouter": {
      config: "configs/dogfood.claude.openrouter.toml",
      bin: "claude",
      hasKey: "OPENROUTER_API_KEY",
    },
  };

  for (const cell of scenario.matrix.cells) {
    const key = `${cell.tool}/${cell.provider}`;
    const exp = expected[key];
    assert(exp, `unexpected cell: ${key}`);
    assertEquals(cell.config, exp.config, `cell ${key} config mismatch`);
    assertEquals(cell.requires_bin, exp.bin, `cell ${key} binary mismatch`);
    if (exp.hasKey) {
      assertEquals(cell.requires_key, exp.hasKey, `cell ${key} key mismatch`);
    } else {
      assertEquals(cell.requires_key, undefined, `cell ${key} should not require a key`);
    }
    if (exp.hasOptin) {
      assertEquals(cell.requires_optin, exp.hasOptin, `cell ${key} opt-in mismatch`);
    } else {
      assertEquals(cell.requires_optin, undefined, `cell ${key} should not require opt-in`);
    }
  }
});

Deno.test("[delegate_matrix] dry parse: every cell terminates in journal-assert steps for reconciled + scope_violation-absent", async () => {
  const scenario = await parseMatrixScenario();
  const events = journalEventTypes(scenario.steps);
  assert(
    events.includes("session.delegate.reconciled"),
    `matrix steps must assert session.delegate.reconciled; found ${JSON.stringify(events)}`,
  );
  assert(
    !events.includes("session.delegate.scope_violation"),
    "matrix steps must NOT assert scope_violation (absence is proven by the negative scenario; the matrix asserts only reconciled present)",
  );
});

Deno.test("[delegate_matrix] the clean-cell assertion is acceptance-accurate (payload_absent: rejected), not a bare event-type match (PG-1 regression)", async () => {
  const scenario = await parseMatrixScenario();
  const reconciledCriteria = scenario.steps
    .flatMap((step) => step.output_criteria)
    .filter((c) =>
      c.kind === CriterionKind.JOURNAL_EVENT_EXISTS &&
      "event_type" in c && c.event_type === "session.delegate.reconciled"
    );
  assert(reconciledCriteria.length > 0, "matrix must assert session.delegate.reconciled");
  for (const c of reconciledCriteria) {
    const payloadAbsent = "payload_absent" in c ? c.payload_absent : undefined;
    assert(
      payloadAbsent !== undefined,
      "the reconciled assertion must carry payload_absent so it means ACCEPTED, not merely reconciled (PG-1)",
    );
    assertEquals(
      payloadAbsent.rejected,
      true,
      "payload_absent must exclude rejected:true so a non-scope-rejected reconcile fails the cell",
    );
  }
});

Deno.test("[delegate_matrix] the scenario steps expandMatrix produces 4 cell-runs with correct per-cell overlay", async () => {
  const scenario = await parseMatrixScenario();
  assert(scenario.matrix, "scenario must have a matrix block");
  const matrix = MatrixSchema.parse(scenario.matrix);

  // Simulate all prerequisites present
  const runs = expandMatrix(scenario.steps, matrix, {
    env: {
      OPENROUTER_API_KEY: "k",
      ANTHROPIC_API_KEY: "k",
      EXA_MATRIX_OPENCODE: "1",
    },
    binOnPath: () => true,
  });

  assertEquals(runs.length, 4, "expandMatrix must produce 4 runs");
  for (const run of runs) {
    assertEquals(run.status, "run", `cell ${run.cell.tool}/${run.cell.provider} should be runnable`);
    // Verify each run's start-daemon step has the per-cell overlay
    const daemon = run.steps.find((s) => s.id === "start-daemon");
    assert(daemon, "start-daemon step must survive expansion");
    const env = daemon.env ?? {};
    assertEquals(env.EXA_CONFIG_PATH, run.cell.config);
    assertEquals(env.EXA_SESSION_DELEGATE_TOOL, run.cell.tool);
    assertEquals(env.EXA_SESSION_DELEGATE_ENABLED, "true");
  }
});
