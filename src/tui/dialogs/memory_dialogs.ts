/**
 * @module MemoryDialogs
 * @path src/tui/dialogs/memory_dialogs.ts
 * @description Specialized TUI dialogs for memory management (approving/rejecting proposals, adding/promoting learnings).
 * @architectural-layer TUI
 * * @related-files [src/helpers/dialog_base.ts, src/tui/memory_view/dialog_processor.ts]
 */
import type { IMemoryUpdateProposal } from "@exaix/schemas/memory_bank.ts";
import { TUI_DIALOG_INNER_PADDING, TUI_LAYOUT_DIALOG_WIDTH } from "../helpers/constants.ts";
import { KEYS } from "../helpers/keyboard.ts";
import {
  DialogBase,
  type IDialogRenderOptions,
  renderBoxLine,
  renderBoxTop,
  renderButton,
  renderDialogEnding,
  renderProposalInfo,
  setupDialogRender,
} from "../helpers/dialog_base.ts";
import { DialogStatus, MemoryScope } from "@exaix/core";
import { DEFAULT_DESCRIPTION_PLACEHOLDER } from "@exaix/core";

// ===== Dialog Types =====

export interface IPromoteDialogResult {
  learningTitle: string;
  sourcePortal: string;
}

export interface IBulkApproveResult {
  count: number;
}

export interface IApproveDialogResult {
  proposalId: string;
}

export interface IRejectDialogResult {
  proposalId: string;
  reason: string;
}

export interface IAddLearningResult {
  title: string;
  category: string;
  content: string;
  tags: string[];
  scope: MemoryScope;
  portal?: string;
}

export type DialogResult<T = unknown> =
  | { type: DialogStatus.CONFIRMED; value: T }
  | { type: DialogStatus.CANCELLED };

export type DialogState = DialogStatus;

const CANCEL_BTN_ID = "cancel-btn";

export class BulkApproveDialog extends DialogBase<IBulkApproveResult> {
  private count: number;
  private progress = 0;
  private inProgress = false;

  constructor(count: number) {
    super();
    this.count = count;
  }

  getFocusableElements(): string[] {
    return ["approve-all-btn", CANCEL_BTN_ID];
  }

  handleKey(key: string): void {
    if (this.inProgress) return; // Ignore keys during progress

    this.focusIndex = handleBinaryDialogKey(
      key,
      this.focusIndex,
      () => this.confirm({ count: this.count }),
      () => this.cancel(),
    );
  }

  setProgress(current: number): void {
    this.progress = current;
    this.inProgress = current < this.count;
  }

  render(options: IDialogRenderOptions): string[] {
    const { innerWidth, border, lines } = initMemoryDialogFrame(options);

    lines.push(`┌─ Approve All Proposals ${border.slice(22)}┐`);
    lines.push(`│${" ".repeat(innerWidth)}│`);
    lines.push(`│  ${this.count} proposal(s) will be approved.${" ".repeat(Math.max(0, innerWidth - 36))}│`);
    lines.push(`│${" ".repeat(innerWidth)}│`);

    if (this.inProgress) {
      // Show progress bar
      const progressPct = Math.floor((this.progress / this.count) * 100);
      const barWidth = innerWidth - 20;
      const filled = Math.floor((this.progress / this.count) * barWidth);
      const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
      lines.push(`│  Progress: [${bar}] ${progressPct}%${" ".repeat(Math.max(0, innerWidth - barWidth - 18))}│`);
      lines.push(`│  ${this.progress}/${this.count} completed${" ".repeat(Math.max(0, innerWidth - 18))}│`);
    } else {
      lines.push(`│  This action cannot be undone.${" ".repeat(Math.max(0, innerWidth - 33))}│`);
    }

    lines.push(`│${" ".repeat(innerWidth)}│`);

    if (!this.inProgress) {
      // Buttons
      const approveBtn = this.focusIndex === 0 ? "[Approve All]" : " Approve All ";
      const cancelBtn = this.focusIndex === 1 ? "[Cancel]" : " Cancel ";
      appendCenteredButtons(lines, innerWidth, approveBtn, cancelBtn);
    }

    lines.push(`└${border}┘`);

    return lines;
  }

  getResult(): DialogResult<IBulkApproveResult> {
    if (this.state === DialogStatus.CONFIRMED && this._resultValue) {
      return { type: DialogStatus.CONFIRMED, value: this._resultValue };
    }
    return { type: DialogStatus.CANCELLED };
  }

  getCount(): number {
    return this.count;
  }
}

function initMemoryDialogFrame(options: IDialogRenderOptions): {
  innerWidth: number;
  border: string;
  lines: string[];
} {
  const innerWidth = Math.min(options.width - TUI_DIALOG_INNER_PADDING, TUI_LAYOUT_DIALOG_WIDTH);
  const border = "─".repeat(innerWidth);
  const lines: string[] = [];
  return { innerWidth, border, lines };
}

function handleBinaryDialogKey(
  key: string,
  focusIndex: number,
  onConfirm: () => void,
  onCancel: () => void,
): number {
  switch (key) {
    case KEYS.LEFT:
    case KEYS.RIGHT:
    case KEYS.TAB:
      return focusIndex === 0 ? 1 : 0;
    case KEYS.ENTER:
      if (focusIndex === 0) {
        onConfirm();
      } else {
        onCancel();
      }
      return focusIndex;
    case KEYS.Y:
      onConfirm();
      return focusIndex;
    case KEYS.N:
    case KEYS.ESCAPE:
      onCancel();
      return focusIndex;
    default:
      return focusIndex;
  }
}

function appendCenteredButtons(
  lines: string[],
  innerWidth: number,
  primaryButton: string,
  secondaryButton: string,
): void {
  const buttonsLine = `${primaryButton}    ${secondaryButton}`;
  const padding = Math.floor((innerWidth - buttonsLine.length) / 2);
  lines.push(`│${" ".repeat(padding)}${buttonsLine}${" ".repeat(innerWidth - padding - buttonsLine.length)}│`);
  lines.push(`│${" ".repeat(innerWidth)}│`);
}

export class ConfirmApproveDialog extends DialogBase<IApproveDialogResult> {
  private proposal: IMemoryUpdateProposal;

  constructor(proposal: IMemoryUpdateProposal) {
    super();
    this.proposal = proposal;
  }

  getFocusableElements(): string[] {
    return ["approve-btn", CANCEL_BTN_ID];
  }

  handleKey(key: string): void {
    this.focusIndex = handleBinaryDialogKey(
      key,
      this.focusIndex,
      () => this.confirm({ proposalId: this.proposal.id || "" }),
      () => this.cancel(),
    );
  }

  render(options: IDialogRenderOptions): string[] {
    const { theme, lines, innerWidth } = setupDialogRender(options);

    lines.push(renderBoxTop(innerWidth, " Approve Proposal ", theme));
    renderProposalInfo(this.proposal, innerWidth, theme, lines);

    // Description (truncated)
    const desc = this.proposal.learning?.description?.slice(0, innerWidth - 6) ?? DEFAULT_DESCRIPTION_PLACEHOLDER;
    lines.push(renderBoxLine(`  ${desc.padEnd(innerWidth - 2)}`, innerWidth, theme));
    lines.push(renderBoxLine("", innerWidth, theme));

    // Tags if available
    if (this.proposal.learning?.tags && this.proposal.learning.tags.length > 0) {
      const tagsLine = `Tags: ${this.proposal.learning.tags.join(", ")}`.slice(0, innerWidth - 4);
      lines.push(renderBoxLine(`  ${tagsLine.padEnd(innerWidth - 2)}`, innerWidth, theme));
      lines.push(renderBoxLine("", innerWidth, theme));
    }

    // Buttons
    const approveBtn = renderButton("Yes, Approve", this.focusIndex === 0, false, theme);
    const cancelBtn = renderButton("No, Cancel", this.focusIndex === 1, false, theme);
    const buttonsLine = `${approveBtn}    ${cancelBtn}`;
    renderDialogEnding(buttonsLine, innerWidth, theme, lines);

    return lines;
  }

  getResult(): DialogResult<IApproveDialogResult> {
    if (this.state === DialogStatus.CONFIRMED && this._resultValue) {
      return { type: DialogStatus.CONFIRMED, value: this._resultValue };
    }
    return { type: DialogStatus.CANCELLED };
  }

  getProposal(): IMemoryUpdateProposal {
    return this.proposal;
  }
}

// ===== Confirm Reject Dialog =====

export class ConfirmRejectDialog extends DialogBase<IRejectDialogResult> {
  private proposal: IMemoryUpdateProposal;
  private reason = "";
  private inputActive = false;

  constructor(proposal: IMemoryUpdateProposal) {
    super();
    this.proposal = proposal;
  }

  getFocusableElements(): string[] {
    return ["reason-input", "reject-btn", CANCEL_BTN_ID];
  }

  handleKey(key: string): void {
    if (this.inputActive) {
      if (key === KEYS.ESCAPE || key === KEYS.ENTER) {
        this.inputActive = false;
        if (key === KEYS.ENTER) {
          this.focusIndex = 1; // Move to reject button
        }
      } else if (key === KEYS.BACKSPACE) {
        this.reason = this.reason.slice(0, -1);
      } else if (key.length === 1) {
        this.reason += key;
      }
      return;
    }

    switch (key) {
      case KEYS.TAB:
      case KEYS.DOWN:
        this.focusIndex = (this.focusIndex + 1) % 3;
        break;
      case KEYS.UP:
        this.focusIndex = (this.focusIndex - 1 + 3) % 3;
        break;
      case KEYS.ENTER:
        if (this.focusIndex === 0) {
          this.inputActive = true;
        } else if (this.focusIndex === 1) {
          this.confirm({ proposalId: this.proposal.id || "", reason: this.reason });
        } else {
          this.cancel();
        }
        break;
      case KEYS.ESCAPE:
        this.cancel();
        break;
    }
  }

  render(options: IDialogRenderOptions): string[] {
    const { theme, lines, innerWidth } = setupDialogRender(options);

    lines.push(renderBoxTop(innerWidth, " Reject Proposal ", theme));
    renderProposalInfo(this.proposal, innerWidth, theme, lines, { showScope: false, showCategory: false });

    // Reason input
    const reasonLabel = this.focusIndex === 0 ? "[Reason (optional)]:" : " Reason (optional): ";
    const reasonValue = this.reason || (this.inputActive ? "|" : "(none)");
    lines.push(
      renderBoxLine(
        `  ${reasonLabel}${" ".repeat(Math.max(0, innerWidth - reasonLabel.length - 3))}`,
        innerWidth,
        theme,
      ),
    );
    lines.push(renderBoxLine(`  ${reasonValue.slice(0, innerWidth - 4).padEnd(innerWidth - 2)}`, innerWidth, theme));
    lines.push(renderBoxLine("", innerWidth, theme));

    // Buttons
    const rejectBtn = renderButton("Yes, Reject", this.focusIndex === 1, true, theme);
    const cancelBtn = renderButton("No, Cancel", this.focusIndex === 2, false, theme);
    const buttonsLine = `${rejectBtn}    ${cancelBtn}`;
    renderDialogEnding(buttonsLine, innerWidth, theme, lines);

    return lines;
  }

  getResult(): DialogResult<IRejectDialogResult> {
    if (this.state === DialogStatus.CONFIRMED && this._resultValue) {
      return { type: DialogStatus.CONFIRMED, value: this._resultValue };
    }
    return { type: DialogStatus.CANCELLED };
  }

  getReason(): string {
    return this.reason;
  }
}

// ===== Add Learning Dialog =====

export class AddLearningDialog extends DialogBase<IAddLearningResult> {
  private title = "";
  private category = "pattern";
  private content = "";
  private tags = "";
  private scope: MemoryScope = MemoryScope.GLOBAL;
  private portal = "";
  private activeField = 0;
  private editMode = false;

  private readonly categories = [
    "pattern",
    "decision",
    "anti-pattern",
    "insight",
    "troubleshooting",
  ];

  constructor(defaultPortal?: string) {
    super();
    if (defaultPortal) {
      this.portal = defaultPortal;
      this.scope = MemoryScope.PROJECT;
    }
  }

  getFocusableElements(): string[] {
    return [
      "title-input",
      "category-select",
      "content-input",
      "tags-input",
      "scope-select",
      "portal-input",
      "save-btn",
      CANCEL_BTN_ID,
    ];
  }

  handleKey(key: string): void {
    if (this.editMode) {
      this.handleEditModeKey(key);
      return;
    }

    switch (key) {
      case KEYS.TAB:
      case KEYS.DOWN:
        this.activeField = (this.activeField + 1) % 8;
        break;
      case KEYS.UP:
        this.activeField = (this.activeField - 1 + 8) % 8;
        break;
      case KEYS.ENTER:
        if (this.activeField === 6) {
          // Save button
          if (this.validate()) {
            this.confirm(this.buildResult());
          }
        } else if (this.activeField === 7) {
          // Cancel button
          this.cancel();
        } else {
          this.editMode = true;
        }
        break;
      case KEYS.ESCAPE:
        this.cancel();
        break;
    }
  }

  private handleEditModeKey(key: string): void {
    if (key === KEYS.ESCAPE || key === KEYS.ENTER) {
      this.editMode = false;
      return;
    }

    switch (this.activeField) {
      case 0: // title
        this.title = this.applyTextInputKey(this.title, key);
        break;
      case 1: // category - cycle through
        this.category = this.applyCategoryKey(this.category, key);
        break;
      case 2: // content
        this.content = this.applyTextInputKey(this.content, key);
        break;
      case 3: // tags
        this.tags = this.applyTextInputKey(this.tags, key);
        break;
      case 4: // scope
        this.scope = this.scope === MemoryScope.GLOBAL ? MemoryScope.PROJECT : MemoryScope.GLOBAL;
        break;
      case 5: // portal
        this.portal = this.applyTextInputKey(this.portal, key);
        break;
    }
  }

  private applyTextInputKey(current: string, key: string): string {
    if (key === KEYS.BACKSPACE) return current.slice(0, -1);
    if (key.length === 1) return current + key;
    return current;
  }

  private applyCategoryKey(current: string, key: string): string {
    if (key !== KEYS.LEFT && key !== KEYS.RIGHT && key.length !== 1) return current;
    const idx = this.categories.indexOf(current);
    return this.categories[(idx + 1) % this.categories.length];
  }

  private fieldLabel(fieldIndex: number, label: string): string {
    return this.activeField === fieldIndex ? `[${label}]:` : ` ${label}: `;
  }

  private fieldDisplayValue(fieldIndex: number, value: string, placeholder: string): string {
    if (value) return value;
    if (this.editMode && this.activeField === fieldIndex) return "│";
    return placeholder;
  }

  private renderPortalField(innerWidth: number): string[] {
    if (this.scope !== MemoryScope.PROJECT) return [];
    const portalLabel = this.fieldLabel(5, "Portal");
    const portalValue = this.fieldDisplayValue(5, this.portal, "(required)");
    return [`│  ${portalLabel} ${portalValue.slice(0, innerWidth - 12).padEnd(innerWidth - 11)}│`];
  }

  private validate(): boolean {
    if (!this.title.trim()) {
      return false;
    }
    if (this.scope === MemoryScope.PROJECT && !this.portal.trim()) {
      return false;
    }
    return true;
  }

  private buildResult(): IAddLearningResult {
    return {
      title: this.title.trim(),
      category: this.category,
      content: this.content.trim(),
      tags: this.tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t),
      scope: this.scope,
      portal: this.scope === MemoryScope.PROJECT ? this.portal.trim() : undefined,
    };
  }

  render(options: IDialogRenderOptions): string[] {
    const { innerWidth, border, lines } = initMemoryDialogFrame(options);

    lines.push(`┌─ Add Learning ${border.slice(13)}┐`);
    lines.push(`│${" ".repeat(innerWidth)}│`);

    // Title
    const titleLabel = this.fieldLabel(0, "Title");
    const titleValue = this.fieldDisplayValue(0, this.title, "(required)");
    lines.push(`│  ${titleLabel} ${titleValue.slice(0, innerWidth - 12).padEnd(innerWidth - 11)}│`);

    // Category
    const catLabel = this.fieldLabel(1, "Category");
    lines.push(`│  ${catLabel} ${this.category.padEnd(innerWidth - 14)}│`);

    // Content
    const contLabel = this.fieldLabel(2, "Content");
    const contValue = this.fieldDisplayValue(2, this.content, "(optional)");
    lines.push(`│  ${contLabel} ${contValue.slice(0, innerWidth - 13).padEnd(innerWidth - 12)}│`);

    // Tags
    const tagsLabel = this.fieldLabel(3, "Tags");
    const tagsValue = this.fieldDisplayValue(3, this.tags, "(comma-separated)");
    lines.push(`│  ${tagsLabel} ${tagsValue.slice(0, innerWidth - 10).padEnd(innerWidth - 9)}│`);

    // Scope
    const scopeLabel = this.fieldLabel(4, "Scope");
    lines.push(`│  ${scopeLabel} ${this.scope.padEnd(innerWidth - 11)}│`);

    // Portal (only if project scope)
    lines.push(...this.renderPortalField(innerWidth));

    lines.push(`│${" ".repeat(innerWidth)}│`);

    // Buttons
    const saveBtn = this.activeField === 6 ? "[Save]" : " Save ";
    const cancelBtn = this.activeField === 7 ? "[Cancel]" : " Cancel ";
    appendCenteredButtons(lines, innerWidth, saveBtn, cancelBtn);
    lines.push(`└${border}┘`);

    return lines;
  }

  getResult(): DialogResult<IAddLearningResult> {
    if (this.state === DialogStatus.CONFIRMED && this._resultValue) {
      return { type: DialogStatus.CONFIRMED, value: this._resultValue };
    }
    return { type: DialogStatus.CANCELLED };
  }

  // For testing
  setTitle(t: string): void {
    this.title = t;
  }
  setContent(c: string): void {
    this.content = c;
  }
  setCategory(c: string): void {
    this.category = c;
  }
  setScope(s: MemoryScope): void {
    this.scope = s;
  }
  setPortal(p: string): void {
    this.portal = p;
  }
  getTitle(): string {
    return this.title;
  }
  getCategory(): string {
    return this.category;
  }
  getScope(): MemoryScope {
    return this.scope;
  }
}

// ===== Promote Dialog =====

export class PromoteDialog extends DialogBase<IPromoteDialogResult> {
  private learningTitle: string;
  private sourcePortal: string;

  constructor(learningTitle: string, sourcePortal: string) {
    super();
    this.learningTitle = learningTitle;
    this.sourcePortal = sourcePortal;
  }

  getFocusableElements(): string[] {
    return ["promote-btn", CANCEL_BTN_ID];
  }

  handleKey(key: string): void {
    this.focusIndex = handleBinaryDialogKey(
      key,
      this.focusIndex,
      () =>
        this.confirm({
          learningTitle: this.learningTitle,
          sourcePortal: this.sourcePortal,
        }),
      () => this.cancel(),
    );
  }

  render(options: IDialogRenderOptions): string[] {
    const { innerWidth, border, lines } = initMemoryDialogFrame(options);

    lines.push(`┌─ Promote to Global ${border.slice(18)}┐`);
    lines.push(`│${" ".repeat(innerWidth)}│`);
    lines.push(`│  Learning: ${this.learningTitle.slice(0, innerWidth - 14).padEnd(innerWidth - 12)}│`);
    lines.push(`│  From: ${this.sourcePortal.padEnd(innerWidth - 9)}│`);
    lines.push(`│${" ".repeat(innerWidth)}│`);
    lines.push(`│  This will copy the learning to Global Memory.${" ".repeat(Math.max(0, innerWidth - 47))}│`);
    lines.push(`│  The original will remain in project memory.${" ".repeat(Math.max(0, innerWidth - 46))}│`);
    lines.push(`│${" ".repeat(innerWidth)}│`);

    // Buttons
    const promoteBtn = this.focusIndex === 0 ? "[Promote]" : " Promote ";
    const cancelBtn = this.focusIndex === 1 ? "[Cancel]" : " Cancel ";
    appendCenteredButtons(lines, innerWidth, promoteBtn, cancelBtn);
    lines.push(`└${border}┘`);

    return lines;
  }

  getResult(): DialogResult<IPromoteDialogResult> {
    if (this.state === DialogStatus.CONFIRMED && this._resultValue) {
      return { type: DialogStatus.CONFIRMED, value: this._resultValue };
    }
    return { type: DialogStatus.CANCELLED };
  }

  getLearningTitle(): string {
    return this.learningTitle;
  }

  getSourcePortal(): string {
    return this.sourcePortal;
  }
}
