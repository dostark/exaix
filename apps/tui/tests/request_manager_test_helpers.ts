/**
 * @module RequestManagerTestHelpers
 * @path apps/tui/tests/request_manager_test_helpers.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Common utilities for RequestManager TUI tests, ensuring stable simulation
 * of request lifecycles and interactive input dialogs.
 */

import type { ConfirmDialog, InputDialog } from "@exaix/tui/helpers/dialog_base.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import type { MessageType } from "@exaix/core";

export interface IRequestManagerMockHandlers {
  handleSearchResult: (value: string) => void;
  handleFilterStatusResult: (value: string) => void;
  handleFilterIdentityResult: (value: string) => void;
  handleCreateResult: (value: string) => Promise<void>;
  handlePriorityResult: (value: string) => void;
  processConfirmDialog: (dialog: ConfirmDialog) => Promise<void>;
  setStatus: (message: string, type?: MessageType) => void;
}

export function createMockHandlers(
  calls: string[],
  overrides: Partial<IRequestManagerMockHandlers> = {},
): IRequestManagerMockHandlers {
  return {
    handleSearchResult: (value: string) => {
      calls.push(`search:${value}`);
    },
    handleFilterStatusResult: (value: string) => {
      calls.push(`filter_status:${value}`);
    },
    handleFilterIdentityResult: (value: string) => {
      calls.push(`filter_agent_role:${value}`);
    },
    handleCreateResult: (value: string) => {
      calls.push(`create:${value}`);
      return Promise.resolve();
    },
    handlePriorityResult: (value: string) => {
      calls.push(`priority:${value}`);
    },
    processConfirmDialog: (_dialog: ConfirmDialog) => {
      calls.push("confirm");
      return Promise.resolve();
    },
    setStatus: (message: string, type?: MessageType) => {
      const prefix = type ? `${type}:` : "status:";
      calls.push(`${prefix}${message}`);
    },
    ...overrides,
  };
}

export function confirmInputDialog(dialog: InputDialog): void {
  // Default focus is "input" (index 0). Move to confirm (index 1) and confirm.
  dialog.handleKey(KEYS.TAB);
  dialog.handleKey(KEYS.ENTER);
}
