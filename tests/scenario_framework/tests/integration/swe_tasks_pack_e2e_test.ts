/**
 * @module SweTasksPackE2eTest
 * @path tests/scenario_framework/tests/integration/swe_tasks_pack_e2e_test.ts
 * @description Validates swe_tasks pack scenarios: loads all 8 YAML files, verifies
 * schema/tag metadata, and confirms the matrix cell is correctly SKIPPED (not run, not
 * failed) when ANTHROPIC_API_KEY is absent — the pack is provider-live only (no CI-safe
 * mock cell, per the cutover's design), so this is the CI-safety contract that keeps a
 * key-less CI run from attempting a real daemon/Anthropic call. cell_id
 * manifest->history->SQLite propagation is covered generically (no swe_tasks dependency)
 * by matrix_cell_recording_test.ts; a real end-to-end run against a live Anthropic cell is
 * exercised manually/nightly per the provider-live convention (README §6.3).
 */

import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { loadScenarioFromYamlFile } from "../../runner/scenario_loader.ts";
import { binIsOnPath, resolveRunnableSteps } from "../../runner/matrix_expander.ts";

const FRAMEWORK_HOME = resolve(new URL(".", import.meta.url).pathname, "../..");

Deno.test("[SweTasksPackE2e] all swe_tasks scenarios load from catalog with correct metadata", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const sweScenarios = catalog.filter((s) => s.pack === "swe_tasks");
  assertEquals(sweScenarios.length, 8);

  const ids = sweScenarios.map((s) => s.id).sort();
  assertEquals(ids, [
    "swe-add-feature-endpoint",
    "swe-fix-bug-null-guard",
    "swe-fix-bug-null-guard-claude-all",
    "swe-fix-bug-null-guard-cli-delegate",
    "swe-fix-bug-null-guard-opencode-all",
    "swe-fix-bug-null-guard-opencode-cli-delegate",
    "swe-refactor-extract-function",
    "swe-write-tests-uncovered",
  ]);

  // No CI-safe mock cell in this pack (the cutover dropped mock entirely per design) — every
  // scenario is provider-live and must carry the tag CI profiles use to exclude it by default.
  for (const s of sweScenarios) {
    assertEquals(s.tags.includes("provider-live"), true);
  }
});

/** Resolves a scenario's single matrix cell under the given env, as every case below does. */
async function resolveSingleCell(scenarioPath: string, env: Record<string, string>) {
  const loaded = await loadScenarioFromYamlFile({ frameworkHome: FRAMEWORK_HOME, scenarioPath });
  const groups = resolveRunnableSteps(loaded.scenario, {
    env,
    binOnPath: (bin) => binIsOnPath(bin),
    configBaseDir: resolve(FRAMEWORK_HOME, "..", ".."),
  });
  assertEquals(groups.length, 1);
  return groups[0];
}

interface ISkipCase {
  name: string;
  scenarioPath: string;
}

const SKIP_WHEN_KEY_ABSENT_CASES: ISkipCase[] = [
  {
    name: "[SweTasksPackE2e] the single matrix cell is SKIPPED (not run) when ANTHROPIC_API_KEY is absent",
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard.yaml",
  },
  {
    name: "[SweTasksPackE2e] the cli-delegate scenario's matrix cell is SKIPPED when ANTHROPIC_API_KEY is absent",
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard-cli-delegate.yaml",
  },
  {
    name:
      "[SweTasksPackE2e] the opencode cli-delegate scenario's matrix cell is SKIPPED when ANTHROPIC_API_KEY is absent",
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard-opencode-cli-delegate.yaml",
  },
];

for (const { name, scenarioPath } of SKIP_WHEN_KEY_ABSENT_CASES) {
  Deno.test(name, async () => {
    const cell = await resolveSingleCell(scenarioPath, {});
    assertEquals(cell.status, "skip");
    assertEquals(cell.skipReason?.includes("ANTHROPIC_API_KEY"), true);
  });
}

interface IRunWithKeyCase {
  name: string;
  scenarioPath: string;
  expectedProvider: string;
}

const RUNS_WHEN_KEY_SET_CASES: IRunWithKeyCase[] = [
  {
    name: "[SweTasksPackE2e] the single matrix cell is runnable when ANTHROPIC_API_KEY is set",
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard.yaml",
    expectedProvider: "anthropic",
  },
  {
    name: "[SweTasksPackE2e] the cli-delegate scenario's matrix cell is runnable when ANTHROPIC_API_KEY is set",
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard-cli-delegate.yaml",
    expectedProvider: "anthropic",
  },
  {
    name:
      "[SweTasksPackE2e] the opencode cli-delegate scenario's matrix cell is runnable when ANTHROPIC_API_KEY is set",
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard-opencode-cli-delegate.yaml",
    expectedProvider: "anthropic",
  },
];

for (const { name, scenarioPath, expectedProvider } of RUNS_WHEN_KEY_SET_CASES) {
  Deno.test(name, async () => {
    const cell = await resolveSingleCell(scenarioPath, { ANTHROPIC_API_KEY: "test-key" });
    assertEquals(cell.status, "run");
    assertEquals(cell.cell?.provider, expectedProvider);
  });
}

interface IRunsNoKeyCase {
  name: string;
  scenarioPath: string;
  expectedProvider: string;
}

// No ANTHROPIC_API_KEY (or any key) in env — every part of these scenarios runs through a
// subscription-billed CLI-delegate provider, so they must NOT be skipped for a missing key.
const RUNS_WITH_NO_KEY_REQUIRED_CASES: IRunsNoKeyCase[] = [
  {
    name:
      "[SweTasksPackE2e] the opencode-all scenario's matrix cell is runnable with no key required (requires_key omitted)",
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard-opencode-all.yaml",
    expectedProvider: "opencode-cli",
  },
  {
    name:
      "[SweTasksPackE2e] the claude-all scenario's matrix cell is runnable with no key required (requires_key omitted)",
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard-claude-all.yaml",
    expectedProvider: "claude-cli",
  },
];

for (const { name, scenarioPath, expectedProvider } of RUNS_WITH_NO_KEY_REQUIRED_CASES) {
  Deno.test(name, async () => {
    const cell = await resolveSingleCell(scenarioPath, {});
    assertEquals(cell.status, "run");
    assertEquals(cell.cell?.provider, expectedProvider);
  });
}
