/**
 * @module SweTasksPackE2eTest
 * @path tests/scenario_framework/tests/integration/swe_tasks_pack_e2e_test.ts
 * @description Validates swe_tasks pack scenarios: loads all 5 YAML files, verifies
 * schema/tag metadata, and confirms the matrix cell(s) are correctly SKIPPED (not run, not
 * failed) when their prerequisite is absent — the pack is provider-live only (no CI-safe
 * mock cell, per the cutover's design), so this is the CI-safety contract that keeps a
 * key-less/tool-less CI run from attempting a real daemon/provider call. cell_id
 * manifest->history->SQLite propagation is covered generically (no swe_tasks dependency)
 * by matrix_cell_recording_test.ts; a real end-to-end run against a live cell is exercised
 * manually/nightly per the provider-live convention (README §6.3). The hybrid
 * "-cli-delegate"/"-opencode-cli-delegate" variants (real-API planning + CLI-delegated
 * editing only) were retired: they only added diagnostic isolation over the full-API and
 * all-CLI variants, at a maintenance cost judged not worth it for this pack. The former
 * "-claude-all"/"-opencode-all" scenario pair was later folded into one
 * "-cli-all" scenario with a 2-cell matrix (claude-code, opencode) — the runner only ever
 * executes the FIRST runnable cell, so exercising both tools requires the explicit --cell
 * selection (matrix_expander.ts's selectedCell) proven by the SELECTED_CELL_CASES below.
 */

import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { loadScenarioFromYamlFile } from "../../runner/scenario_loader.ts";
import { MATRIX_START_DAEMON_STEP_ID, resolveRunnableSteps } from "../../runner/matrix_expander.ts";
import { materializeCellConfig } from "../../runner/synthetic_runner.ts";

const FRAMEWORK_HOME = resolve(new URL(".", import.meta.url).pathname, "../..");
const CLI_ALL_SCENARIO_PATH = "scenarios/swe_tasks/fix-bug-null-guard-cli-all.yaml";

Deno.test("[SweTasksPackE2e] all swe_tasks scenarios load from catalog with correct metadata", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const sweScenarios = catalog.filter((s) => s.pack === "swe_tasks");
  assertEquals(sweScenarios.length, 5);

  const ids = sweScenarios.map((s) => s.id).sort();
  assertEquals(ids, [
    "swe-add-feature-endpoint",
    "swe-fix-bug-null-guard",
    "swe-fix-bug-null-guard-cli-all",
    "swe-refactor-extract-function",
    "swe-write-tests-uncovered",
  ]);

  // No CI-safe mock cell in this pack (the cutover dropped mock entirely per design) — every
  // scenario is provider-live and must carry the tag CI profiles use to exclude it by default.
  for (const s of sweScenarios) {
    assertEquals(s.tags.includes("provider-live"), true);
  }
});

/**
 * Resolves every matrix-cell group for a scenario under the given env + optional --cell
 * selection. `binOnPath` defaults to "always present" — these tests exercise selection/skip
 * LOGIC (env keys, --cell filtering), not whether `claude`/`opencode` happen to be installed
 * on the machine running the suite; a live check against the real PATH belongs in a
 * provider-live scenario run, not this deterministic unit-level test.
 */
async function resolveCells(
  scenarioPath: string,
  env: Record<string, string>,
  selectedCell?: string,
  binOnPath: (bin: string) => boolean = () => true,
) {
  const loaded = await loadScenarioFromYamlFile({ frameworkHome: FRAMEWORK_HOME, scenarioPath });
  return resolveRunnableSteps(loaded.scenario, {
    env,
    binOnPath,
    configBaseDir: resolve(FRAMEWORK_HOME, "..", ".."),
    selectedCell,
  });
}

/** Resolves a single-cell scenario's one matrix cell — for fix-bug-null-guard.yaml only. */
async function resolveSingleCell(scenarioPath: string, env: Record<string, string>) {
  const groups = await resolveCells(scenarioPath, env);
  assertEquals(groups.length, 1);
  return groups[0];
}

Deno.test("[SweTasksPackE2e] the single matrix cell is SKIPPED (not run) when ANTHROPIC_API_KEY is absent", async () => {
  const cell = await resolveSingleCell("scenarios/swe_tasks/fix-bug-null-guard.yaml", {});
  assertEquals(cell.status, "skip");
  assertEquals(cell.skipReason?.includes("ANTHROPIC_API_KEY"), true);
});

Deno.test("[SweTasksPackE2e] the single matrix cell is runnable when ANTHROPIC_API_KEY is set", async () => {
  const cell = await resolveSingleCell("scenarios/swe_tasks/fix-bug-null-guard.yaml", {
    ANTHROPIC_API_KEY: "test-key",
  });
  assertEquals(cell.status, "run");
  assertEquals(cell.cell?.provider, "anthropic");
});

interface ISelectedCellCase {
  name: string;
  selectedCell: string;
  otherTool: string;
}

// Proves --cell (matrix_expander.ts's selectedCell) actually narrows the cli-all scenario's
// 2-cell matrix to exactly the named tool, recording the other cell skipped (not silently
// dropped) — this is what lets one merged scenario file cover both CLI-delegate tools without
// the runner's "only the first runnable cell executes" limitation silently starving one of them.
const SELECTED_CELL_CASES: ISelectedCellCase[] = [
  {
    name: "[SweTasksPackE2e] --cell claude-code selects only the claude-code cell",
    selectedCell: "claude-code",
    otherTool: "opencode",
  },
  {
    name: "[SweTasksPackE2e] --cell opencode selects only the opencode cell",
    selectedCell: "opencode",
    otherTool: "claude-code",
  },
];

for (const { name, selectedCell, otherTool } of SELECTED_CELL_CASES) {
  Deno.test(name, async () => {
    const groups = await resolveCells(CLI_ALL_SCENARIO_PATH, {}, selectedCell);
    assertEquals(groups.length, 2);

    const selected = groups.find((g) => g.cell?.tool === selectedCell);
    assertEquals(selected?.status, "run");
    assertEquals(selected?.cell?.provider, "$CELL_PROVIDER");

    const other = groups.find((g) => g.cell?.tool === otherTool);
    assertEquals(other?.status, "skip");
    assertEquals(other?.skipReason?.includes(selectedCell), true);
  });
}

Deno.test("[SweTasksPackE2e] no --cell selection on the cli-all scenario still parses both cells (backward-compat)", async () => {
  const groups = await resolveCells(CLI_ALL_SCENARIO_PATH, {});
  assertEquals(groups.length, 2);
  assertEquals(groups.map((g) => g.cell?.tool).sort(), ["claude-code", "opencode"]);
});

interface IConfigAgreementCase {
  name: string;
  cellTool: string;
  expectedProvider: string;
  expectedModel: string;
}

// End-to-end proof that $CELL_PROVIDER/$CELL_MODEL — the placeholders the scenario YAML uses
// instead of a hardcoded provider/model string — actually resolve to the real config's [ai]
// block via materializeCellConfig, for each cell's REAL config file (not a synthetic fixture;
// materialize_cell_config_test.ts covers the extraction mechanism itself).
const CONFIG_AGREEMENT_CASES: IConfigAgreementCase[] = [
  {
    name: "[SweTasksPackE2e] the claude-code cell's config resolves $CELL_PROVIDER/$CELL_MODEL to claude-cli",
    cellTool: "claude-code",
    expectedProvider: "claude-cli",
    expectedModel: "claude-sonnet-5",
  },
  {
    name: "[SweTasksPackE2e] the opencode cell's config resolves $CELL_PROVIDER/$CELL_MODEL to opencode-cli",
    cellTool: "opencode",
    expectedProvider: "opencode-cli",
    expectedModel: "opencode/deepseek-v4-flash-free",
  },
];

for (const { name, cellTool, expectedProvider, expectedModel } of CONFIG_AGREEMENT_CASES) {
  Deno.test(name, async () => {
    const loaded = await loadScenarioFromYamlFile({
      frameworkHome: FRAMEWORK_HOME,
      scenarioPath: CLI_ALL_SCENARIO_PATH,
    });
    const cellConfigPath = loaded.scenario.matrix?.cells.find((c) => c.tool === cellTool)?.config;
    const daemonStep = loaded.steps.find((s) => s.id === MATRIX_START_DAEMON_STEP_ID);

    const workspaceRoot = await Deno.makeTempDir({ prefix: "swe-tasks-config-agreement-" });
    try {
      const steps = [
        {
          ...daemonStep!,
          env: { ...daemonStep!.env, EXA_CONFIG_PATH: resolve(FRAMEWORK_HOME, "..", "..", cellConfigPath!) },
        },
      ];
      const materialized = await materializeCellConfig(steps, {
        workspaceRoot,
        worktreePath: "/repo-under-test",
      });
      assertEquals(materialized.aiProvider, expectedProvider);
      assertEquals(materialized.aiModel, expectedModel);
    } finally {
      await Deno.remove(workspaceRoot, { recursive: true });
    }
  });
}
