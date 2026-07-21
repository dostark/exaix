/**
 * @module ScenarioFrameworkMaterializeCellConfigTest
 * @path tests/scenario_framework/tests/unit/materialize_cell_config_test.ts
 * @description Phase 127 Step 8 (LIVE-RT) — RED-first tests for the runner's cell-config
 *   materialization. For a runnable matrix cell whose `start-daemon` step points
 *   EXA_CONFIG_PATH at a dogfood preset (which carries __DOGFOOD_ROOT__ / __WORKTREE_PATH__),
 *   the runner must write a sentinel-resolved copy into the workspace and rewrite the step's
 *   EXA_CONFIG_PATH to that copy — so the booted daemon roots at the workspace and mounts the
 *   intended portal. Presets without sentinels (or steps without EXA_CONFIG_PATH) are untouched.
 *   Also extracts the preset's own [ai].provider/[ai].model so scenario YAML steps can
 *   reference $CELL_PROVIDER/$CELL_MODEL instead of hardcoding a provider/model string that
 *   must be kept in sync with the config by hand — the config TOML stays the single source
 *   of truth for which provider/model a cell actually runs.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/runner/matrix_expander.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { materializeCellConfig } from "../../runner/synthetic_runner.ts";
import { MATRIX_START_DAEMON_STEP_ID } from "../../runner/matrix_expander.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";
import type { IScenarioStep } from "../../schema/step_schema.ts";

const PRESET = [
  "[system]",
  'root = "__DOGFOOD_ROOT__"',
  "[[portals]]",
  'target_path = "__WORKTREE_PATH__"',
  "[session_delegate.provider]",
  'name = "openrouter"',
].join("\n");

function daemonStep(configPath: string): IScenarioStep {
  return {
    id: MATRIX_START_DAEMON_STEP_ID,
    type: ScenarioStepType.EXACTL,
    command: "daemon",
    args: ["start"],
    env: { EXA_CONFIG_PATH: configPath },
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  } as IScenarioStep;
}

Deno.test("[materialize_cell_config] writes a sentinel-resolved config into the workspace and repoints EXA_CONFIG_PATH at it", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "materialize-cell-" });
  const presetPath = join(workspaceRoot, "preset.toml");
  try {
    await Deno.writeTextFile(presetPath, PRESET);

    const steps = [daemonStep(presetPath)];
    const result = await materializeCellConfig(steps, {
      workspaceRoot,
      worktreePath: "/repo-under-test",
    });

    const daemon = result.steps.find((s) => s.id === MATRIX_START_DAEMON_STEP_ID);
    assert(daemon, "start-daemon step survives");
    const newConfigPath = daemon.env?.EXA_CONFIG_PATH;
    assert(
      newConfigPath && newConfigPath !== presetPath,
      "EXA_CONFIG_PATH must point at the materialized copy, not the raw preset",
    );

    const written = await Deno.readTextFile(newConfigPath);
    assertStringIncludes(written, `root = "${workspaceRoot}"`);
    assertStringIncludes(written, 'target_path = "/repo-under-test"');
    assert(!written.includes("__DOGFOOD_ROOT__"), "no root sentinel may remain");
    assert(!written.includes("__WORKTREE_PATH__"), "no worktree sentinel may remain");
    // The materialized config must be the workspace's canonical exa.config.toml — the SAME file
    // add-portal / restart / submit-request load — so the daemon and the registered portal agree.
    assertEquals(newConfigPath, join(workspaceRoot, "exa.config.toml"));
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[materialize_cell_config] a step list without a start-daemon EXA_CONFIG_PATH is returned unchanged", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "materialize-cell-noop-" });
  try {
    const plain = {
      id: "submit-request",
      type: ScenarioStepType.EXACTL,
      command: "request",
      args: ["--file", "x"],
      continue_on_failure: false,
      input_criteria: [],
      output_criteria: [],
    } as IScenarioStep;
    const result = await materializeCellConfig([plain], {
      workspaceRoot,
      worktreePath: "/repo",
    });
    assertEquals(result.steps, [plain]);
    assertEquals(result.aiProvider, undefined);
    assertEquals(result.aiModel, undefined);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[materialize_cell_config] a preset with no sentinels still materializes a workspace copy (idempotent, boot-safe)", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "materialize-cell-clean-" });
  const presetPath = join(workspaceRoot, "clean.toml");
  try {
    await Deno.writeTextFile(presetPath, '[system]\nroot = "."\n');
    const result = await materializeCellConfig([daemonStep(presetPath)], {
      workspaceRoot,
      worktreePath: "/repo",
    });
    const daemon = result.steps.find((s) => s.id === MATRIX_START_DAEMON_STEP_ID);
    const written = await Deno.readTextFile(daemon!.env!.EXA_CONFIG_PATH!);
    assertStringIncludes(written, 'root = "."');
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[materialize_cell_config] extracts [ai].provider and [ai].model from the preset for $CELL_PROVIDER/$CELL_MODEL expansion", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "materialize-cell-ai-" });
  const presetPath = join(workspaceRoot, "preset.toml");
  try {
    const presetWithAi = [
      "[system]",
      'root = "__DOGFOOD_ROOT__"',
      "[ai]",
      'provider = "claude-cli"',
      'model = "claude-sonnet-5"',
    ].join("\n");
    await Deno.writeTextFile(presetPath, presetWithAi);

    const result = await materializeCellConfig([daemonStep(presetPath)], {
      workspaceRoot,
      worktreePath: "/repo",
    });

    assertEquals(result.aiProvider, "claude-cli");
    assertEquals(result.aiModel, "claude-sonnet-5");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[materialize_cell_config] a preset without an [ai] block yields undefined aiProvider/aiModel", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "materialize-cell-no-ai-" });
  const presetPath = join(workspaceRoot, "preset.toml");
  try {
    await Deno.writeTextFile(presetPath, '[system]\nroot = "."\n');
    const result = await materializeCellConfig([daemonStep(presetPath)], {
      workspaceRoot,
      worktreePath: "/repo",
    });
    assertEquals(result.aiProvider, undefined);
    assertEquals(result.aiModel, undefined);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});
