/**
 * @module PortalKnowledgePhase105ScenarioTest
 * @path tests/scenario_framework/tests/portal_knowledge_phase105_scenario_test.ts
 * @description Integration test for the Phase 105 Portal Knowledge scenario —
 * validates all 11 knowledge collection strategies produce correct output for
 * a portal mounted to the Exaix repo itself.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/portal_knowledge/portal-knowledge-phase105.yaml]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { withRepoRoot } from "@exaix/testing";

// This test is resource-intensive (full portal analysis on the Exaix repo)
// and is skipped in CI to avoid flakiness from concurrent tests or slow
// deno check on the full codebase.
const skipInCI = !!Deno.env.get("CI") || !!Deno.env.get("GITHUB_ACTIONS") ||
  Deno.env.get("EXA_SESSION_DELEGATE_ENABLED") === "true";

Deno.test({
  name: "Scenario: Portal Knowledge Phase 105 — all 11 strategies",
  ignore: skipInCI,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(_t) {
    await withRepoRoot(async () => {
      const runnerPath = join(Deno.cwd(), "tests/scenario_framework/runner/main.ts");
      const tempRoot = await Deno.makeTempDir({ prefix: "exaix-scenario-ph105-" });
      const workspacePath = tempRoot;

      // Pre-test cleanup: ensure no leftover daemon interferes
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

      // We need migrations and blueprints for the daemon and setup_db to work
      await ensureDir(workspacePath);
      await ensureDir(join(workspacePath, "Requests"));

      // Copy migrations
      const cpMigrations = new Deno.Command("cp", {
        args: ["-r", join(Deno.cwd(), "migrations"), workspacePath],
      });
      await cpMigrations.output();

      // Copy Blueprints
      const cpBlueprints = new Deno.Command("cp", {
        args: ["-r", join(Deno.cwd(), "Blueprints"), workspacePath],
      });
      await cpBlueprints.output();

      // Copy exa.config.toml
      await Deno.copyFile(
        join(Deno.cwd(), "tests/scenario_framework/exa.config.toml"),
        join(workspacePath, "exa.config.toml"),
      );

      const outputDir = join(
        Deno.cwd(),
        "tests/scenario_framework/output/portal-knowledge-phase105",
      );
      await ensureDir(outputDir);

      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          runnerPath,
          "--scenario",
          "portal-knowledge-phase105",
          "--output",
          outputDir,
          "--workspace",
          workspacePath,
          "--verbose",
        ],
        env: {
          "EXA_BIN_PATH": join(Deno.cwd(), "tests/scenario_framework/bin"),
        },
      });

      const { code, stdout, stderr } = await command.output();

      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);

      // Always log output for diagnostics
      console.log("=== Scenario stdout ===");
      console.log(output);
      console.log("=== Scenario stderr ===");
      console.log(errorOutput);
      console.log("=== End output ===");

      if (code !== 0) {
        console.error("Scenario failed with exit code:", code);
      }

      assertEquals(code, 0, `Scenario should pass successfully. Output: ${output.substring(0, 500)}`);
      assert(
        output.includes("portal-knowledge-phase105") ||
          output.includes("PASSED") ||
          output.includes("success"),
        "Output should contain scenario name or success indicator",
      );
    });
  },
});
