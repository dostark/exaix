/**
 * @module MemoryPendingDryRunTest
 * @path tests/cli/memory_pending_dry_run_test.ts
 * @description Tests memory pending dry-run behavior for the CLI pending approve flow.
 */
import "./helpers/set_test_mode.ts";
import { assert, assertEquals } from "@std/assert";
import { MemoryStatus } from "@exaix/core/status";
import type { OutputFormat } from "@exaix/cli/types/memory_types.ts";
import { captureConsoleOutput, withTestMod } from "./helpers/test_utils.ts";

Deno.test("memory pending list --eligible routes to pendingList with eligible flag", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.memoryCommands.pendingList = (eligible?: boolean, _format?: OutputFormat) => {
      called = eligible === true;
      return Promise.resolve("Eligible proposals");
    };

    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", MemoryStatus.PENDING, "list", "--eligible"]);
    });

    assert(called);
    assertEquals(out.includes("Eligible proposals"), true);
  });
});

Deno.test("memory pending approve --dry-run routes to pendingApprove with dryRun true", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.memoryCommands.pendingApprove = (proposalId?: string, dryRun?: boolean) => {
      called = dryRun === true && proposalId === undefined;
      return Promise.resolve("Dry run preview");
    };

    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", MemoryStatus.PENDING, "approve", "--dry-run"]);
    });

    assert(called);
    assertEquals(out.includes("Dry run preview"), true);
  });
});
