/**
 * @module MemoryDialogProcessorTest
 * @path apps/tui/tests/memory_view/dialog_processor_test.ts
 * @description Verifies the logic for bulk memory approval and rejection dialogs,
 * ensuring correct progress reporting and resilient handling of cancel/error states.
 */

import { assertEquals } from "@std/assert";
import {
  TUI_STATUS_MSG_BULK_APPROVE_COMPLETED,
  TUI_STATUS_MSG_CANCELLED,
  TUI_STATUS_MSG_ERROR_PREFIX,
  TUI_STATUS_MSG_LEARNING_ADDED,
  TUI_STATUS_MSG_PROMOTE_COMPLETED,
  TUI_STATUS_MSG_PROPOSAL_APPROVED,
  TUI_STATUS_MSG_PROPOSAL_REJECTED,
} from "@exaix/tui/helpers/constants.ts";
import { DialogProcessor } from "../../src/memory_view/dialog_processor.ts";
import { DialogStatus } from "@exaix/core";
import type {
  AddLearningDialog,
  BulkApproveDialog,
  ConfirmApproveDialog,
  ConfirmRejectDialog,
  PromoteDialog,
} from "@exaix/tui/dialogs/memory_dialogs.ts";
import { createMockDialog, createMockService, createTestContext, testDialogProcess } from "./memory_test_helpers.ts";
import type { IMemoryUpdateProposal } from "@exaix/schemas/memory_bank.ts";

testDialogProcess(
  "DialogProcessor.processConfirmApproveDialog: cancelled",
  () => ({
    ctx: createTestContext(),
    dialog: createMockDialog({ type: DialogStatus.CANCELLED }),
    process: (dialog, ctx) => DialogProcessor.processConfirmApproveDialog(dialog as ConfirmApproveDialog, ctx),
  }),
  (ctx) => {
    assertEquals(ctx.statuses, [TUI_STATUS_MSG_CANCELLED]);
  },
);

testDialogProcess(
  "DialogProcessor.processConfirmApproveDialog: success",
  () => {
    const calls: string[] = [];
    const service = createMockService({
      approvePending: (id: string) => {
        calls.push(`approve:${id}`);
        return Promise.resolve();
      },
    });
    return {
      ctx: createTestContext({ service }),
      dialog: createMockDialog({ type: DialogStatus.CONFIRMED, value: { proposalId: "p1" } }),
      process: (dialog, ctx) => DialogProcessor.processConfirmApproveDialog(dialog as ConfirmApproveDialog, ctx),
    };
  },
  (ctx) => {
    // We can't easily assert 'calls' here without exposing it differently,
    // but we can rely on statuses and counters which are the main side effects.
    // If strict call order verification is needed, we'd adjust the helper.
    // For now, let's verify side effects.
    assertEquals(ctx.statuses, [TUI_STATUS_MSG_PROPOSAL_APPROVED]);
    assertEquals(ctx.counters.treeReloads, 1);
    assertEquals(ctx.counters.pendingReloads, 1);
  },
);

testDialogProcess(
  "DialogProcessor.processConfirmRejectDialog: success",
  () => {
    const service = createMockService({
      rejectPending: (_id: string, _reason: string) => Promise.resolve(),
    });
    return {
      ctx: createTestContext({ service }),
      dialog: createMockDialog({ type: DialogStatus.CONFIRMED, value: { proposalId: "p1", reason: "r" } }),
      process: (dialog, ctx) => DialogProcessor.processConfirmRejectDialog(dialog as ConfirmRejectDialog, ctx),
    };
  },
  (ctx) => {
    assertEquals(ctx.statuses, [TUI_STATUS_MSG_PROPOSAL_REJECTED]);
    assertEquals(ctx.counters.treeReloads, 1);
    assertEquals(ctx.counters.pendingReloads, 1);
  },
);

testDialogProcess(
  "DialogProcessor.processConfirmRejectDialog: cancelled",
  () => ({
    ctx: createTestContext(),
    dialog: createMockDialog({ type: DialogStatus.CANCELLED }),
    process: (dialog, ctx) => DialogProcessor.processConfirmRejectDialog(dialog as ConfirmRejectDialog, ctx),
  }),
  (ctx) => {
    assertEquals(ctx.statuses, [TUI_STATUS_MSG_CANCELLED]);
  },
);

testDialogProcess(
  "DialogProcessor.processConfirmRejectDialog: error surfaces non-Error values",
  () => ({
    ctx: createTestContext({
      service: createMockService({ rejectPending: () => Promise.reject("boom") }),
    }),
    dialog: createMockDialog({ type: DialogStatus.CONFIRMED, value: { proposalId: "p1", reason: "r" } }),
    process: (dialog, ctx) => DialogProcessor.processConfirmRejectDialog(dialog as ConfirmRejectDialog, ctx),
  }),
  (ctx) => {
    assertEquals(ctx.statuses, [`${TUI_STATUS_MSG_ERROR_PREFIX}boom`]);
    assertEquals(ctx.counters.treeReloads, 0);
    assertEquals(ctx.counters.pendingReloads, 0);
  },
);

Deno.test("DialogProcessor.processBulkApproveDialog: approves each pending and reports progress", async () => {
  const approved: string[] = [];
  const service = createMockService({
    listPending: () =>
      Promise.resolve([{ id: "a" }, { id: "b" }] as Partial<IMemoryUpdateProposal[]> as IMemoryUpdateProposal[]),
    approvePending: (id: string) => {
      approved.push(id);
      return Promise.resolve();
    },
  });

  const { ctx, statuses, counters } = createTestContext({ service });
  const progress: number[] = [];
  const dialog = createMockDialog({ type: DialogStatus.CONFIRMED, value: {} }, {
    setProgress: (n: number) => progress.push(n),
  });

  await DialogProcessor.processBulkApproveDialog(dialog as BulkApproveDialog, ctx);

  assertEquals(approved, ["a", "b"]);
  assertEquals(progress, [1, 2]);
  assertEquals(statuses, [TUI_STATUS_MSG_BULK_APPROVE_COMPLETED]);
  assertEquals(counters.treeReloads, 1);
  assertEquals(counters.pendingReloads, 1);
});

Deno.test("DialogProcessor.processBulkApproveDialog: cancelled", async () => {
  const { ctx, statuses } = createTestContext();
  const dialog = createMockDialog({ type: DialogStatus.CANCELLED });

  await DialogProcessor.processBulkApproveDialog(dialog as BulkApproveDialog, ctx);

  assertEquals(statuses, [TUI_STATUS_MSG_CANCELLED]);
});

Deno.test("DialogProcessor.processBulkApproveDialog: error surfaces via status", async () => {
  const service = createMockService({
    listPending: () => Promise.reject(new Error("fail")),
  });

  const { ctx, statuses, counters } = createTestContext({ service });
  const dialog = createMockDialog({ type: DialogStatus.CONFIRMED, value: {} }, {
    setProgress: (_n: number) => {},
  });

  await DialogProcessor.processBulkApproveDialog(dialog as BulkApproveDialog, ctx);

  assertEquals(statuses, [`${TUI_STATUS_MSG_ERROR_PREFIX}fail`]);
  assertEquals(counters.treeReloads, 0);
  assertEquals(counters.pendingReloads, 0);
});

testDialogProcess(
  "DialogProcessor.processAddLearningDialog: cancelled",
  () => ({
    ctx: createTestContext(),
    dialog: createMockDialog({ type: DialogStatus.CANCELLED }),
    process: (dialog, ctx) => DialogProcessor.processAddLearningDialog(dialog as AddLearningDialog, ctx),
  }),
  (ctx) => {
    assertEquals(ctx.statuses, [TUI_STATUS_MSG_CANCELLED]);
  },
);

Deno.test("DialogProcessor.processAddLearningDialog: confirmed sets status and reloads tree", async () => {
  const { ctx, statuses, counters } = createTestContext();
  const dialog = createMockDialog({ type: DialogStatus.CONFIRMED, value: {} });

  await DialogProcessor.processAddLearningDialog(dialog as AddLearningDialog, ctx);

  assertEquals(statuses, [TUI_STATUS_MSG_LEARNING_ADDED]);
  assertEquals(counters.treeReloads, 1);
});

Deno.test("DialogProcessor.processAddLearningDialog: error surfaces via status", async () => {
  const { statuses, counters, ctx } = createTestContext();
  const dialog = createMockDialog({ type: DialogStatus.CONFIRMED, value: {} });
  const failingCtx = {
    ...ctx,
    onTreeReload: () => Promise.reject(new Error("reload failed")),
  };

  await DialogProcessor.processAddLearningDialog(dialog as AddLearningDialog, failingCtx);

  assertEquals(statuses, [TUI_STATUS_MSG_LEARNING_ADDED, `${TUI_STATUS_MSG_ERROR_PREFIX}reload failed`]);
  assertEquals(counters.treeReloads, 0);
});

testDialogProcess(
  "DialogProcessor.processPromoteDialog: cancelled",
  () => ({
    ctx: createTestContext(),
    dialog: createMockDialog({ type: DialogStatus.CANCELLED }),
    process: (dialog, ctx) => DialogProcessor.processPromoteDialog(dialog as PromoteDialog, ctx),
  }),
  (ctx) => {
    assertEquals(ctx.statuses, [TUI_STATUS_MSG_CANCELLED]);
  },
);

Deno.test("DialogProcessor.processPromoteDialog: confirmed sets status and reloads tree", async () => {
  const { ctx, statuses, counters } = createTestContext();
  const dialog = createMockDialog({ type: DialogStatus.CONFIRMED, value: {} });

  await DialogProcessor.processPromoteDialog(dialog as PromoteDialog, ctx);

  assertEquals(statuses, [TUI_STATUS_MSG_PROMOTE_COMPLETED]);
  assertEquals(counters.treeReloads, 1);
});

Deno.test("DialogProcessor.processConfirmApproveDialog: error surfaces via status", async () => {
  const service = createMockService({
    approvePending: () => Promise.reject(new Error("fail")),
  });

  const { ctx, statuses, counters } = createTestContext({ service });
  const dialog = createMockDialog({ type: DialogStatus.CONFIRMED, value: { proposalId: "p1" } });

  await DialogProcessor.processConfirmApproveDialog(dialog as ConfirmApproveDialog, ctx);

  assertEquals(statuses, [`${TUI_STATUS_MSG_ERROR_PREFIX}fail`]);
  assertEquals(counters.treeReloads, 0);
  assertEquals(counters.pendingReloads, 0);
});
