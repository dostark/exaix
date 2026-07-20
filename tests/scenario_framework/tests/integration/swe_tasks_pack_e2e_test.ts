/**
 * @module SweTasksPackE2eTest
 * @path tests/scenario_framework/tests/integration/swe_tasks_pack_e2e_test.ts
 * @description Validates swe_tasks pack scenarios: loads all 6 YAML files, verifies
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
  assertEquals(sweScenarios.length, 6);

  const ids = sweScenarios.map((s) => s.id).sort();
  assertEquals(ids, [
    "swe-add-feature-endpoint",
    "swe-fix-bug-null-guard",
    "swe-fix-bug-null-guard-cli-delegate",
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

Deno.test("[SweTasksPackE2e] the single matrix cell is SKIPPED (not run) when ANTHROPIC_API_KEY is absent", async () => {
  const loaded = await loadScenarioFromYamlFile({
    frameworkHome: FRAMEWORK_HOME,
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard.yaml",
  });

  const groups = resolveRunnableSteps(loaded.scenario, {
    env: {}, // ANTHROPIC_API_KEY absent
    binOnPath: (bin) => binIsOnPath(bin),
    configBaseDir: resolve(FRAMEWORK_HOME, "..", ".."),
  });

  assertEquals(groups.length, 1);
  assertEquals(groups[0].status, "skip");
  assertEquals(groups[0].skipReason?.includes("ANTHROPIC_API_KEY"), true);
});

Deno.test("[SweTasksPackE2e] the single matrix cell is runnable when ANTHROPIC_API_KEY is set", async () => {
  const loaded = await loadScenarioFromYamlFile({
    frameworkHome: FRAMEWORK_HOME,
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard.yaml",
  });

  const groups = resolveRunnableSteps(loaded.scenario, {
    env: { ANTHROPIC_API_KEY: "test-key" },
    binOnPath: (bin) => binIsOnPath(bin),
    configBaseDir: resolve(FRAMEWORK_HOME, "..", ".."),
  });

  assertEquals(groups.length, 1);
  assertEquals(groups[0].status, "run");
  assertEquals(groups[0].cell?.provider, "anthropic");
});

Deno.test("[SweTasksPackE2e] the cli-delegate scenario's matrix cell is SKIPPED when ANTHROPIC_API_KEY is absent", async () => {
  const loaded = await loadScenarioFromYamlFile({
    frameworkHome: FRAMEWORK_HOME,
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard-cli-delegate.yaml",
  });

  const groups = resolveRunnableSteps(loaded.scenario, {
    env: {},
    binOnPath: (bin) => binIsOnPath(bin),
    configBaseDir: resolve(FRAMEWORK_HOME, "..", ".."),
  });

  assertEquals(groups.length, 1);
  assertEquals(groups[0].status, "skip");
  assertEquals(groups[0].skipReason?.includes("ANTHROPIC_API_KEY"), true);
});

Deno.test("[SweTasksPackE2e] the cli-delegate scenario's matrix cell is runnable when ANTHROPIC_API_KEY is set", async () => {
  const loaded = await loadScenarioFromYamlFile({
    frameworkHome: FRAMEWORK_HOME,
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard-cli-delegate.yaml",
  });

  const groups = resolveRunnableSteps(loaded.scenario, {
    env: { ANTHROPIC_API_KEY: "test-key" },
    binOnPath: (bin) => binIsOnPath(bin),
    configBaseDir: resolve(FRAMEWORK_HOME, "..", ".."),
  });

  assertEquals(groups.length, 1);
  assertEquals(groups[0].status, "run");
  assertEquals(groups[0].cell?.provider, "anthropic");
});

Deno.test("[SweTasksPackE2e] the opencode cli-delegate scenario's matrix cell is SKIPPED when ANTHROPIC_API_KEY is absent", async () => {
  const loaded = await loadScenarioFromYamlFile({
    frameworkHome: FRAMEWORK_HOME,
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard-opencode-cli-delegate.yaml",
  });

  const groups = resolveRunnableSteps(loaded.scenario, {
    env: {},
    binOnPath: (bin) => binIsOnPath(bin),
    configBaseDir: resolve(FRAMEWORK_HOME, "..", ".."),
  });

  assertEquals(groups.length, 1);
  assertEquals(groups[0].status, "skip");
  assertEquals(groups[0].skipReason?.includes("ANTHROPIC_API_KEY"), true);
});

Deno.test("[SweTasksPackE2e] the opencode cli-delegate scenario's matrix cell is runnable when ANTHROPIC_API_KEY is set", async () => {
  const loaded = await loadScenarioFromYamlFile({
    frameworkHome: FRAMEWORK_HOME,
    scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard-opencode-cli-delegate.yaml",
  });

  const groups = resolveRunnableSteps(loaded.scenario, {
    env: { ANTHROPIC_API_KEY: "test-key" },
    binOnPath: (bin) => binIsOnPath(bin),
    configBaseDir: resolve(FRAMEWORK_HOME, "..", ".."),
  });

  assertEquals(groups.length, 1);
  assertEquals(groups[0].status, "run");
  assertEquals(groups[0].cell?.provider, "anthropic");
});
