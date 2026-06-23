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
import { bootstrapWorkspace, logOutput, skipInCI, stopDaemon } from "./helpers/scenario_test_utils.ts";

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

      await stopDaemon();
      await bootstrapWorkspace(workspacePath);

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

      logOutput(output, errorOutput);

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
