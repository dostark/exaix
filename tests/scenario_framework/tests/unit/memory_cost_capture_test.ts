/**
 * @module MemoryCostCaptureTest
 * @path tests/scenario_framework/tests/unit/memory_cost_capture_test.ts
 * @description Confirms the EXISTING `duration_ms` step-result field is populated for a
 * real memory-replay `run-script` step (Phase 148 Step 5's Actions: reuse, add no new
 * field) — via a real `executeScenarioStep` call, the same production step-execution
 * path every scenario run uses, not a synthetic count. `tokens_prompt`/`tracked_cost_usd`
 * are absent (no LLM call happened) — confirming absence is tolerated, not an error, per
 * this step's own Planned Tests text.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/memory_efficiency.ts, tests/scenario_framework/runner/step_executor.ts]
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { executeScenarioStep } from "../../runner/step_executor.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";
import type { IScenarioStep } from "../../schema/step_schema.ts";

const FRAMEWORK_ROOT = fromFileUrl(new URL("../..", import.meta.url));
const DENO_CONFIG_PATH = fromFileUrl(new URL("../../../../deno.json", import.meta.url));

Deno.test("[MemoryCostCapture] a real memory-replay run-script step populates duration_ms; no LLM fields, tolerated", async () => {
  const workspaceRoot = await Deno.makeTempDir();
  try {
    const step: IScenarioStep = {
      id: "memory-replay-cost-capture-check",
      type: ScenarioStepType.RUN_SCRIPT,
      command: "deno",
      args: [
        "run",
        "-A",
        "--config",
        DENO_CONFIG_PATH,
        join(FRAMEWORK_ROOT, "scripts", "run_memory_replay.ts"),
        workspaceRoot,
        join(FRAMEWORK_ROOT, "fixtures", "memory", "info-extraction-basic", "task.json"),
      ],
      continue_on_failure: false,
      input_criteria: [],
      output_criteria: [],
    };

    const result = await executeScenarioStep({ step, cwd: workspaceRoot });

    assertEquals(result.exitCode, 0);
    assertEquals(typeof result.durationMs, "number");
    assertEquals(result.durationMs >= 0, true);
    // A plain run-script step never touches an LLM provider, so no token/cost fields exist
    // on the raw execution result at all (they are computed separately, from journal
    // payloads, only for steps that DID call one) — this IS the "absent, tolerated" case.
    assertEquals("tokens_prompt" in result, false);
    assertEquals("tracked_cost_usd" in result, false);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});
