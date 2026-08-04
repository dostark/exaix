/**
 * @module SweTasksPackE2eTest
 * @path tests/scenario_framework/tests/integration/swe_tasks_pack_e2e_test.ts
 * @description Validates swe_tasks pack scenarios: loads all non-legacy YAML files,
 *   verifies schema/tag metadata, and confirms the multi-cell matrix resolves
 *   correctly. CLI-delegate cell selection proves --cell filtering works for
 *   both claude-code and opencode tools.
 */

import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { loadScenarioFromYamlFile } from "../../runner/scenario_loader.ts";
import { MATRIX_START_DAEMON_STEP_ID, resolveRunnableSteps } from "../../runner/matrix_expander.ts";
import { materializeCellConfig } from "../../runner/synthetic_runner.ts";

const FRAMEWORK_HOME = resolve(new URL(".", import.meta.url).pathname, "../..");
const MULTI_CELL_SCENARIO = "scenarios/swe_tasks/fix-bug-null-guard.yaml";

const EXPECTED_SW_TASKS_IDS = [
  "swe-add-api-routes-constants",
  "swe-add-batch-operations",
  "swe-add-feature-endpoint",
  "swe-add-feature-endpoint-cli-all-legacy",
  "swe-add-feature-endpoint-flow-feature-development",
  "swe-add-feature-endpoint-flow-refactoring",
  "swe-add-feature-endpoint-free",
  "swe-add-feature-endpoint-legacy",
  "swe-add-search-feature",
  "swe-async-ordering-bug",
  "swe-docstring-storage-module",
  "swe-explain-request-flow",
  "swe-explain-request-flow-codeanalyst",
  "swe-explain-request-flow-codeanalyst-preprune",
  "swe-extract-sort-utility",
  "swe-fix-bug-null-guard",
  "swe-fix-bug-null-guard-cli-all-legacy",
  "swe-fix-bug-null-guard-free",
  "swe-fix-bug-null-guard-legacy",
  "swe-injection-sanitisation",
  "swe-injection-sanitisation-free",
  "swe-map-dependencies",
  "swe-path-traversal-storage",
  "swe-refactor-extract-function",
  "swe-refactor-extract-function-cli-all-legacy",
  "swe-refactor-extract-function-free",
  "swe-refactor-extract-function-legacy",
  "swe-refactor-extract-function-placebo",
  "swe-rename-done-to-completed",
  "swe-rename-priority-type",
  "swe-write-api-readme",
  "swe-write-coverage-for-priority",
  "swe-write-regression-test-for-summary",
  "swe-write-tests-uncovered",
  "swe-write-tests-uncovered-cli-all-legacy",
  "swe-write-tests-uncovered-legacy",
  "swe-write-tests-uncovered-testengineer",
];

Deno.test("[SweTasksPackE2e] all swe_tasks scenarios load from catalog with correct metadata", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const sweScenarios = catalog.filter((s) => s.pack === "swe_tasks");
  assertEquals(sweScenarios.length, EXPECTED_SW_TASKS_IDS.length);

  const ids = sweScenarios.map((s) => s.id).sort();
  assertEquals(ids, EXPECTED_SW_TASKS_IDS);

  for (const s of sweScenarios) {
    assertEquals(s.tags.includes("provider-live"), true);
  }
});

/** Resolves every matrix-cell group for a scenario. */
async function resolveGroups(scenarioPath: string, env: Record<string, string>, selectedCell?: string) {
  const loaded = await loadScenarioFromYamlFile({ frameworkHome: FRAMEWORK_HOME, scenarioPath });
  return resolveRunnableSteps(loaded.scenario, {
    env,
    binOnPath: () => true,
    configBaseDir: resolve(FRAMEWORK_HOME, "..", ".."),
    selectedCell,
  });
}

Deno.test("[SweTasksPackE2e] multi-cell scenario has all 3 cell entries", async () => {
  const groups = await resolveGroups(MULTI_CELL_SCENARIO, {});
  const tools = groups.map((g) => g.cell?.tool).sort();
  assertEquals(tools, ["claude-code", "exactl", "opencode"]);
});

Deno.test("[SweTasksPackE2e] --cell claude-code selects only the claude-code cell", async () => {
  const groups = await resolveGroups(MULTI_CELL_SCENARIO, {}, "claude-code");
  const selected = groups.find((g) => g.cell?.tool === "claude-code");
  assertEquals(selected?.status, "run");
  assertEquals(selected?.cell?.provider, "$CELL_PROVIDER");

  const other = groups.find((g) => g.cell?.tool === "opencode");
  assertEquals(other?.status, "skip");
  assertEquals(other?.skipReason?.includes("claude-code"), true);
});

Deno.test("[SweTasksPackE2e] --cell opencode selects only the opencode cell", async () => {
  const groups = await resolveGroups(MULTI_CELL_SCENARIO, {}, "opencode");
  const selected = groups.find((g) => g.cell?.tool === "opencode");
  assertEquals(selected?.status, "run");
  assertEquals(selected?.cell?.provider, "$CELL_PROVIDER");

  const other = groups.find((g) => g.cell?.tool === "claude-code");
  assertEquals(other?.status, "skip");
  assertEquals(other?.skipReason?.includes("opencode"), true);
});

interface IConfigAgreementCase {
  name: string;
  cellTool: string;
  expectedProvider: string;
  expectedModel: string;
}

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
    expectedModel: "opencode-go/deepseek-v4-flash",
  },
];

for (const { name, cellTool, expectedProvider, expectedModel } of CONFIG_AGREEMENT_CASES) {
  Deno.test(name, async () => {
    const loaded = await loadScenarioFromYamlFile({
      frameworkHome: FRAMEWORK_HOME,
      scenarioPath: MULTI_CELL_SCENARIO,
    });
    const cellConfigPath = loaded.scenario.matrix?.cells.find((c) => c.tool === cellTool)?.config;
    const daemonStep = loaded.steps.find((s) => s.id === MATRIX_START_DAEMON_STEP_ID);

    const workspaceRoot = await Deno.makeTempDir({ prefix: "swe-tasks-config-agreement-" });
    try {
      const steps = [{
        ...daemonStep!,
        env: { ...daemonStep!.env, EXA_CONFIG_PATH: resolve(FRAMEWORK_HOME, "..", "..", cellConfigPath!) },
      }];
      const materialized = await materializeCellConfig(steps, { workspaceRoot, worktreePath: "/repo-under-test" });
      assertEquals(materialized.aiProvider, expectedProvider);
      assertEquals(materialized.aiModel, expectedModel);
    } finally {
      await Deno.remove(workspaceRoot, { recursive: true });
    }
  });
}
