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
import { Database } from "@db/sqlite";
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

/** Writes a minimal real journal.db under `ws/.exa/` — the same lightweight fixture shape
 *  journal_assert_test.ts already establishes for this layer, not the full production schema. */
async function withJournalWorkspace(
  rows: Array<[string, string, string]>,
  fn: (ws: string) => Promise<void>,
): Promise<void> {
  await withTempWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, ".exa"), { recursive: true });
    const db = new Database(join(ws, ".exa", "journal.db"));
    db.prepare(
      "CREATE TABLE activity (rowid INTEGER PRIMARY KEY, trace_id TEXT, action_type TEXT, payload TEXT)",
    ).run();
    for (const [traceId, actionType, payload] of rows) {
      db.prepare("INSERT INTO activity (trace_id, action_type, payload) VALUES (?, ?, ?)").run(
        traceId,
        actionType,
        payload,
      );
    }
    db.close();
    await fn(ws);
  });
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

// General early-exit on a definitive daemon-side request failure — unlike a rejected-plan
// failure_glob match, no file is written for this failure class, so wait-for-file previously
// burned its full timeout_sec (root cause traced live: a 140s real failure cost 30 minutes).

Deno.test("[wait_for_file] fails fast on request.failed for the current trace, with no failure_glob configured", async () => {
  await withJournalWorkspace(
    [
      ["trace-current", "request.created", "{}"],
      ["trace-current", "request.failed", JSON.stringify({ error: "CLI delegate 'claude' exited with code 1" })],
    ],
    async (ws) => {
      const startedAt = Date.now();
      const result = await executeScenarioStep({
        step: {
          id: "wait-for-plan",
          type: ScenarioStepType.WAIT_FOR_FILE,
          args: ["**/Plans/*_plan.md"],
          timeout_sec: 180,
          input_criteria: [],
          output_criteria: [],
          continue_on_failure: false,
        },
        cwd: ws,
        traceBaselineRowid: 0,
      });
      const elapsedMs = Date.now() - startedAt;

      assertEquals(result.exitCode, 1);
      assertStringIncludes(result.stderr, "request.failed");
      assertStringIncludes(result.stderr, "exited with code 1");
      assert(elapsedMs < 10_000, `expected fast failure, took ${elapsedMs}ms`);
    },
  );
});

Deno.test("[wait_for_file] fails fast on request.skipped for the current trace", async () => {
  await withJournalWorkspace(
    [
      ["trace-current", "request.created", "{}"],
      ["trace-current", "request.skipped", JSON.stringify({ reason: "processing returned null" })],
    ],
    async (ws) => {
      const result = await executeScenarioStep({
        step: {
          id: "wait-for-plan",
          type: ScenarioStepType.WAIT_FOR_FILE,
          args: ["**/Plans/*_plan.md"],
          timeout_sec: 180,
          input_criteria: [],
          output_criteria: [],
          continue_on_failure: false,
        },
        cwd: ws,
        traceBaselineRowid: 0,
      });

      assertEquals(result.exitCode, 1);
      assertStringIncludes(result.stderr, "request.skipped");
    },
  );
});

Deno.test("[wait_for_file] a benign request.skipped ('already has status') never false-positives a wait — the file watcher's own re-scan of an already-processed request, not a failure", async () => {
  await withJournalWorkspace(
    [
      ["trace-current", "request.created", "{}"],
      [
        "trace-current",
        "request.skipped",
        JSON.stringify({ reason: "Request already has status 'planned'" }),
      ],
    ],
    async (ws) => {
      await Deno.mkdir(join(ws, "Plans"), { recursive: true });
      await Deno.writeTextFile(join(ws, "Plans", "request-current_plan.md"), "plan body");

      const result = await executeScenarioStep({
        step: {
          id: "wait-for-plan",
          type: ScenarioStepType.WAIT_FOR_FILE,
          args: ["**/Plans/*_plan.md"],
          timeout_sec: 180,
          input_criteria: [],
          output_criteria: [],
          continue_on_failure: false,
        },
        cwd: ws,
        traceBaselineRowid: 0,
      });

      assertEquals(result.exitCode, 0);
    },
  );
});

Deno.test("[wait_for_file] a PRIOR trace's request.failed (stale, shared sandbox) never false-positives the CURRENT trace's wait", async () => {
  await withJournalWorkspace(
    [
      ["trace-prior", "request.created", "{}"],
      ["trace-prior", "request.failed", JSON.stringify({ error: "unrelated earlier failure" })],
      ["trace-current", "request.created", "{}"],
    ],
    async (ws) => {
      const result = await executeScenarioStep({
        step: {
          id: "wait-for-plan",
          type: ScenarioStepType.WAIT_FOR_FILE,
          args: ["**/Plans/*_plan.md"],
          timeout_sec: 1,
          input_criteria: [],
          output_criteria: [],
          continue_on_failure: false,
        },
        cwd: ws,
        // Baseline set past the prior trace's rows — resolveCurrentTrace must pick trace-current.
        traceBaselineRowid: 2,
      });

      // No plan file was ever written and trace-current has no failure of its own — this must
      // time out normally (generic timeout path), never claim a false request.failed/skipped match
      // against the unrelated prior trace.
      assertEquals(result.exitCode, 1);
      assertEquals(result.stderr.includes("request.failed") || result.stderr.includes("request.skipped"), false);
      assertStringIncludes(result.stderr, "Timeout after");
    },
  );
});

Deno.test("[wait_for_file] succeeds normally when the request has neither failed nor produced its file yet, then the file lands", async () => {
  await withJournalWorkspace(
    [
      ["trace-current", "request.created", "{}"],
    ],
    async (ws) => {
      const resultPtr: { value?: Awaited<ReturnType<typeof executeScenarioStep>> } = {};
      const run = executeScenarioStep({
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
        traceBaselineRowid: 0,
      }).then((r) => {
        resultPtr.value = r;
        return r;
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      assertEquals(resultPtr.value, undefined, "should still be waiting — no failure, no file yet");

      await Deno.mkdir(join(ws, "Plans"), { recursive: true });
      await Deno.writeTextFile(join(ws, "Plans", "request-current_plan.md"), "plan body");
      const result = await run;

      assertEquals(result.exitCode, 0);
    },
  );
});
