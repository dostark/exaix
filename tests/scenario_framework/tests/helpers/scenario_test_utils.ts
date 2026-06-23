/**
 * @module ScenarioTestUtils
 * @path tests/scenario_framework/tests/helpers/scenario_test_utils.ts
 * @description Shared setup utilities for scenario framework integration tests.
 *   Extracts common boilerplate (daemon cleanup, workspace bootstrap, config copy)
 *   to reduce duplication across scenario test files.
 * @architectural-layer Testing
 */
import { join } from "@std/path";
import { ensureDir } from "@std/fs";

export const skipInCI = !!Deno.env.get("CI") || !!Deno.env.get("GITHUB_ACTIONS");

export async function stopDaemon(): Promise<void> {
  try {
    const stopDaemon = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", join(Deno.cwd(), "apps/exactl/src/exactl.ts"), "daemon", "stop"],
      stdout: "null",
      stderr: "null",
    });
    await stopDaemon.output();
  } catch {
    // Ignore — daemon may not have been running
  }
}

export async function bootstrapWorkspace(workspacePath: string): Promise<void> {
  await ensureDir(workspacePath);
  await ensureDir(join(workspacePath, "Requests"));

  const cpMigrations = new Deno.Command("cp", {
    args: ["-r", join(Deno.cwd(), "migrations"), workspacePath],
  });
  await cpMigrations.output();

  const cpBlueprints = new Deno.Command("cp", {
    args: ["-r", join(Deno.cwd(), "Blueprints"), workspacePath],
  });
  await cpBlueprints.output();

  await Deno.copyFile(
    join(Deno.cwd(), "tests/scenario_framework/exa.config.toml"),
    join(workspacePath, "exa.config.toml"),
  );
}

export function logOutput(output: string, errorOutput: string): void {
  console.log("=== Scenario stdout ===");
  console.log(output);
  console.log("=== Scenario stderr ===");
  console.log(errorOutput);
  console.log("=== End output ===");
}
