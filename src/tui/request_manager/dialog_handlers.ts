/**
 * @module RequestDialogHandlers
 * @path src/tui/request_manager/dialog_handlers.ts
 * @description Logic for processing and routing results from various dialogs within the Request Manager View.
 * @architectural-layer TUI
 * * @related-files [src/tui/request_manager_view.ts]
 */

import { ConfirmDialog, InputDialog } from "../helpers/dialog_base.ts";
import { DialogStatus, MessageType, RequestDialogType } from "@exaix/core";

export type RequestDialogTypeUnion = RequestDialogType | null;

/**
 * Handle completed dialogs for Request Manager
 */
export async function processDialogCompletion(
  dialog: InputDialog | ConfirmDialog | null,
  dialogType: RequestDialogTypeUnion,
  handlers: {
    handleSearchResult: (value: string) => void;
    handleFilterStatusResult: (value: string) => void;
    handleFilterIdentityResult: (value: string) => void;
    handleCreateResult: (value: string) => Promise<void>;
    handlePriorityResult: (value: string) => void;
    processConfirmDialog: (dialog: ConfirmDialog) => Promise<void>;
    setStatus: (message: string, type?: MessageType) => void;
  },
): Promise<void> {
  if (!dialog) return;

  // Input dialog confirmed
  if (dialog instanceof InputDialog && dialog.getState() === DialogStatus.CONFIRMED) {
    const result = dialog.getResult();
    if (result.type === DialogStatus.CONFIRMED) {
      switch (dialogType) {
        case RequestDialogType.SEARCH:
          handlers.handleSearchResult(result.value);
          break;
        case RequestDialogType.FILTER_STATUS:
          handlers.handleFilterStatusResult(result.value);
          break;
        case RequestDialogType.FILTER_IDENTITY:
          handlers.handleFilterIdentityResult(result.value);
          break;
        case RequestDialogType.CREATE:
          try {
            await handlers.handleCreateResult(result.value);
          } catch (e) {
            handlers.setStatus(`Error: ${e}`, MessageType.ERROR);
          }
          break;
        case RequestDialogType.PRIORITY:
          handlers.handlePriorityResult(result.value);
          break;
        default:
          break;
      }
    }
  }

  // Confirm dialog (cancel request)
  if (dialog instanceof ConfirmDialog && dialog.getState() === DialogStatus.CONFIRMED) {
    await handlers.processConfirmDialog(dialog);
  }
}
