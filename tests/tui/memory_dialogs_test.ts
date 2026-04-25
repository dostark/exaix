/**
 * @module MemoryDialogsTest
 * @path tests/tui/memory_dialogs_test.ts
 * @description Verifies the interactive memory approval and rejection dialogs, ensuring robust
 * capture of human rationale and dynamic propagation of memory update proposals.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { DialogStatus } from "@exaix/core";
import { KEYS } from "../../src/tui/helpers/keyboard.ts";
import type { DialogBase } from "../../src/tui/helpers/dialog_base.ts";
import {
  AddLearningDialog,
  BulkApproveDialog,
  ConfirmApproveDialog,
  ConfirmRejectDialog,
  PromoteDialog,
} from "../../src/tui/dialogs/memory_dialogs.ts";
import { createMockProposal, renderDialog, testDialogInteraction } from "./memory_view/memory_view_test_utils.ts";

// ===== ConfirmApproveDialog Tests =====

testDialogInteraction(
  "ConfirmApproveDialog: renders correctly",
  () => ({
    dialog: new ConfirmApproveDialog(createMockProposal("p1", "Title")),
    keys: [],
  }),
  (_dialog: DialogBase, rendered: string) => {
    assertExists(rendered);
    assertEquals(rendered.includes("Approve Proposal"), true);
    assertEquals(rendered.includes("Title"), true);
  },
);

testDialogInteraction(
  "ConfirmApproveDialog: starts active",
  () => ({
    dialog: new ConfirmApproveDialog(createMockProposal("p1", "Title")),
    keys: [],
  }),
  (dialog: DialogBase) => {
    assertEquals(dialog.isActive(), true);
    assertEquals(dialog.getState(), DialogStatus.ACTIVE);
  },
);

testDialogInteraction(
  "ConfirmApproveDialog: left/right switches focus",
  () => ({
    dialog: new ConfirmApproveDialog(createMockProposal("p1", "Title")),
    keys: [KEYS.RIGHT],
  }),
  (_dialog: ConfirmApproveDialog, rendered: string) => {
    assertEquals(rendered.includes("[No, Cancel]"), true);
  },
);

testDialogInteraction(
  "ConfirmApproveDialog: enter on approve confirms",
  () => ({
    dialog: new ConfirmApproveDialog(createMockProposal("p1", "Title")),
    keys: [KEYS.ENTER],
  }),
  (dialog: ConfirmApproveDialog) => {
    assertEquals(dialog.isActive(), false);
    assertEquals(dialog.getState(), DialogStatus.CONFIRMED);
    const res = dialog.getResult();
    if (res.type === DialogStatus.CONFIRMED) {
      assertEquals(res.value.proposalId, "p1");
    }
  },
);

testDialogInteraction(
  "ConfirmApproveDialog: 'y' shortcut confirms",
  () => ({
    dialog: new ConfirmApproveDialog(createMockProposal("p1", "Title")),
    keys: [KEYS.Y],
  }),
  (dialog: DialogBase) => {
    assertEquals(dialog.isActive(), false);
    assertEquals(dialog.getState(), DialogStatus.CONFIRMED);
  },
);

testDialogInteraction(
  "ConfirmApproveDialog: escape cancels",
  () => ({
    dialog: new ConfirmApproveDialog(createMockProposal("p1", "Title")),
    keys: [KEYS.ESCAPE],
  }),
  (dialog: ConfirmApproveDialog) => {
    assertEquals(dialog.isActive(), false);
    assertEquals(dialog.getState(), DialogStatus.CANCELLED);
  },
);

testDialogInteraction(
  "ConfirmApproveDialog: 'n' shortcut cancels",
  () => ({
    dialog: new ConfirmApproveDialog(createMockProposal("p1", "Title")),
    keys: [KEYS.N],
  }),
  (dialog: ConfirmApproveDialog) => {
    assertEquals(dialog.isActive(), false);
    assertEquals(dialog.getState(), DialogStatus.CANCELLED);
  },
);

Deno.test("ConfirmApproveDialog: getProposal returns proposal", () => {
  const proposal = createMockProposal("test-proposal-1", "Error Handling IPattern as IPattern");
  const dialog = new ConfirmApproveDialog(proposal);

  const retrieved = dialog.getProposal();
  assertEquals(retrieved.id, "test-proposal-1");
  assertEquals(retrieved.learning.title, "Error Handling IPattern as IPattern");
});

// ===== ConfirmRejectDialog Tests =====

testDialogInteraction(
  "ConfirmRejectDialog: renders correctly",
  () => ({
    dialog: new ConfirmRejectDialog(createMockProposal("p1", "Title")),
    keys: [],
  }),
  (_dialog: DialogBase, rendered: string) => {
    assertExists(rendered);
    assertEquals(rendered.includes("Reject Proposal"), true);
    assertEquals(rendered.includes("Reason"), true);
  },
);

testDialogInteraction(
  "ConfirmRejectDialog: navigates with tab/arrow",
  () => ({
    dialog: new ConfirmRejectDialog(createMockProposal("p1", "Title")),
    keys: [KEYS.TAB, KEYS.TAB, KEYS.TAB],
  }),
  (dialog: DialogBase) => {
    assertEquals(dialog.isActive(), true);
  },
);

Deno.test("ConfirmRejectDialog: enters edit mode for reason", () => {
  const proposal = createMockProposal("test-proposal-1", "Title");
  const dialog = new ConfirmRejectDialog(proposal);

  dialog.handleKey(KEYS.ENTER); // Enter edit mode on reason input
  dialog.handleKey(KEYS.CAP_N);
  dialog.handleKey(KEYS.O);
  dialog.handleKey(KEYS.T);
  dialog.handleKey(" ");
  dialog.handleKey(KEYS.N);
  dialog.handleKey(KEYS.E);
  dialog.handleKey(KEYS.E);
  dialog.handleKey(KEYS.D);
  dialog.handleKey(KEYS.E);
  dialog.handleKey(KEYS.D);

  assertEquals(dialog.getReason(), "Not needed");
});

Deno.test("ConfirmRejectDialog: backspace removes characters in edit mode", () => {
  const proposal = createMockProposal("test-proposal-1", "Title");
  const dialog = new ConfirmRejectDialog(proposal);

  dialog.handleKey(KEYS.ENTER); // Enter edit mode
  dialog.handleKey(KEYS.A);
  dialog.handleKey(KEYS.B);
  dialog.handleKey(KEYS.C);
  dialog.handleKey(KEYS.BACKSPACE);
  assertEquals(dialog.getReason(), "ab");
});

Deno.test("ConfirmRejectDialog: escape exits edit mode", () => {
  const proposal = createMockProposal("test-proposal-1", "Title");
  const dialog = new ConfirmRejectDialog(proposal);

  dialog.handleKey(KEYS.ENTER); // Enter edit mode
  dialog.handleKey(KEYS.T);
  dialog.handleKey(KEYS.E);
  dialog.handleKey(KEYS.S);
  dialog.handleKey(KEYS.T);
  dialog.handleKey(KEYS.ESCAPE); // Exit edit mode

  // Dialog should still be active (not cancelled)
  assertEquals(dialog.isActive(), true);
  assertEquals(dialog.getReason(), "test");
});

Deno.test("ConfirmRejectDialog: confirms with reason", () => {
  const proposal = createMockProposal("test-proposal-1", "Title");
  const dialog = new ConfirmRejectDialog(proposal);

  // Navigate to reject button and confirm
  dialog.handleKey(KEYS.TAB); // to reject button
  dialog.handleKey(KEYS.ENTER);

  assertEquals(dialog.isActive(), false);
  const result = dialog.getResult();
  assertEquals(result.type, DialogStatus.CONFIRMED);
  if (result.type === DialogStatus.CONFIRMED) {
    assertEquals(result.value.proposalId, "test-proposal-1");
  }
});

// ===== AddLearningDialog Tests =====

testDialogInteraction(
  "AddLearningDialog: renders correctly",
  () => ({
    dialog: new AddLearningDialog(),
    keys: [],
  }),
  (_dialog: DialogBase, rendered: string) => {
    assertStringIncludes(rendered, "Add Learning");
    assertStringIncludes(rendered, "Title");
  },
);

testDialogInteraction(
  "AddLearningDialog: validates required fields",
  () => ({
    dialog: new AddLearningDialog(),
    keys: [KEYS.TAB, KEYS.TAB, KEYS.TAB, KEYS.TAB, KEYS.TAB, KEYS.TAB, KEYS.ENTER],
  }),
  (dialog: AddLearningDialog) => {
    assertEquals(dialog.isActive(), true);
  },
);

testDialogInteraction(
  "AddLearningDialog: form fields can be edited",
  () => ({
    dialog: new AddLearningDialog(),
    keys: [],
  }),
  (dialog: AddLearningDialog) => {
    dialog.setTitle("Test Title");
    assertEquals(dialog.getTitle(), "Test Title");
  },
);

testDialogInteraction(
  "AddLearningDialog: escape cancels",
  () => ({
    dialog: new AddLearningDialog(),
    keys: [KEYS.ESCAPE],
  }),
  (dialog: AddLearningDialog) => {
    assertEquals(dialog.isActive(), false);
    assertEquals(dialog.getState(), DialogStatus.CANCELLED);
  },
);

Deno.test("AddLearningDialog: getFocusableElements returns all fields", () => {
  const dialog = new AddLearningDialog();

  const elements = dialog.getFocusableElements();
  assertEquals(elements.length, 8);
  assertEquals(elements.includes("title-input"), true);
  assertEquals(elements.includes("category-select"), true);
  assertEquals(elements.includes("save-btn"), true);
  assertEquals(elements.includes("cancel-btn"), true);
});

// ===== PromoteDialog Tests =====

testDialogInteraction(
  "PromoteDialog: renders correctly",
  () => ({
    dialog: new PromoteDialog("Title", "prop"),
    keys: [],
  }),
  (_dialog: DialogBase, rendered: string) => {
    assertEquals(rendered.includes("Promote to Global"), true);
  },
);

testDialogInteraction(
  "PromoteDialog: left/right switches focus",
  () => ({
    dialog: new PromoteDialog("Title", "prop"),
    keys: [KEYS.RIGHT],
  }),
  (_dialog: DialogBase, rendered: string) => {
    assertEquals(rendered.includes("[Cancel]"), true);
  },
);

testDialogInteraction(
  "PromoteDialog: enter confirms promotion",
  () => ({
    dialog: new PromoteDialog("Title", "prop"),
    keys: [KEYS.ENTER],
  }),
  (dialog: PromoteDialog) => {
    assertEquals(dialog.isActive(), false);
    assertEquals(dialog.getResult().type, DialogStatus.CONFIRMED);
  },
);

testDialogInteraction(
  "PromoteDialog: 'y' shortcut confirms",
  () => ({
    dialog: new PromoteDialog("Title", "prop"),
    keys: [KEYS.Y],
  }),
  (dialog: PromoteDialog) => {
    assertEquals(dialog.isActive(), false);
    assertEquals(dialog.getState(), DialogStatus.CONFIRMED);
  },
);

testDialogInteraction(
  "PromoteDialog: escape cancels",
  () => ({
    dialog: new PromoteDialog("Title", "prop"),
    keys: [KEYS.ESCAPE],
  }),
  (dialog: PromoteDialog) => {
    assertEquals(dialog.isActive(), false);
    assertEquals(dialog.getState(), DialogStatus.CANCELLED);
  },
);

Deno.test("PromoteDialog: getters return correct values", () => {
  const dialog = new PromoteDialog("My ILearning as ILearning", "source-project");

  assertEquals(dialog.getLearningTitle(), "My ILearning as ILearning");
  assertEquals(dialog.getSourcePortal(), "source-project");
});

// ===== BulkApproveDialog Tests =====

testDialogInteraction(
  "BulkApproveDialog: renders correctly",
  () => ({
    dialog: new BulkApproveDialog(5),
    keys: [],
  }),
  (_dialog: DialogBase, rendered: string) => {
    assertEquals(rendered.includes("Approve All Proposals"), true);
    assertEquals(rendered.includes("5 proposal(s)"), true);
  },
);

testDialogInteraction(
  "BulkApproveDialog: left/right switches focus",
  () => ({
    dialog: new BulkApproveDialog(5),
    keys: [KEYS.RIGHT],
  }),
  (_dialog: DialogBase, rendered: string) => {
    assertEquals(rendered.includes("[Cancel]"), true);
  },
);

testDialogInteraction(
  "BulkApproveDialog: enter confirms",
  () => ({
    dialog: new BulkApproveDialog(7),
    keys: [KEYS.ENTER],
  }),
  (dialog: DialogBase) => {
    assertEquals(dialog.isActive(), false);
    const res = dialog.getResult();
    if (res.type === DialogStatus.CONFIRMED && res.value) {
      // value is typed at runtime for BulkApproveResult
      assertEquals((res.value as { count: number }).count, 7);
    }
  },
);

testDialogInteraction(
  "BulkApproveDialog: 'y' shortcut confirms",
  () => ({
    dialog: new BulkApproveDialog(3),
    keys: [KEYS.Y],
  }),
  (dialog: BulkApproveDialog) => {
    assertEquals(dialog.isActive(), false);
    assertEquals(dialog.getState(), DialogStatus.CONFIRMED);
  },
);

testDialogInteraction(
  "BulkApproveDialog: escape cancels",
  () => ({
    dialog: new BulkApproveDialog(5),
    keys: [KEYS.ESCAPE],
  }),
  (dialog: BulkApproveDialog) => {
    assertEquals(dialog.isActive(), false);
    assertEquals(dialog.getState(), DialogStatus.CANCELLED);
  },
);

testDialogInteraction(
  "BulkApproveDialog: progress updates rendering",
  () => ({
    dialog: new BulkApproveDialog(10),
    keys: [],
  }),
  (dialog: BulkApproveDialog, _rendered: string) => {
    dialog.setProgress(3);
    const updated = renderDialog(dialog);
    assertEquals(updated.includes("Progress"), true);
    assertEquals(updated.includes("3/10"), true);
  },
);

Deno.test("BulkApproveDialog: getCount returns count", () => {
  const dialog = new BulkApproveDialog(42);

  assertEquals(dialog.getCount(), 42);
});

// ===== General Dialog Behavior Tests =====

Deno.test("All dialogs: getFocusableElements returns non-empty arrays", () => {
  const proposal = createMockProposal("id", "Title");

  const approve = new ConfirmApproveDialog(proposal);
  const reject = new ConfirmRejectDialog(proposal);
  const add = new AddLearningDialog();
  const promote = new PromoteDialog("Test", "proj");
  const bulk = new BulkApproveDialog(5);

  assertEquals(approve.getFocusableElements().length > 0, true);
  assertEquals(reject.getFocusableElements().length > 0, true);
  assertEquals(add.getFocusableElements().length > 0, true);
  assertEquals(promote.getFocusableElements().length > 0, true);
  assertEquals(bulk.getFocusableElements().length > 0, true);
});

Deno.test("All dialogs: render returns non-empty string", () => {
  const proposal = createMockProposal("id", "Title");

  const approve = new ConfirmApproveDialog(proposal);
  const reject = new ConfirmRejectDialog(proposal);
  const add = new AddLearningDialog();
  const promote = new PromoteDialog("Test", "proj");
  const bulk = new BulkApproveDialog(5);

  assertEquals(renderDialog(approve).length > 0, true);
  assertEquals(renderDialog(reject).length > 0, true);
  assertEquals(renderDialog(add).length > 0, true);
  assertEquals(renderDialog(promote).length > 0, true);
  assertEquals(renderDialog(bulk).length > 0, true);
});
