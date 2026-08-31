/**
 * @module DelegateMatrixScenarioTest
 * @path tests/scenario_framework/tests/unit/delegate_matrix_scenario_test.ts
 * @description Phase 127 Step 4 / Phase 128 Step 5 / Phase 167 Step 4 — tests for the
 *   parametrized session_delegate_matrix_live.yaml and the dedicated permission-
 *   hardening scenario session_delegate_hardening_active_live.yaml. Asserts the
 *   YAML parses against ScenarioSchema, enumerates exactly 5 cells (opencode x2,
 *   claude-code x2, codex), each cell selects the intended (tool, provider) pair via
 *   config preset + EXA_SESSION_DELEGATE_TOOL, and every cell terminates in
 *   journal-assert steps asserting session.delegate.reconciled (positive) with no
 *   session.delegate.scope_violation assertion. The hardening scenario proves the
 *   pre-flight guard structure: reconciled without scope_violation. The codex cell
 *   additionally carries four codex-only, trace-scoped journal-assert steps
 *   (briefed/launched/returned/reconciled) proving the audit chain under the request's
 *   own trace, not merely global event presence (Phase 167 Step 4).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/provider_live/session_delegate_matrix_live.yaml, tests/scenario_framework/scenarios/provider_live/session_delegate_hardening_active_live.yaml, tests/scenario_framework/runner/matrix_expander.ts]
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
const HARDENING_SCENARIO = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/provider_live/session_delegate_hardening_active_live.yaml",
);

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

Deno.test("[delegate_matrix] the matrix scenario parses and enumerates exactly 5 cells", async () => {
  const scenario = await parseMatrixScenario();
  assert(scenario.matrix, "scenario must have a matrix block");
  assertEquals(scenario.matrix.cells.length, 5, "matrix must have exactly 5 cells");
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
    "codex/direct": {
      config: "configs/dogfood.codex.toml",
      bin: "codex",
      hasOptin: "EXA_MATRIX_CODEX",
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

/**
 * Read and parse the hardening scenario YAML.
 */
async function parseHardeningScenario(): Promise<ReturnType<typeof ScenarioSchema.parse>> {
  const raw = await Deno.readTextFile(HARDENING_SCENARIO);
  return ScenarioSchema.parse(parseYaml(raw));
}

Deno.test("[delegate_hardening] the hardening scenario parses and has correct tags", async () => {
  const scenario = await parseHardeningScenario();
  assertEquals(scenario.id, "session-delegate-hardening-active-live");
  const tags = new Set(scenario.tags);
  assert(tags.has("provider-live"), "must be tagged provider-live");
  assert(tags.has("safety-gate"), "must be tagged safety-gate");
  assert(tags.has("session-delegation"), "must be tagged session-delegation");
});

Deno.test("[delegate_hardening] the hardening scenario asserts reconciled WITHOUT scope_violation (pre-flight proof)", async () => {
  const scenario = await parseHardeningScenario();
  const events = journalEventTypes(scenario.steps);
  assert(
    events.includes("session.delegate.reconciled"),
    `hardening scenario must assert session.delegate.reconciled; found ${JSON.stringify(events)}`,
  );
  assert(
    !events.includes("session.delegate.scope_violation"),
    "hardening scenario must NOT assert scope_violation (pre-flight guard prevents it)",
  );
  assert(
    !events.includes("session.delegate.agent_mismatch"),
    "hardening scenario must NOT assert agent_mismatch (identity matches by construction)",
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

Deno.test("[delegate_matrix] the scenario steps expandMatrix produces 5 cell-runs with correct per-cell overlay", async () => {
  const scenario = await parseMatrixScenario();
  assert(scenario.matrix, "scenario must have a matrix block");
  const matrix = MatrixSchema.parse(scenario.matrix);

  // Simulate all prerequisites present
  const runs = expandMatrix(scenario.steps, matrix, {
    env: {
      OPENROUTER_API_KEY: "k",
      ANTHROPIC_API_KEY: "k",
      EXA_MATRIX_OPENCODE: "1",
      EXA_MATRIX_CODEX: "1",
    },
    binOnPath: () => true,
  });

  assertEquals(runs.length, 5, "expandMatrix must produce 5 runs");
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

Deno.test("[delegate_matrix][security] the codex cell asserts the REAL worktree file-content proof (GREETING in src/main.ts), not just a reconciled journal row", async () => {
  // The matrix previously only asserted journal events, so a codex run returning
  // accepted-changes_made with ZERO real edits could pass. Assert the codex cell carries a
  // file-contains step pinning the fixture's acceptance content.
  const scenario = await parseMatrixScenario();
  const byId = new Map(scenario.steps.map((s) => [s.id, s]));
  const contentStep = byId.get("assert-codex-worktree-change");
  assert(contentStep, "assert-codex-worktree-change step must exist on the codex cell");
  assertEquals(contentStep.type, ScenarioStepType.FILE_CONTAINS);
  assertEquals(contentStep.cells, ["codex"], "the file-content step must be codex-cell-scoped");
  const textContains = (contentStep.output_criteria ?? []).find((c) => c.kind === CriterionKind.TEXT_CONTAINS);
  assert(textContains, "the file-content step must carry a text-contains criterion");
  assertEquals(
    "contains" in textContains! ? textContains.contains : undefined,
    "export const GREETING =",
    "must pin the actual fixture acceptance content (src/main.ts declares GREETING)",
  );
});

Deno.test("[delegate_matrix][security] the codex cell is skipped, not run, when EXA_MATRIX_CODEX is unset (explicit opt-in; default CI never spends a Codex subscription)", async () => {
  const scenario = await parseMatrixScenario();
  assert(scenario.matrix, "scenario must have a matrix block");
  const matrix = MatrixSchema.parse(scenario.matrix);

  const runs = expandMatrix(scenario.steps, matrix, {
    env: { OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "k", EXA_MATRIX_OPENCODE: "1" },
    binOnPath: () => true,
  });

  const codexRuns = runs.filter((r) => r.cell.tool === "codex");
  assertEquals(codexRuns.length, 1, "the codex cell must still be enumerated, just recorded skipped");
  for (const r of codexRuns) {
    assertEquals(r.status, "skip");
    assert(
      r.skipReason?.includes("EXA_MATRIX_CODEX"),
      `skip reason should name the missing opt-in, got: ${r.skipReason}`,
    );
  }
});

Deno.test("[delegate_matrix][security] the codex cell is skipped when the codex binary is absent from PATH, independent of the opt-in", async () => {
  const scenario = await parseMatrixScenario();
  assert(scenario.matrix, "scenario must have a matrix block");
  const matrix = MatrixSchema.parse(scenario.matrix);

  const runs = expandMatrix(scenario.steps, matrix, {
    env: { OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "k", EXA_MATRIX_OPENCODE: "1", EXA_MATRIX_CODEX: "1" },
    binOnPath: (bin) => bin !== "codex",
  });

  const codexRun = runs.find((r) => r.cell.tool === "codex");
  assertEquals(codexRun?.status, "skip");
  assert(
    codexRun?.skipReason?.includes("codex"),
    `skip reason should name the missing binary, got: ${codexRun?.skipReason}`,
  );
});

Deno.test("[delegate_matrix] the codex-only trace-scoped steps assert the exact briefed/launched(tool=codex)/returned(accepted)/reconciled(accepted) chain, scoped to the codex cell only", async () => {
  const scenario = await parseMatrixScenario();
  const byId = new Map(scenario.steps.map((s) => [s.id, s]));

  const briefed = byId.get("assert-codex-briefed");
  const launched = byId.get("assert-codex-launched");
  const returned = byId.get("assert-codex-returned");
  const reconciled = byId.get("assert-codex-reconciled");
  assert(briefed && launched && returned && reconciled, "all four codex-only assertion steps must exist");

  for (const step of [briefed, launched, returned, reconciled]) {
    assertEquals(step!.type, ScenarioStepType.JOURNAL_ASSERT);
    assertEquals(step!.cells, ["codex"], `${step!.id} must be scoped to the codex cell only`);
    assertEquals(step!.trace_scoped, true, `${step!.id} must be trace_scoped`);
  }

  assertEquals(briefed!.action_type, "session.delegate.briefed");
  assertEquals(launched!.action_type, "session.delegate.launched");
  assertEquals(launched!.payload_equals, [{ path: "tool", value: "codex" }]);
  assertEquals(returned!.action_type, "session.delegate.returned");
  assertEquals(returned!.payload_equals, [{ path: "accepted", value: true }]);
  assertEquals(reconciled!.action_type, "session.delegate.reconciled");
  assertEquals(reconciled!.payload_not_contains, ["rejected"]);
});
