/**
 * @module ScenarioFrameworkMatrixExpanderTest
 * @path tests/scenario_framework/tests/unit/matrix_expander_test.ts
 * @description Phase 127 Step 2 — RED-first tests for the additive scenario `matrix:`
 *   block and its expander. A matrix scenario expands into one cell-run per cell, each
 *   overlaying EXA_CONFIG_PATH (the cell's preset — the provider selector, GAP-2) +
 *   EXA_SESSION_DELEGATE_TOOL + EXA_SESSION_DELEGATE_ENABLED onto the start-daemon step,
 *   and NEVER EXA_SESSION_DELEGATE_PROVIDER (the env var does not exist). Cells missing
 *   their binary / key / opt-in are recorded skipped (not failed). A scenario without a
 *   matrix block is unaffected (backward-compat). The GAP-7 wiring (EXA_CONFIG_PATH is the
 *   daemon's real config source) is asserted by source-grepping apps/daemon/main.ts; the
 *   full live config-swap is proven in Step 5's provider-live cutover.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts, tests/scenario_framework/schema/scenario_schema.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import {
  expandMatrix,
  type IMatrixBlock,
  MATRIX_START_DAEMON_STEP_ID,
  MatrixSchema,
} from "../../runner/matrix_expander.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";
import type { IScenarioStep } from "../../schema/step_schema.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));

function startDaemonStep(): IScenarioStep {
  return {
    id: MATRIX_START_DAEMON_STEP_ID,
    type: ScenarioStepType.EXACTL,
    command: "daemon",
    args: ["start"],
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  } as IScenarioStep;
}

function otherStep(): IScenarioStep {
  return {
    id: "submit-request",
    type: ScenarioStepType.EXACTL,
    command: "request",
    args: ["--file", "x"],
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  } as IScenarioStep;
}

const FOUR_CELL_MATRIX: IMatrixBlock = {
  axes: { tool: ["opencode", "claude-code"], provider: ["direct", "openrouter"] },
  cells: [
    {
      tool: "opencode",
      provider: "direct",
      config: "configs/dogfood.toml",
      requires_bin: "opencode",
      requires_optin: "EXA_MATRIX_OPENCODE",
    },
    {
      tool: "opencode",
      provider: "openrouter",
      config: "configs/dogfood.openrouter.toml",
      requires_bin: "opencode",
      requires_optin: "EXA_MATRIX_OPENCODE",
      requires_key: "OPENROUTER_API_KEY",
    },
    {
      tool: "claude-code",
      provider: "direct",
      config: "configs/dogfood.claude.toml",
      requires_bin: "claude",
      requires_key: "ANTHROPIC_API_KEY",
    },
    {
      tool: "claude-code",
      provider: "openrouter",
      config: "configs/dogfood.claude.openrouter.toml",
      requires_bin: "claude",
      requires_key: "OPENROUTER_API_KEY",
    },
  ],
};

Deno.test("[scenario_matrix] MatrixSchema accepts the four-cell block", () => {
  const parsed = MatrixSchema.parse(FOUR_CELL_MATRIX);
  assertEquals(parsed.cells.length, 4);
});

Deno.test("[scenario_matrix] a scenario with a matrix block expands into one run per cell", () => {
  const steps = [startDaemonStep(), otherStep()];
  // All binaries present, all keys/optins present → every cell runs.
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: {
      OPENROUTER_API_KEY: "k",
      ANTHROPIC_API_KEY: "k",
      EXA_MATRIX_OPENCODE: "1",
    },
    binOnPath: () => true,
  });
  assertEquals(runs.length, 4);
  for (const run of runs) assertEquals(run.status, "run");
});

Deno.test("[scenario_matrix] a runnable cell overlays EXA_CONFIG_PATH (its preset) + EXA_SESSION_DELEGATE_TOOL + ENABLED onto start-daemon; no EXA_SESSION_DELEGATE_PROVIDER", () => {
  const steps = [startDaemonStep(), otherStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: { OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "k", EXA_MATRIX_OPENCODE: "1" },
    binOnPath: () => true,
  });

  const claudeOpenrouter = runs.find(
    (r) => r.cell.tool === "claude-code" && r.cell.provider === "openrouter",
  );
  assert(claudeOpenrouter, "claude-code/openrouter cell must be present");

  const daemon = claudeOpenrouter.steps.find((s) => s.id === MATRIX_START_DAEMON_STEP_ID);
  assert(daemon, "start-daemon step must survive expansion");
  const env = daemon.env ?? {};
  assertEquals(env.EXA_CONFIG_PATH, "configs/dogfood.claude.openrouter.toml");
  assertEquals(env.EXA_SESSION_DELEGATE_TOOL, "claude-code");
  assertEquals(env.EXA_SESSION_DELEGATE_ENABLED, "true");
  assertEquals(
    env.EXA_SESSION_DELEGATE_PROVIDER,
    undefined,
    "EXA_SESSION_DELEGATE_PROVIDER must NOT be set — provider comes from the config preset (GAP-2)",
  );
});

Deno.test("[scenario_matrix] when configBaseDir is given, EXA_CONFIG_PATH is the cell preset resolved to an absolute path (daemon CWD is the workspace, not the repo)", () => {
  const steps = [startDaemonStep(), otherStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: { OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "k", EXA_MATRIX_OPENCODE: "1" },
    binOnPath: () => true,
    configBaseDir: REPO_ROOT,
  });

  const claudeDirect = runs.find(
    (r) => r.cell.tool === "claude-code" && r.cell.provider === "direct",
  );
  assert(claudeDirect, "claude-code/direct cell must be present");
  const daemon = claudeDirect.steps.find((s) => s.id === MATRIX_START_DAEMON_STEP_ID);
  assert(daemon, "start-daemon step must survive expansion");
  const env = daemon.env ?? {};
  assertEquals(env.EXA_CONFIG_PATH, join(REPO_ROOT, "configs/dogfood.claude.toml"));
});

Deno.test("[scenario_matrix] a runnable cell whose steps lack a start-daemon step throws (no silent no-op overlay)", () => {
  // A matrix scenario MUST carry a start-daemon step — that is the only step the per-cell
  // env overlay targets. Without it the cell would boot with no delegate config and produce
  // a false green; expansion must fail loudly on this authoring error instead.
  const stepsWithoutDaemon = [otherStep()];
  assertThrows(
    () =>
      expandMatrix(stepsWithoutDaemon, FOUR_CELL_MATRIX, {
        env: { OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "k", EXA_MATRIX_OPENCODE: "1" },
        binOnPath: () => true,
      }),
    Error,
    MATRIX_START_DAEMON_STEP_ID,
  );
});

Deno.test("[scenario_matrix] a SKIPPED cell does not require a start-daemon step (skip short-circuits before overlay)", () => {
  // Skip resolution happens before the overlay, so a matrix whose cells all skip must not
  // throw even without a start-daemon step — nothing is overlaid.
  const stepsWithoutDaemon = [otherStep()];
  const runs = expandMatrix(stepsWithoutDaemon, FOUR_CELL_MATRIX, {
    env: {}, // no keys, no opt-in → every cell skips
    binOnPath: () => false, // no binaries → every cell skips
  });
  assertEquals(runs.length, 4);
  for (const run of runs) assertEquals(run.status, "skip");
});

Deno.test("[scenario_matrix] the overlay does not mutate non-daemon steps", () => {
  const steps = [startDaemonStep(), otherStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: { OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "k", EXA_MATRIX_OPENCODE: "1" },
    binOnPath: () => true,
  });
  const submit = runs[0].steps.find((s) => s.id === "submit-request");
  assert(submit, "non-daemon step must survive");
  assertEquals(submit.env, undefined, "non-daemon steps must not gain matrix env");
});

Deno.test("[scenario_matrix] a cell whose requires_bin is absent is recorded skipped, not failed", () => {
  const steps = [startDaemonStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: { OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "k", EXA_MATRIX_OPENCODE: "1" },
    binOnPath: (bin) => bin === "claude", // opencode absent
  });
  const opencodeCells = runs.filter((r) => r.cell.tool === "opencode");
  for (const r of opencodeCells) {
    assertEquals(r.status, "skip");
    assert(r.skipReason?.includes("opencode"), `skip reason should name the missing binary; got ${r.skipReason}`);
  }
});

Deno.test("[scenario_matrix] a cell whose requires_key is unset is recorded skipped, not failed", () => {
  const steps = [startDaemonStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: { EXA_MATRIX_OPENCODE: "1" }, // no keys
    binOnPath: () => true,
  });
  const keyed = runs.filter((r) => r.cell.requires_key);
  for (const r of keyed) {
    assertEquals(r.status, "skip");
    assert(r.skipReason?.includes(r.cell.requires_key ?? ""), `skip reason should name the missing key`);
  }
});

Deno.test("[scenario_matrix] an opencode cell whose requires_optin is unset is recorded skipped", () => {
  const steps = [startDaemonStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: { OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "k" }, // no EXA_MATRIX_OPENCODE
    binOnPath: () => true,
  });
  const opencodeCells = runs.filter((r) => r.cell.tool === "opencode");
  for (const r of opencodeCells) {
    assertEquals(r.status, "skip");
    assert(r.skipReason?.includes("EXA_MATRIX_OPENCODE"), `skip reason should name the missing opt-in`);
  }
});

Deno.test("[scenario_matrix] a scenario WITHOUT a matrix block parses unchanged (backward-compat)", async () => {
  // The matrix field is .optional() and .strict()-compatible; a scenario that omits it must
  // still parse. Load an existing non-matrix provider_live scenario and confirm matrix is absent.
  const raw = await Deno.readTextFile(
    join(
      REPO_ROOT,
      "tests/scenario_framework/scenarios/provider_live/session_delegate_plan_review_live.yaml",
    ),
  );
  const parsed = ScenarioSchema.parse(parseYaml(raw));
  assertEquals(parsed.matrix, undefined, "a matrix-less scenario must parse with matrix undefined");
});

Deno.test("[scenario_matrix] GAP-7: EXA_CONFIG_PATH is the daemon's real config source (apps/daemon/main.ts reads it)", async () => {
  // The full live config-swap is proven in Step 5's provider-live cutover with a real daemon.
  // Here we assert the wiring path exists: the expander overlays EXA_CONFIG_PATH, and the
  // daemon's bootstrap reads exactly that env var to choose the config it loads.
  const mainSrc = await Deno.readTextFile(join(REPO_ROOT, "apps", "daemon", "main.ts"));
  assert(
    mainSrc.includes('Deno.env.get("EXA_CONFIG_PATH")'),
    "apps/daemon/main.ts must read EXA_CONFIG_PATH so the matrix overlay swaps the loaded config",
  );
});
