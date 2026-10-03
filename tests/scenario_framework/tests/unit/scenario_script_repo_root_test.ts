/**
 * @module ScenarioScriptRepoRootTest
 * @path tests/scenario_framework/tests/unit/scenario_script_repo_root_test.ts
 * @description Scenario scripts that spawn repo-relative processes resolve the repo root
 *   through EXA_SCENARIO_REPO_ROOT, so a deployed framework finds exaix-team/ and deno.json.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scripts/scenario_repo_root.ts, tests/scenario_framework/scripts/call_mcp_tool.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { resolve } from "@std/path";
import { SCENARIO_REPO_ROOT_ENV, scenarioRepoRoot } from "../../scripts/scenario_repo_root.ts";

const SCRIPTS = ["call_mcp_tool.ts", "probe_sse_liveness.ts"];

Deno.test("[script-repo-root] scenarioRepoRoot prefers EXA_SCENARIO_REPO_ROOT", async () => {
  await withEnv({ [SCENARIO_REPO_ROOT_ENV]: "/opt/checkout" }, () => {
    assertEquals(scenarioRepoRoot("/tmp/deploy/framework/scenario_framework/scripts"), "/opt/checkout");
  });
});

Deno.test("[script-repo-root] scenarioRepoRoot derives the root without the override", async () => {
  await withEnv({ [SCENARIO_REPO_ROOT_ENV]: null }, () => {
    assertEquals(scenarioRepoRoot("/repo/tests/scenario_framework/scripts"), "/repo");
  });
});

Deno.test("[script-repo-root] the MCP and SSE scripts use the shared resolver, not a walk-up", async () => {
  for (const name of SCRIPTS) {
    const text = await Deno.readTextFile(resolve(import.meta.dirname!, "..", "..", "scripts", name));
    assert(
      text.includes("scenarioRepoRoot("),
      `${name} must resolve the repo root through scenarioRepoRoot`,
    );
    assert(
      !text.includes('resolve(SCRIPTS_DIR, "..", "..", "..")'),
      `${name} must not derive the repo root with a raw walk-up`,
    );
  }
});
