/**
 * @module SkillReviewApproveScenarioTest
 * @path tests/scenario_framework/tests/integration/skill_review_approve_scenario_test.ts
 * @description Runs the `skill-review-approve` scenario through the real scenario runner, real `exactl`
 *   processes and a real daemon with the mock provider. Every scenario step must pass, and the journal
 *   must show that the revision the daemon injected is the active revision the approval published.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/skill_eval/skill-review-approve.yaml, tests/scenario_framework/runner/synthetic_runner.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";

const FRAMEWORK_HOME = new URL("../../", import.meta.url).pathname;
const SCENARIO_PATH = "scenarios/skill_eval/skill-review-approve.yaml";
const REVIEWED_REVISION = "2beced21-b31f-5fe8-b100-5dc8256b2fbe";

interface IActivityRow {
  action_type: string;
  trace_id: string | null;
  payload: string;
}

Deno.test({
  name: "[skill-review-approve] the scenario passes and the injected revision is the approved active one",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const workspaceRoot = await Deno.makeTempDir({ prefix: "skill-review-ws-" });
    const outputDir = await Deno.makeTempDir({ prefix: "skill-review-out-" });
    try {
      const run = await runSyntheticScenario({
        frameworkHome: FRAMEWORK_HOME,
        scenarioPath: SCENARIO_PATH,
        workspaceRoot,
        outputDir,
        mode: ScenarioExecutionMode.AUTO,
        env: {},
      });
      assert(run.manifest.steps.length > 0);
      const failed = run.manifest.steps.filter((step: { executionStatus: string }) =>
        step.executionStatus !== "passed"
      );
      assertEquals(failed.length, 0, JSON.stringify(failed));

      const db = new DatabaseService(new ConfigService(join(workspaceRoot, "exa.config.toml")).getAll());
      try {
        const rows = await db.preparedAll<IActivityRow>(
          "SELECT action_type, trace_id, payload FROM activity ORDER BY rowid",
        );
        const approved = rows.filter((row) => row.action_type === "skills.approved").map((row) =>
          JSON.parse(row.payload)
        );
        assertEquals(approved.length, 1);
        assertEquals(approved[0].reviewed_revision_id, REVIEWED_REVISION);
        assert(approved[0].active_revision_id !== REVIEWED_REVISION, "approval publishes a new active revision");

        const usage = await db.preparedAll<{ skill_name: string; revision_id: string; trace_id: string }>(
          "SELECT skill_name, revision_id, trace_id FROM skill_usage WHERE skill_name = ?",
          ["review-flow"],
        );
        assertEquals(usage.length, 1, "the request injected the skill exactly once");
        assertEquals(usage[0].revision_id, approved[0].active_revision_id);
      } finally {
        await db.close();
      }
    } finally {
      await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
      await Deno.remove(outputDir, { recursive: true }).catch(() => {});
    }
  },
});
