/**
 * @module ExactlEffortCliTest
 * @path apps/exactl/tests/exactl_effort_cli_test.ts
 * @description Verifies the request CLI declarations for effort/thinking per phase-197
 *   Step 2: bare --thinking sets true, --thinking auto sets "auto", --thinking false sets
 *   false, --effort auto is accepted, and an invalid effort/thinking value is rejected
 *   with an actionable error before any request file is created.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/command_builders/request_actions.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { expectExitWithLogs, withTestMod } from "./helpers/test_utils.ts";
import type { ExaCtlTestContext } from "../src/exactl.ts";
import type { IRequestOptions } from "@exaix/core/request";
import type { RequestSource } from "@exaix/core";
import { FlowInputSource, RequestPriority } from "@exaix/core";

function stubCreate(ctx: ExaCtlTestContext) {
  const received: Array<{ description: string; opts: IRequestOptions }> = [];
  ctx.requestCommands.create = (description: string, opts?: IRequestOptions) => {
    received.push({ description, opts: opts ?? {} });
    return Promise.resolve({
      filename: "/tmp/req.md",
      trace_id: "trace-1",
      priority: RequestPriority.NORMAL,
      agent_role: "a",
      path: "/tmp",
      source: "cli" as RequestSource,
      created_by: "tester",
      created: "now",
      status: "pending",
    });
  };
  return received;
}

Deno.test("request --effort auto writes effort auto into create options", async () => {
  await withTestMod(async (mod, ctx) => {
    const received = stubCreate(ctx);
    await mod.__test_command.parse([FlowInputSource.REQUEST, "Do it", "--effort", "auto"]);
    assertEquals(received.length, 1);
    assertEquals(received[0].opts.effort, "auto");
  });
});

Deno.test("request --thinking writes thinking true; --thinking auto keeps auto; --thinking false writes false", async () => {
  await withTestMod(async (mod, ctx) => {
    const received = stubCreate(ctx);
    await mod.__test_command.parse([FlowInputSource.REQUEST, "Do it", "--thinking"]);
    assertEquals(received[0].opts.thinking, true);
    await mod.__test_command.parse([FlowInputSource.REQUEST, "Do it", "--thinking", "auto"]);
    assertEquals(received[1].opts.thinking, "auto");
    await mod.__test_command.parse([FlowInputSource.REQUEST, "Do it", "--thinking", "false"]);
    assertEquals(received[2].opts.thinking, false);
  });
});

Deno.test("request --effort bogus is rejected with an actionable error", async () => {
  await withTestMod(async (mod, ctx) => {
    stubCreate(ctx);
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "Do it", "--effort", "bogus"]);
    });
    assert(
      errors.some((e) => e.includes("effort") && e.includes("low, medium, high or auto")),
      `expected an actionable effort error, got: ${errors.join(" | ")}`,
    );
  });
});

Deno.test("request --thinking maybe is rejected with an actionable error", async () => {
  await withTestMod(async (mod, ctx) => {
    stubCreate(ctx);
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "Do it", "--thinking", "maybe"]);
    });
    assert(
      errors.some((e) => e.includes("thinking") && e.includes("true, false or auto")),
      `expected an actionable thinking error, got: ${errors.join(" | ")}`,
    );
  });
});
