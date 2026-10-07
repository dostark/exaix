/**
 * @module ForeignSkillFallbackScenarioTest
 * @path tests/scenario_framework/tests/integration/foreign_skill_fallback_scenario_test.ts
 * @description Runs the `foreign-skill-fallback` scenario through the real scenario runner, real `exactl`
 *   processes and a real daemon with the mock provider. A sidecar-free folder is approved by its reviewed
 *   revision, matched from its description alone, and the journal names the description trigger source
 *   with the exact confidence while the usage row names the approved revision.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/skill_eval/foreign-skill-fallback.yaml, packages/core/src/skills/skill_snapshot.ts]
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";

const FRAMEWORK_HOME = new URL("../../", import.meta.url).pathname;
const SCENARIO_PATH = "scenarios/skill_eval/foreign-skill-fallback.yaml";
const REVIEWED_REVISION = "e61c1688-73d9-57a8-96c9-b4ccddc8e6e0";
const SKILL = "changelog-writer";
/** Two or more matched fallback keywords saturate both the keyword and the request text scores. */
const EXPECTED_CONFIDENCE = 1;

interface IActivityRow {
  action_type: string;
  payload: string;
}

Deno.test({
  name: "[foreign-skill-fallback] the scenario passes and the description-matched skill injects its approved revision",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const workspaceRoot = await Deno.makeTempDir({ prefix: "foreign-fallback-ws-" });
    const outputDir = await Deno.makeTempDir({ prefix: "foreign-fallback-out-" });
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
        const rows = await db.preparedAll<IActivityRow>("SELECT action_type, payload FROM activity ORDER BY rowid");
        const match = rows.filter((row) => row.action_type === "skills.match_completed").map((row) =>
          JSON.parse(row.payload)
        ).find((payload) => payload.confidence_by_name?.[SKILL] !== undefined);
        assert(match, "the daemon journaled a match for the foreign skill");
        assertEquals(match.triggers_source_by_name[SKILL], "description");
        assertAlmostEquals(match.confidence_by_name[SKILL], EXPECTED_CONFIDENCE);

        const approved = rows.filter((row) => row.action_type === "skills.approved").map((row) =>
          JSON.parse(row.payload)
        );
        assertEquals(approved.length, 1);
        assertEquals(approved[0].reviewed_revision_id, REVIEWED_REVISION);

        const usage = await db.preparedAll<{ revision_id: string }>(
          "SELECT revision_id FROM skill_usage WHERE skill_name = ?",
          [SKILL],
        );
        assertEquals(usage.length, 1);
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
