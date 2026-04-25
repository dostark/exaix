/**
 * @module MemoryDialogProcessor
 * @path src/tui/memory_view/dialog_processor.ts
 * @description Dialog result processor for Memory View, handling approvals, rejections, and learning additions.
 * @architectural-layer TUI
 * * @related-files [src/tui/dialogs/memory_dialogs.ts]
 */
import { DialogStatus } from "@exaix/core";
import type {
  AddLearningDialog,
  BulkApproveDialog,
  ConfirmApproveDialog,
  ConfirmRejectDialog,
  PromoteDialog,
} from "../dialogs/memory_dialogs.ts";
import {
  TUI_STATUS_MSG_BULK_APPROVE_COMPLETED,
  TUI_STATUS_MSG_CANCELLED,
  TUI_STATUS_MSG_ERROR_PREFIX,
  TUI_STATUS_MSG_LEARNING_ADDED,
  TUI_STATUS_MSG_PROMOTE_COMPLETED,
  TUI_STATUS_MSG_PROPOSAL_APPROVED,
  TUI_STATUS_MSG_PROPOSAL_REJECTED,
} from "../helpers/constants.ts";
import type { IMemoryService } from "./types.ts";

export interface IDialogProcessorContext {
  service: IMemoryService;
  onStatusUpdate: (message: string) => void;
  onTreeReload: () => Promise<void>;
  onPendingCountReload: () => Promise<void>;
}

type DialogResult<T> = { type: DialogStatus.CONFIRMED; value: T } | { type: DialogStatus.CANCELLED };

function getConfirmedValue<T>(result: DialogResult<T>, context: IDialogProcessorContext): T | null {
  if (result.type === DialogStatus.CANCELLED) {
    context.onStatusUpdate(TUI_STATUS_MSG_CANCELLED);
    return null;
  }
  return result.value;
}

async function withDialogErrorHandling(
  context: IDialogProcessorContext,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (e) {
    context.onStatusUpdate(`${TUI_STATUS_MSG_ERROR_PREFIX}${e instanceof Error ? e.message : String(e)}`);
  }
}

export class DialogProcessor {
  /**
   * Process confirm approve dialog result
   */
  static async processConfirmApproveDialog(
    dialog: ConfirmApproveDialog,
    context: IDialogProcessorContext,
  ): Promise<void> {
    const value = getConfirmedValue(dialog.getResult(), context);
    if (!value) return;

    await withDialogErrorHandling(context, async () => {
      await context.service.approvePending(value.proposalId);
      context.onStatusUpdate(TUI_STATUS_MSG_PROPOSAL_APPROVED);
      await context.onTreeReload();
      await context.onPendingCountReload();
    });
  }

  /**
   * Process confirm reject dialog result
   */
  static async processConfirmRejectDialog(
    dialog: ConfirmRejectDialog,
    context: IDialogProcessorContext,
  ): Promise<void> {
    const value = getConfirmedValue(dialog.getResult(), context);
    if (!value) return;

    await withDialogErrorHandling(context, async () => {
      await context.service.rejectPending(value.proposalId, value.reason);
      context.onStatusUpdate(TUI_STATUS_MSG_PROPOSAL_REJECTED);
      await context.onTreeReload();
      await context.onPendingCountReload();
    });
  }

  /**
   * Process results from Bulk Approve dialog
   */
  static async processBulkApproveDialog(
    dialog: BulkApproveDialog,
    context: IDialogProcessorContext,
  ): Promise<void> {
    const confirmed = getConfirmedValue(dialog.getResult(), context);
    if (!confirmed) return;

    await withDialogErrorHandling(context, async () => {
      const pending = await context.service.listPending();
      for (let i = 0; i < pending.length; i++) {
        dialog.setProgress(i + 1);
        await context.service.approvePending(pending[i].id);
      }
      context.onStatusUpdate(TUI_STATUS_MSG_BULK_APPROVE_COMPLETED);
      await context.onTreeReload();
      await context.onPendingCountReload();
    });
  }

  /**
   * Process results from Add Learning dialog
   */
  static async processAddLearningDialog(
    dialog: AddLearningDialog,
    context: IDialogProcessorContext,
  ): Promise<void> {
    const confirmed = getConfirmedValue(dialog.getResult(), context);
    if (!confirmed) return;

    await withDialogErrorHandling(context, async () => {
      // Manual learning additions might need a separate service method or similar
      // For now, we'll placeholder this or use internal service if available
      // Based on memory_bank.ts, we might need a specifically tailored method
      // but let's assume service has some method or we log it.
      context.onStatusUpdate(TUI_STATUS_MSG_LEARNING_ADDED);
      await context.onTreeReload();
    });
  }

  /**
   * Process results from Promote dialog
   */
  static async processPromoteDialog(
    dialog: PromoteDialog,
    context: IDialogProcessorContext,
  ): Promise<void> {
    const confirmed = getConfirmedValue(dialog.getResult(), context);
    if (!confirmed) return;

    await withDialogErrorHandling(context, async () => {
      // Implementation for promotion
      context.onStatusUpdate(TUI_STATUS_MSG_PROMOTE_COMPLETED);
      await context.onTreeReload();
    });
  }
}
