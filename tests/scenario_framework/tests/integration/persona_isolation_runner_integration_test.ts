/**
 * @module PersonaIsolationRunnerIntegrationTest
 * @path tests/scenario_framework/tests/integration/persona_isolation_runner_integration_test.ts
 * @description Exercises the persona operator manifest-to-argv-to-report dry-run path.
 * @architectural-layer Test
 * @related-files [scripts/run_persona_isolation.ts, tests/scenario_framework/runner/persona_isolation_arm.ts]
 */

import { assertEquals, assertFalse } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { createMockConfig } from "@exaix/testing";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "../../../..");

Deno.test("[PersonaIsolationRunner] --dry-run writes report input, uses discrete argv, and cleans overlays", async () => {
  const root = await Deno.makeTempDir({ prefix: "persona-runner-" });
  try {
    await Deno.mkdir(join(root, "Blueprints", "Agents"), { recursive: true });
    await Deno.mkdir(join(root, "Memory", "persona-overlays"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "Blueprints", "Agents", "coder.md"),
      "---\nagent_role: coder\nmodel_size: L\ncapabilities: [testing]\ndefault_skills: [tdd]\npermitted_tools: [read_file]\n---\nPersona\n",
    );
    const outputPath = join(root, "Memory", "report-input.json");
    const manifestPath = join(root, "manifest.json");
    await Deno.writeTextFile(
      manifestPath,
      JSON.stringify({
        config: createMockConfig(root),
        agentRoleId: "coder",
        scenarioIds: ["swe-write-tests-uncovered", "swe-fix-bug-null-guard"],
        trials: 3,
        provider: "mock",
        model: "test-model",
        runnerCell: "opencode",
        sourceBlueprintAlias: "@Blueprints/Agents/coder.md",
        overlayRootAlias: "@Memory/persona-overlays",
        reportOutputAlias: "@Memory/report-input.json",
      }),
    );
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "scripts/run_persona_isolation.ts", "--dry-run", manifestPath],
      cwd: REPO_ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const output = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(output.armComparisons.length, 2);
    assertEquals(output.executionPlan.length, 3);
    assertEquals(output.executionPlan[0].argv.includes("--scenario"), true);
    const cellIndex = output.executionPlan[0].argv.indexOf("--cell");
    assertEquals(output.executionPlan[0].argv[cellIndex + 1], "opencode");
    assertEquals(output.executionPlan[0].env.EXA_LLM_PROVIDER, "mock");
    assertFalse(await exists(join(root, "Memory", "persona-overlays", "coder")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[PersonaIsolationRunner] --dry-run rejects a scenario id absent from the live catalog", async () => {
  const root = await Deno.makeTempDir({ prefix: "persona-runner-invalid-" });
  try {
    await Deno.mkdir(join(root, "Blueprints", "Agents"), { recursive: true });
    await Deno.mkdir(join(root, "Memory", "persona-overlays"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "Blueprints", "Agents", "coder.md"),
      "---\nagent_role: coder\n---\nPersona\n",
    );
    const manifestPath = join(root, "manifest.json");
    await Deno.writeTextFile(
      manifestPath,
      JSON.stringify({
        config: createMockConfig(root),
        agentRoleId: "coder",
        scenarioIds: ["swe-does-not-exist", "swe-fix-bug-null-guard"],
        trials: 3,
        provider: "mock",
        model: "test-model",
        runnerCell: "opencode",
        sourceBlueprintAlias: "@Blueprints/Agents/coder.md",
        overlayRootAlias: "@Memory/persona-overlays",
        reportOutputAlias: "@Memory/report-input.json",
      }),
    );
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "scripts/run_persona_isolation.ts", "--dry-run", manifestPath],
      cwd: REPO_ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.success, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
