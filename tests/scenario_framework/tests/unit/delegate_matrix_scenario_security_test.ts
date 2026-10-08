/**
 * @module DelegateMatrixScenarioSecurityTest
 * @path tests/scenario_framework/tests/unit/delegate_matrix_scenario_security_test.ts
 * @description Phase 167 Step 4 — [security] tests for the codex cell of the parametrized
 *   session_delegate_matrix_live.yaml: the REAL worktree file-content proof and the explicit
 *   opt-in / binary-present gates that keep the default CI from spending a Codex subscription.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/provider_live/session_delegate_matrix_live.yaml, tests/scenario_framework/tests/unit/helpers/delegate_matrix_scenario_fixture.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { expandMatrix, MatrixSchema } from "../../runner/matrix_expander.ts";
import { CriterionKind, ScenarioStepType } from "../../schema/step_schema.ts";
import { parseMatrixScenario } from "./helpers/delegate_matrix_scenario_fixture.ts";

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
