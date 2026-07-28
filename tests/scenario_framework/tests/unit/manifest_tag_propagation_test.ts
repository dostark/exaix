/**
 * @module ScenarioFrameworkManifestTagPropagationTest
 * @path tests/scenario_framework/tests/unit/manifest_tag_propagation_test.ts
 * @description Phase 142 Step 7 — a scenario's tags must reach the eval history, or every
 *   tag-grouped report is empty.
 *
 *   `exactl eval report --group-by subsystem` returned "No matching summary data found" after a
 *   full 72-scenario cutover. `IRunManifest.tags` was declared and commented "propagated to eval
 *   history", `history_writer.ts:136` reads `manifest.tags`, and `summarizeByTag` filters on them —
 *   but `buildRunManifest` never set the field, so every row in `eval_runs` had an empty `tags`
 *   column. The whole subsystem taxonomy this phase introduced was invisible to the one report
 *   built to consume it.
 *
 *   A field declared, read by two consumers, and written by nobody: the same shape as
 *   `flow_fixture` in Step 15 and `portals:` in Step 13. Nothing failed, because an empty group is
 *   indistinguishable from "no runs yet".
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/runner/history_writer.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { buildRunManifest } from "../../runner/synthetic_runner.ts";
import { ExecutionOutcome, ExecutionStateStatus } from "../../runner/modes.ts";
import { ScenarioExecutionMode, ScenarioStepType } from "../../schema/step_schema.ts";
import type { ILoadedScenario } from "../../runner/scenario_loader.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";

function loadedScenario(tags: string[]): ILoadedScenario {
  // Built through the real schema so the fixture cannot drift from what the loader produces.
  const scenario = ScenarioSchema.parse({
    schema_version: "1.0.0",
    id: "tagged-scenario",
    title: "Tagged",
    pack: "mcp_tools_extended",
    tags,
    request_fixture: "fixtures/requests/x.md",
    mode_support: [ScenarioExecutionMode.AUTO],
    portals: [],
    // The schema requires at least one step; the manifest under test does not read them.
    steps: [{
      id: "noop",
      type: ScenarioStepType.SHELL,
      command: "true",
      input_criteria: [],
      output_criteria: [],
    }],
  });
  return {
    scenario,
    steps: [],
    requestFixture: { relativePath: "x.md", absolutePath: "/tmp/x.md", content: "x" },
    absoluteScenarioPath: "/tmp/x.yaml",
  };
}

async function manifestFor(tags: string[]) {
  return await buildRunManifest({
    loadedScenario: loadedScenario(tags),
    stepOutcomes: [],
    mode: ScenarioExecutionMode.AUTO,
    runResult: {
      status: ExecutionStateStatus.COMPLETED,
      outcome: ExecutionOutcome.SUCCESS,
      executedStepIds: [],
      nextStepIndex: 0,
    },
    workspaceRoot: "/tmp",
    stepRowidWindows: new Map(),
  });
}

Deno.test("[manifest-tags] the scenario's tags reach the manifest", async () => {
  const manifest = await manifestFor(["subsystem:tools", "entity:read_file", "smoke"]);

  assertEquals(manifest.tags, ["subsystem:tools", "entity:read_file", "smoke"]);
});

Deno.test("[manifest-tags] a subsystem tag survives, which is what --group-by subsystem needs", async () => {
  const manifest = await manifestFor(["roundtrip", "subsystem:mcp-client"]);

  assert(
    manifest.tags?.includes("subsystem:mcp-client"),
    `--group-by subsystem filters on this tag; got ${JSON.stringify(manifest.tags)}`,
  );
});

Deno.test("[manifest-tags] an untagged scenario yields an empty list, not undefined noise", async () => {
  const manifest = await manifestFor([]);
  assertEquals(manifest.tags, []);
});

Deno.test("[manifest-tags] the pack is still recorded alongside", async () => {
  // `summarizeByTag` accepts a `pack` filter, so both have to survive together.
  const manifest = await manifestFor(["subsystem:tools"]);
  assertEquals(manifest.pack, "mcp_tools_extended");
});
