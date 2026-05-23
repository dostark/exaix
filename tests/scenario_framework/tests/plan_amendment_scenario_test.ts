/**
 * @module tests/scenario_framework/tests/plan_amendment_scenario_test
 * @path tests/scenario_framework/tests/plan_amendment_scenario_test.ts
 * @description Integration test for the Plan Amendment Safety Gate scenario.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { withRepoRoot } from "../../helpers/repo_root.ts";

// This test is flaky in CI due to race conditions with other tests and
// environmental differences (timing, resource constraints, daemon lifecycle).
// It is skipped in CI and can be run locally for debugging.
// TODO: Re-enable once the scenario framework is hardened for CI execution.
const skipInCI = !!Deno.env.get("CI") || !!Deno.env.get("GITHUB_ACTIONS");

Deno.test({
  name: "Scenario: Plan Amendment Lifecycle",
  ignore: skipInCI,
  async fn(_t) {
    await withRepoRoot(async () => {
      // This test will run the scenario using the scenario framework runner
      const runnerPath = join(Deno.cwd(), "tests/scenario_framework/runner/main.ts");
      const tempRoot = await Deno.makeTempDir({ prefix: "exaix-scenario-test-" });
      const workspacePath = tempRoot; // The deploy script expects the root, but let's just use it as the workspace

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

      // Copy Portal Fixture to Workspace to isolate it from main repo git
      const portalFixturePath = join(workspacePath, "fixtures/portals/simple_repo");
      await ensureDir(join(workspacePath, "fixtures/portals"));
      const cpPortal = new Deno.Command("cp", {
        args: [
          "-r",
          join(Deno.cwd(), "tests/scenario_framework/fixtures/portals/simple_repo"),
          join(workspacePath, "fixtures/portals/"),
        ],
      });
      await cpPortal.output();

      // Initialize git in the portal fixture so it has its own git root
      const gitInit = new Deno.Command("git", {
        args: ["init"],
        cwd: portalFixturePath,
      });
      await gitInit.output();
      const gitAdd = new Deno.Command("git", {
        args: ["add", "."],
        cwd: portalFixturePath,
      });
      await gitAdd.output();
      const gitCommit = new Deno.Command("git", {
        args: ["commit", "-m", "initial commit"],
        cwd: portalFixturePath,
        env: {
          GIT_AUTHOR_NAME: "Test User",
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "Test User",
          GIT_COMMITTER_EMAIL: "test@example.com",
        },
      });
      await gitCommit.output();

      // Copy exa.config.toml
      await Deno.copyFile(
        join(Deno.cwd(), "tests/scenario_framework/exa.config.toml"),
        join(workspacePath, "exa.config.toml"),
      );

      const outputDir = join(Deno.cwd(), "tests/scenario_framework/output/plan-amendment");
      await ensureDir(outputDir);

      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          runnerPath,
          "--scenario",
          "plan-amendment-lifecycle",
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

      // Always log output for CI diagnostics
      console.log("=== Scenario stdout ===");
      console.log(output);
      console.log("=== Scenario stderr ===");
      console.log(errorOutput);
      console.log("=== End output ===");

      if (code !== 0) {
        console.error("Scenario failed with exit code:", code);
      }

      assertEquals(code, 0, `Scenario should pass successfully. Output: ${output.substring(0, 500)}`);
      assert(output.includes("plan-amendment-lifecycle"), "Output should contain scenario name");
      assert(
        output.includes("success") || output.includes("PASSED"),
        "Output should contain success indicator",
      ); // Scenario runner outputs 'success' or 'PASSED'
    });
  },
});
