/**
 * @module tests/scenario_framework/tests/plan_amendment_scenario_test
 * @path tests/scenario_framework/tests/plan_amendment_scenario_test.ts
 * @description Integration test for the Plan Amendment Safety Gate scenario.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { withRepoRoot } from "@exaix/testing";
import { bootstrapWorkspace, logOutput, skipInCI, stopDaemon } from "./helpers/scenario_test_utils.ts";

Deno.test({
  name: "Scenario: Plan Amendment Lifecycle",
  ignore: skipInCI,
  async fn(_t) {
    await withRepoRoot(async () => {
      const runnerPath = join(Deno.cwd(), "tests/scenario_framework/runner/main.ts");
      const tempRoot = await Deno.makeTempDir({ prefix: "exaix-scenario-test-" });
      const workspacePath = tempRoot;

      await stopDaemon();
      await bootstrapWorkspace(workspacePath);

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

      logOutput(output, errorOutput);

      if (code !== 0) {
        console.error("Scenario failed with exit code:", code);
      }

      assertEquals(code, 0, `Scenario should pass successfully. Output: ${output.substring(0, 500)}`);
      assert(output.includes("plan-amendment-lifecycle"), "Output should contain scenario name");
      assert(
        output.includes("success") || output.includes("PASSED"),
        "Output should contain success indicator",
      );
    });
  },
});
