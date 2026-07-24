/**
 * @module SweCorpusPipelineTest
 * @path tests/scenario_framework/tests/integration/swe_corpus_pipeline_test.ts
 * @description Pipeline integration test: runs a full task scenario through the
 *   synthetic runner (no real LLM, no daemon), verifying the loop mechanics —
 *   request resolution, plan approval, execution steps, scoring, and cleanup.
 *   Proves the corpus pipeline is not broken by schema drift or event renames
 *   without spending tokens. Phase 141 Step 7.
 * @architectural-layer Test
 */

import { assertEquals, assertExists } from "@std/assert";
import { ScenarioExecutionMode, ScenarioStepType } from "../../schema/step_schema.ts";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";
import { withSyntheticTestEnv, writeSyntheticScenario } from "./synthetic_test_helpers.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";

Deno.test("[SweCorpusPipeline] full task loop completes with populated scoring channels", async () => {
  await withSyntheticTestEnv(async ({ frameworkHome, workspaceRoot, outputDir }) => {
    // Create a fixture directory with reference.patch
    const fixtureDir = `${workspaceRoot}/fixture`;
    await Deno.mkdir(fixtureDir, { recursive: true });
    await Deno.writeTextFile(
      `${fixtureDir}/reference.patch`,
      `diff --git a/test.txt b/test.txt
new file mode 100644
index 0000000..3b2b5e3
--- /dev/null
+++ b/test.txt
@@ -0,0 +1 @@
+fixed
`,
    );
    await Deno.writeTextFile(
      `${fixtureDir}/task.json`,
      JSON.stringify({
        base_ref: "0000000000000000000000000000000000000001",
        scoped_test_cmd: "test -f test.txt",
        family: "task:bug-fix",
        difficulty: "S",
        title: "Pipeline test task",
      }),
    );

    const scenarioPath = await writeSyntheticScenario({
      frameworkHome,
      scenarioId: "swe-pipeline-test",
      tags: ["swe", "provider-live", "pipeline-stub"],
      schemaVersion: SCHEMA_VERSION,
      steps: [
        {
          id: "setup-worktree",
          type: ScenarioStepType.SHELL,
          command: "sh",
          args: [
            "-c",
            `cp -r "${fixtureDir}" "${workspaceRoot}/worktree" && cd "${workspaceRoot}/worktree" && git init -q && git add -A && git -c user.email=t@t.com -c user.name=t commit -q -m 'init'`,
          ],
          outputCriteriaLines: ['    - id: "worktree-ready"', '      kind: "command-exit-code"', "      equals: 0"],
        },
        {
          id: "apply-reference-patch",
          type: ScenarioStepType.SHELL,
          command: "sh",
          args: ["-c", `cd "${workspaceRoot}/worktree" && git apply "${fixtureDir}/reference.patch"`],
          outputCriteriaLines: ['    - id: "patch-applied"', '      kind: "command-exit-code"', "      equals: 0"],
        },
        {
          id: "run-scoped-tests",
          type: ScenarioStepType.SHELL,
          command: "sh",
          args: ["-c", `cd "${workspaceRoot}/worktree" && test -f test.txt`],
          outputCriteriaLines: [
            '    - id: "tests-pass"',
            '      kind: "command-exit-code"',
            "      equals: 0",
            "      score_weight: 0.3",
          ],
        },
      ],
    });

    const result = await runSyntheticScenario({
      frameworkHome,
      scenarioPath,
      workspaceRoot,
      outputDir,
      mode: ScenarioExecutionMode.AUTO,
    });

    assertExists(result.manifest);
    assertEquals(result.manifest.steps.length, 3);
    for (const step of result.manifest.steps) {
      assertEquals(step.executionStatus, "passed");
      assertEquals(step.score, 1);
    }
    assertEquals(result.manifest.suite_score, 1);
    assertEquals(result.manifest.scenarioId, "swe-pipeline-test");
    assertEquals(result.manifest.outcome, "success");
  });
});
