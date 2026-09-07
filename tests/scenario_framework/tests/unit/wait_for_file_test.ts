/**
 * @module ScenarioFrameworkWaitForFileTest
 * @path tests/scenario_framework/tests/unit/wait_for_file_test.ts
 * @description RED-first tests for the `wait-for-file` step's optional `failure_glob`
 *   early-exit. Root cause traced live (swe-fix-bug-null-guard-cli-all, --cell opencode,
 *   sandbox mrudl4zj-f6d1059f): a rejected plan writes to Workspace/Rejected/ and marks
 *   the request failed within ~1 minute, but `wait-for-file` only polls for the SUCCESS
 *   glob (`**\/Plans/*_plan.md`) and burns its full timeout_sec (180s) before reporting a
 *   generic "Timeout after 180s" — hiding the real, already-known rejection reason.
 *   `failure_glob` lets a step opt into polling a second pattern and failing fast (with
 *   the rejection file's content surfaced) the moment it appears.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { executeScenarioStep } from "../../runner/step_executor.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";

async function withTempWorkspace(fn: (ws: string) => Promise<void>): Promise<void> {
  const ws = await Deno.makeTempDir({ prefix: "wait-for-file-" });
  try {
    await fn(ws);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
}

Deno.test("[wait_for_file] succeeds as soon as the success glob matches (no failure_glob set, backward-compat)", async () => {
  await withTempWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "Plans"), { recursive: true });
    await Deno.writeTextFile(join(ws, "Plans", "request-abc_plan.md"), "plan body");

    const result = await executeScenarioStep({
      step: {
        id: "wait-for-plan",
        type: ScenarioStepType.WAIT_FOR_FILE,
        args: ["**/Plans/*_plan.md"],
        timeout_sec: 5,
        input_criteria: [],
        output_criteria: [],
        continue_on_failure: false,
      },
      cwd: ws,
    });

    assertEquals(result.exitCode, 0);
    assertStringIncludes(result.stdout, "request-abc_plan.md");
  });
});

Deno.test("[wait_for_file] fails fast when failure_glob matches before the success glob ever does", async () => {
  await withTempWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "Workspace", "Rejected"), { recursive: true });
    await Deno.writeTextFile(
      join(ws, "Workspace", "Rejected", "request-340a896b_rejected.md"),
      "Rejected Plan: Invalid enum value... received 'edit_file'",
    );

    const startedAt = Date.now();
    const result = await executeScenarioStep({
      step: {
        id: "wait-for-plan",
        type: ScenarioStepType.WAIT_FOR_FILE,
        args: ["**/Plans/*_plan.md"],
        failure_glob: "**/Workspace/Rejected/*_rejected.md",
        timeout_sec: 180,
        input_criteria: [],
        output_criteria: [],
        continue_on_failure: false,
      },
      cwd: ws,
    });
    const elapsedMs = Date.now() - startedAt;

    assertEquals(result.exitCode, 1);
    assertStringIncludes(result.stderr, "request-340a896b_rejected.md");
    assertStringIncludes(result.stderr, "edit_file");
    // Must fail on the next poll tick, not burn the full 180s timeout_sec budget.
    assert(elapsedMs < 10_000, `expected fast failure, took ${elapsedMs}ms`);
  });
});

Deno.test("[wait_for_file] min_matches requires a new match count, not just any existing match", async () => {
  await withTempWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "Archive"), { recursive: true });
    // One archive already exists from an earlier step — a bare "found.length > 0" check would
    // pass instantly on this stale match without ever observing THIS step's own archive.
    await Deno.writeTextFile(join(ws, "Archive", "request-aaa_plan.md"), "plan body");

    const resultPtr: { value?: Awaited<ReturnType<typeof executeScenarioStep>> } = {};
    const run = executeScenarioStep({
      step: {
        id: "wait-for-second-archive",
        type: ScenarioStepType.WAIT_FOR_FILE,
        args: ["**/Archive/*_plan.md"],
        min_matches: 2,
        timeout_sec: 5,
        input_criteria: [],
        output_criteria: [],
        continue_on_failure: false,
      },
      cwd: ws,
    }).then((r) => {
      resultPtr.value = r;
      return r;
    });

    // Confirm it hasn't resolved on the stale single match.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assertEquals(resultPtr.value, undefined, "should still be waiting for the second archive");

    await Deno.writeTextFile(join(ws, "Archive", "request-bbb_plan.md"), "plan body");
    const result = await run;

    assertEquals(result.exitCode, 0);
  });
});

Deno.test("[wait_for_file] success glob still wins if both patterns exist (success checked first)", async () => {
  await withTempWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "Plans"), { recursive: true });
    await Deno.mkdir(join(ws, "Workspace", "Rejected"), { recursive: true });
    await Deno.writeTextFile(join(ws, "Plans", "request-abc_plan.md"), "plan body");
    await Deno.writeTextFile(
      join(ws, "Workspace", "Rejected", "request-other_rejected.md"),
      "unrelated earlier rejection",
    );

    const result = await executeScenarioStep({
      step: {
        id: "wait-for-plan",
        type: ScenarioStepType.WAIT_FOR_FILE,
        args: ["**/Plans/*_plan.md"],
        failure_glob: "**/Workspace/Rejected/*_rejected.md",
        timeout_sec: 5,
        input_criteria: [],
        output_criteria: [],
        continue_on_failure: false,
      },
      cwd: ws,
    });

    assertEquals(result.exitCode, 0);
  });
});
