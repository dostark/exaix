/**
 * @module tests/scenario_framework/tests/provider_live/model_intent_e2e_test
 * @path tests/scenario_framework/tests/provider_live/model_intent_e2e_test.ts
 * @description Integration test for the Model Intent E2E scenario — verifies
 *   that --model-size M --thinking flags resolve to a thinking-capable model.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { withRepoRoot } from "@exaix/testing";
import { bootstrapWorkspace, logOutput, skipInCI, stopDaemon } from "../helpers/scenario_test_utils.ts";

Deno.test({
  name: "Scenario: Model Intent E2E — M-size thinking routing",
  ignore: skipInCI,
  async fn(_t) {
    await withRepoRoot(async () => {
      const runnerPath = join(Deno.cwd(), "tests/scenario_framework/runner/main.ts");
      const tempRoot = await Deno.makeTempDir({ prefix: "exaix-scenario-test-" });
      const workspacePath = tempRoot;

      await stopDaemon();
      await bootstrapWorkspace(workspacePath);

      const outputDir = join(Deno.cwd(), "tests/scenario_framework/output/model-intent-e2e");
      await ensureDir(outputDir);

      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          runnerPath,
          "--scenario",
          "model-intent-e2e",
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
      assert(output.includes("model-intent-e2e"), "Output should contain scenario name");
      assert(
        output.includes("success") || output.includes("PASSED") || output.includes("All scenarios completed"),
        "Output should contain success indicator",
      );
    });
  },
});
