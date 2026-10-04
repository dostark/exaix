/**
 * @module PortalKnowledgeStrategiesScenarioTest
 * @path tests/scenario_framework/tests/portal_knowledge_strategies_scenario_test.ts
 * @description Integration test for the Portal Knowledge Strategies scenario —
 * validates all 11 knowledge collection strategies produce correct output for
 * a portal mounted to the Exaix repo itself.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/portal_knowledge/portal-knowledge-strategies.yaml]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { withRepoRoot } from "@exaix/testing";
import { createScenarioContext, runScenario, skipSlowScenarioIntegration } from "./helpers/scenario_test_utils.ts";

const SCENARIO_PATH = join(
  import.meta.dirname!,
  "..",
  "scenarios",
  "portal_knowledge",
  "portal-knowledge-strategies.yaml",
);

Deno.test(
  "Scenario: portal-knowledge-strategies deep-structure assertion does not pin a walk-order-dependent service edge count",
  async () => {
    // The top-level `services` layer keeps five matches in walk order. It may omit the
    // package-local file. So require the edge, not a fixed count of two.
    const yaml = await Deno.readTextFile(SCENARIO_PATH);
    assert(
      !yaml.includes("expected duplicate top-level + package-local services edge"),
      "the deep-structure assertion must not expect a fixed duplicate edge count",
    );
    assert(
      yaml.includes("no services layer_contains_file edge to"),
      "the assertion must require at least one services edge to the target file",
    );
    assert(
      yaml.includes('find((pkg) => pkg.name === "triggers")'),
      "the assertion must pin the deterministic package-local triggers layer",
    );
  },
);

Deno.test({
  name: "Scenario: Portal Knowledge Strategies — all 11 strategies",
  ignore: skipSlowScenarioIntegration,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(_t) {
    await withRepoRoot(async () => {
      const { runnerPath, workspacePath } = await createScenarioContext();

      const outputDir = join(Deno.cwd(), "tests/scenario_framework/output/portal-knowledge-strategies");
      await ensureDir(outputDir);

      const { code, output } = await runScenario(runnerPath, "portal-knowledge-strategies", workspacePath, outputDir);

      if (code !== 0) {
        console.error("Scenario failed with exit code:", code);
      }

      assertEquals(code, 0, `Scenario should pass successfully. Output: ${output.substring(0, 500)}`);
      assert(
        output.includes("portal-knowledge-strategies") || output.includes("PASSED") || output.includes("success"),
        "Output should contain scenario name or success indicator",
      );
    });
  },
});
