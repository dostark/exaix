/**
 * @module MemoryPendingDryRunTest
 * @path apps/exactl/tests/memory_pending_dry_run_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Tests memory proposal dry-run behavior for the CLI proposal approve flow.
 */
import "./helpers/set_test_mode.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ExaCtlSubNoun } from "../src/exactl_constants.ts";
import { withCapturedSink } from "./helpers/captured_output.ts";
import { withTestMod } from "./helpers/test_utils.ts";

Deno.test("memory proposal list --eligible routes to pendingList with eligible flag", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.memoryCurationCommands.pendingList = (eligible?: boolean) => {
      called = eligible === true;
      return Promise.resolve([]);
    };

    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", ExaCtlSubNoun.PROPOSAL, "list", "--eligible", "-o", "json"]);
    });

    assert(called);
    assertEquals(JSON.parse(out), []);
  });
});

Deno.test("memory proposal approve --dry-run lists the eligible proposals and approves nothing", async () => {
  await withTestMod(async (mod, ctx) => {
    let dryRun = false;
    let approved = false;
    ctx.memoryCurationCommands.pendingApproveDryRun = () => {
      dryRun = true;
      return Promise.resolve([]);
    };
    ctx.memoryCurationCommands.pendingApprove = () => {
      approved = true;
      return Promise.reject(new Error("must not approve"));
    };

    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", ExaCtlSubNoun.PROPOSAL, "approve", "--dry-run", "-o", "json"]);
    });

    assert(dryRun);
    assertEquals(approved, false);
    assertStringIncludes(out, "[]");
  });
});
