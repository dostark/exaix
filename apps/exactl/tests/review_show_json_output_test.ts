/**
 * @module ReviewShowJsonOutputTest
 * @path apps/exactl/tests/review_show_json_output_test.ts
 * @description Checks that review show prints the review as one JSON object with -o json, and only the diff with --diff.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/test_utils.ts]
 * @related-files [apps/exactl/src/command_builders/review_command.ts]
 */

import "./helpers/set_test_mode.ts";
import { assertEquals } from "@std/assert";
import { ReviewType } from "@exaix/core";
import { withCapturedSink } from "./helpers/captured_output.ts";
import { withTestMod } from "./helpers/test_utils.ts";

const DIFF = "diff --git a/file.txt b/file.txt\n";

Deno.test("review show -o json prints the review as one JSON object and --diff prints only the diff", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.show = () =>
      Promise.resolve({
        request_id: "req-1",
        branch: "feat/x",
        files_changed: 1,
        commits: [{ sha: "abcdef123456", message: "Initial", timestamp: "2026-01-01T00:00:00.000Z" }],
        diff: DIFF,
        trace_id: "t1",
        created_at: "2026-01-01T00:00:00.000Z",
        type: ReviewType.CODE,
        agent_role: "agent-1",
      });
    const whole = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["review", "show", "req-1", "-o", "json"]);
    });
    const review = JSON.parse(whole.out) as { request_id: string; branch: string };
    assertEquals([review.request_id, review.branch], ["req-1", "feat/x"]);
    const diffOnly = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["review", "show", "req-1", "--diff", "--json"]);
    });
    assertEquals(JSON.parse(diffOnly.out), { diff: DIFF });
  });
});
