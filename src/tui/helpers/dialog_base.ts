/**
 * @module DialogBase
 * @path src/tui/helpers/dialog_base.ts
 * @description TUI Dialog Base Framework providing common classes and utilities for modal dialogs.
 * @architectural-layer Helpers
 * * @related-files [src/helpers/dialog_rendering.ts, src/helpers/keyboard.ts]
 */

import { ANSI, colorize, getTheme, type ITuiTheme, padEnd, visibleLength } from "./colors.ts";
import { renderDialogButtons, renderDialogLine, renderDialogTitle, renderEmptyDialogLine } from "./dialog_rendering.ts";
import {
  TUI_DIALOG_DEFAULT_HEIGHT,
  TUI_DIALOG_INNER_PADDING,
  TUI_LABEL_CANCEL,
  TUI_LAYOUT_DIALOG_WIDTH,
  TUI_LAYOUT_MEDIUM_WIDTH,
} from "./constants.ts";
import type { IMemoryUpdateProposal } from "../../shared/schemas/memory_bank.ts";

// ===== Dialog Types =====

import { DialogStatus, MemoryScope, RequestOperation } from "../../shared/enums.ts";
import { KEYS } from "./keyboard.ts";

export type DialogState = DialogStatus;

export type DialogResult<T = unknown> =
  | { type: DialogStatus.CONFIRMED; value: T }
  | { type: DialogStatus.CANCELLED };

export interface IDialogRenderOptions {
  useColors: boolean;
  width: number;
  height: number;
}

function createDialogResult<T>(state: DialogState, value: T | undefined): DialogResult<T> {
  if (state === DialogStatus.CONFIRMED && value !== undefined) {
    return { type: DialogStatus.CONFIRMED, value };
  }
  return { type: DialogStatus.CANCELLED };
}

function appendDialogHeader(lines: string[], title: string, innerWidth: number, theme: ITuiTheme): void {
  lines.push(renderDialogTitle(title, innerWidth, theme));
  lines.push(renderEmptyDialogLine(innerWidth, theme));
}

function appendDialogFooter(
  lines: string[],
  buttons: Array<{ text: string; focused: boolean }>,
  innerWidth: number,
  theme: ITuiTheme,
): void {
  lines.push(renderEmptyDialogLine(innerWidth, theme));
  lines.push(renderDialogButtons(buttons, innerWidth, theme));
  lines.push(renderEmptyDialogLine(innerWidth, theme));
  lines.push(renderBoxBottom(innerWidth, theme));
}

function initSimpleDialogRender(options: IDialogRenderOptions): {
  theme: ITuiTheme;
  innerWidth: number;
  lines: string[];
} {
  const theme = getTheme(options.useColors);
  const innerWidth = Math.min(options.width - TUI_DIALOG_INNER_PADDING, TUI_LAYOUT_MEDIUM_WIDTH);
  const lines: string[] = [];
  return { theme, innerWidth, lines };
}

// ===== Box Drawing Characters =====

export const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeLeft: "├",
  teeRight: "┤",
  teeTop: "┬",
  teeBottom: "┴",
  cross: "┼",
  // Double line variants
  doubleHorizontal: "═",
  doubleVertical: "║",
  doubleTopLeft: "╔",
  doubleTopRight: "╗",
  doubleBottomLeft: "╚",
  doubleBottomRight: "╝",
} as const;

// ===== Base Dialog Class =====

/**
 * Abstract base class for all dialogs
 */
export abstract class DialogBase<T = unknown> {
  protected state: DialogState = DialogStatus.ACTIVE;
  protected focusIndex = 0;
  protected _resultValue?: T;

  isActive(): boolean {
    return this.state === DialogStatus.ACTIVE;
  }

  getState(): DialogState {
    return this.state;
  }

  getFocusIndex(): number {
    return this.focusIndex;
  }

  abstract getFocusableElements(): string[];
  abstract handleKey(key: string): void;
  abstract render(options: IDialogRenderOptions): string[];
  abstract getResult(): DialogResult<T>;

  protected cancel(): void {
    if (this.state === DialogStatus.ACTIVE) {
      this.state = DialogStatus.CANCELLED;
    }
  }

  protected confirm(value: T): void {
    if (this.state === DialogStatus.ACTIVE) {
      this.state = DialogStatus.CONFIRMED;
      this._resultValue = value;
    }
  }

  protected moveFocus(direction: 1 | -1): void {
    const elements = this.getFocusableElements();
    if (elements.length === 0) return;
    this.focusIndex = (this.focusIndex + direction + elements.length) % elements.length;
  }
}

// ===== Confirmation Dialog =====

export interface ConfirmDialogOptions {
  title: string;
  message: string | string[];
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

/**
 * Simple confirmation dialog (Yes/No)
 */
export class ConfirmDialog extends DialogBase<boolean> {
  public readonly options: Required<ConfirmDialogOptions>;

  constructor(options: ConfirmDialogOptions) {
    super();
    this.options = {
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? "Yes",
      cancelText: options.cancelText ?? "No",
      destructive: options.destructive ?? false,
    };
  }

  getFocusableElements(): string[] {
    return ["confirm", "cancel"];
  }

  handleKey(key: string): void {
    switch (key) {
      case KEYS.LEFT:
      case KEYS.RIGHT:
      case KEYS.TAB:
        this.moveFocus(key === KEYS.LEFT ? -1 : 1);
        break;
      case KEYS.ENTER:
        if (this.focusIndex === 0) {
          this.confirm(true);
        } else {
          this.cancel();
        }
        break;
      case KEYS.Y:
        this.confirm(true);
        break;
      case KEYS.N:
      case KEYS.ESCAPE:
        this.cancel();
        break;
    }
  }

  render(opts: IDialogRenderOptions): string[] {
    const { theme, innerWidth, lines } = initSimpleDialogRender(opts);

    appendDialogHeader(lines, this.options.title, innerWidth, theme);

    // Message lines
    const messages = Array.isArray(this.options.message)
      ? this.options.message
      : wrapToWidth(this.options.message, innerWidth - 4);

    for (const msg of messages) {
      lines.push(renderDialogLine(`  ${msg}`, innerWidth, theme));
    }

    // Buttons
    const buttons = [
      { text: this.options.confirmText, focused: this.focusIndex === 0 },
      { text: this.options.cancelText, focused: this.focusIndex === 1 },
    ];

    appendDialogFooter(lines, buttons, innerWidth, theme);

    return lines;
  }

  getResult(): DialogResult<boolean> {
    return createDialogResult(this.state, this.state === DialogStatus.CONFIRMED ? true : undefined);
  }
}

// ===== Input Dialog =====

export interface InputDialogOptions {
  title: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
}

/**
 * Single input field dialog
 */
export class InputDialog extends DialogBase<string> {
  public readonly options: Required<InputDialogOptions>;
  private value: string;
  private editing: boolean = false;
  private cursorPos: number = 0;

  constructor(options: InputDialogOptions) {
    super();
    this.options = {
      title: options.title,
      label: options.label,
      placeholder: options.placeholder ?? "",
      defaultValue: options.defaultValue ?? "",
      required: options.required ?? false,
      maxLength: options.maxLength ?? 200,
    };
    this.value = this.options.defaultValue;
    this.cursorPos = this.value.length;
  }

  getFocusableElements(): string[] {
    return ["input", "confirm", "cancel"];
  }

  getValue(): string {
    return this.value;
  }

  isEditing(): boolean {
    return this.editing;
  }

  handleKey(key: string): void {
    if (this.editing) {
      this.handleEditKey(key);
      return;
    }

    switch (key) {
      case KEYS.TAB:
        this.moveFocus(1);
        break;
      case KEYS.SHIFT_TAB:
        this.moveFocus(-1);
        break;
      case KEYS.UP:
        this.moveFocus(-1);
        break;
      case KEYS.DOWN:
        this.moveFocus(1);
        break;
      case KEYS.ENTER:
        if (this.focusIndex === 0) {
          this.editing = true;
        } else if (this.focusIndex === 1) {
          if (!this.options.required || this.value.length > 0) {
            this.confirm(this.value);
          }
        } else {
          this.cancel();
        }
        break;
      case KEYS.ESCAPE:
        this.cancel();
        break;
    }
  }

  private handleEditKey(key: string): void {
    switch (key) {
      case KEYS.ESCAPE:
        this.editing = false;
        break;
      case KEYS.ENTER:
        this.editing = false;
        this.moveFocus(1);
        break;
      case KEYS.BACKSPACE:
        if (this.cursorPos > 0) {
          this.value = this.value.slice(0, this.cursorPos - 1) + this.value.slice(this.cursorPos);
          this.cursorPos--;
        }
        break;
      case KEYS.DELETE:
        if (this.cursorPos < this.value.length) {
          this.value = this.value.slice(0, this.cursorPos) + this.value.slice(this.cursorPos + 1);
        }
        break;
      case KEYS.LEFT:
        if (this.cursorPos > 0) this.cursorPos--;
        break;
      case KEYS.RIGHT:
        if (this.cursorPos < this.value.length) this.cursorPos++;
        break;
      case KEYS.HOME:
        this.cursorPos = 0;
        break;
      case KEYS.END:
        this.cursorPos = this.value.length;
        break;
      default:
        // Single character input
        if (key.length === 1 && this.value.length < this.options.maxLength) {
          this.value = this.value.slice(0, this.cursorPos) + key + this.value.slice(this.cursorPos);
          this.cursorPos++;
        }
        break;
    }
  }

  render(opts: IDialogRenderOptions): string[] {
    const { theme, innerWidth, lines } = initSimpleDialogRender(opts);

    appendDialogHeader(lines, this.options.title, innerWidth, theme);

    // Label
    lines.push(renderDialogLine(`  ${this.options.label}:`, innerWidth, theme));

    // Input field
    const inputWidth = innerWidth - 6;
    const displayValue = this.value || this.options.placeholder;
    const isFocused = this.focusIndex === 0;
    const inputField = renderInputField(
      displayValue,
      inputWidth,
      isFocused,
      this.editing,
      !this.value && !!this.options.placeholder,
      theme,
    );
    lines.push(renderDialogLine(`  ${inputField}`, innerWidth, theme));

    // Buttons
    const _canConfirm = !this.options.required || this.value.length > 0;
    const buttons = [
      { text: "OK", focused: this.focusIndex === 1 },
      { text: TUI_LABEL_CANCEL, focused: this.focusIndex === 2 },
    ];

    appendDialogFooter(lines, buttons, innerWidth, theme);

    return lines;
  }

  getResult(): DialogResult<string> {
    return createDialogResult(this.state, this._resultValue);
  }
}

// ===== Select Dialog =====

export interface SelectOption<T = string> {
  value: T;
  label: string;
  description?: string;
}

export interface SelectDialogOptions<T = string> {
  title: string;
  options: SelectOption<T>[];
  selectedIndex?: number;
}

/**
 * Single-select dialog with list of options
 */
export class SelectDialog<T = string> extends DialogBase<T> {
  public readonly options: SelectDialogOptions<T>;
  private selectedIndex: number;
  private scrollOffset: number = 0;
  private maxVisible: number = 8;

  constructor(options: SelectDialogOptions<T>) {
    super();
    this.options = options;
    this.selectedIndex = options.selectedIndex ?? 0;
  }

  getFocusableElements(): string[] {
    return [RequestOperation.LIST, "confirm", "cancel"];
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  handleKey(key: string): void {
    if (this.focusIndex === 0) {
      this.handleListKey(key);
      return;
    }
    this.handleButtonsKey(key);
  }

  private handleListKey(key: string): void {
    switch (key) {
      case KEYS.UP:
        this.moveSelection(-1);
        return;
      case KEYS.DOWN:
        this.moveSelection(1);
        return;
      case KEYS.TAB:
        this.moveFocus(1);
        return;
      case KEYS.ENTER:
        this.confirm(this.options.options[this.selectedIndex].value);
        return;
      case KEYS.ESCAPE:
        this.cancel();
        return;
    }
  }

  private moveSelection(delta: number): void {
    const nextIndex = this.selectedIndex + delta;
    if (nextIndex < 0) return;
    if (nextIndex >= this.options.options.length) return;

    this.selectedIndex = nextIndex;

    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    }
    if (this.selectedIndex >= this.scrollOffset + this.maxVisible) {
      this.scrollOffset = this.selectedIndex - this.maxVisible + 1;
    }
  }

  private handleButtonsKey(key: string): void {
    switch (key) {
      case KEYS.TAB:
        this.moveFocus(1);
        return;
      case KEYS.SHIFT_TAB:
      case KEYS.UP:
        this.moveFocus(-1);
        return;
      case KEYS.ENTER:
        this.confirmOrCancel();
        return;
      case KEYS.ESCAPE:
        this.cancel();
        return;
    }
  }

  private confirmOrCancel(): void {
    if (this.focusIndex === 1) {
      this.confirm(this.options.options[this.selectedIndex].value);
      return;
    }
    this.cancel();
  }

  render(opts: IDialogRenderOptions): string[] {
    const { theme, innerWidth, lines } = initSimpleDialogRender(opts);

    appendDialogHeader(lines, this.options.title, innerWidth, theme);

    // Options list
    const visibleOptions = this.options.options.slice(
      this.scrollOffset,
      this.scrollOffset + this.maxVisible,
    );

    const listFocused = this.focusIndex === 0;

    for (let i = 0; i < visibleOptions.length; i++) {
      const opt = visibleOptions[i];
      const actualIndex = this.scrollOffset + i;
      const isSelected = actualIndex === this.selectedIndex;
      const prefix = isSelected ? (listFocused ? "▶" : "•") : " ";
      const label = `${prefix} ${opt.label}`;
      const styledLabel = isSelected && listFocused ? colorize(label, theme.treeSelected, theme.reset) : label;
      lines.push(renderDialogLine(`  ${styledLabel}`, innerWidth, theme));
    }

    // Scroll indicator
    if (this.options.options.length > this.maxVisible) {
      const canScrollUp = this.scrollOffset > 0;
      const canScrollDown = this.scrollOffset + this.maxVisible < this.options.options.length;
      const scrollIndicator = `${canScrollUp ? "↑" : " "} ${this.scrollOffset + 1}-${
        Math.min(this.scrollOffset + this.maxVisible, this.options.options.length)
      }/${this.options.options.length} ${canScrollDown ? "↓" : " "}`;
      lines.push(renderBoxLineCentered(colorize(scrollIndicator, theme.textDim, theme.reset), innerWidth, theme));
    }

    // Buttons
    const buttons = [
      { text: "Select", focused: this.focusIndex === 1 },
      { text: TUI_LABEL_CANCEL, focused: this.focusIndex === 2 },
    ];

    appendDialogFooter(lines, buttons, innerWidth, theme);

    return lines;
  }

  getResult(): DialogResult<T> {
    return createDialogResult(this.state, this._resultValue);
  }
}

// ===== Rendering Helpers =====

/**
 * Render top border with optional title
 */
export function renderBoxTop(width: number, title: string, theme: ITuiTheme): string {
  const titleLen = visibleLength(title);
  const leftLen = 2;
  const rightLen = Math.max(0, width - leftLen - titleLen);
  const left = BOX.horizontal.repeat(leftLen);
  const right = BOX.horizontal.repeat(rightLen);
  return colorize(
    `${BOX.topLeft}${left}${title}${right}${BOX.topRight}`,
    theme.border,
    theme.reset,
  );
}

/**
 * Render bottom border
 */
export function renderBoxBottom(width: number, theme: ITuiTheme): string {
  return colorize(
    `${BOX.bottomLeft}${BOX.horizontal.repeat(width)}${BOX.bottomRight}`,
    theme.border,
    theme.reset,
  );
}

/**
 * Render a box line with content
 */
export function renderBoxLine(content: string, width: number, theme: ITuiTheme): string {
  const paddedContent = padEnd(content, width);
  const border = colorize(BOX.vertical, theme.border, theme.reset);
  return `${border}${paddedContent}${border}`;
}

/**
 * Render a centered box line
 */
export function renderBoxLineCentered(content: string, width: number, theme: ITuiTheme): string {
  const contentLen = visibleLength(content);
  const leftPad = Math.floor((width - contentLen) / 2);
  const rightPad = width - contentLen - leftPad;
  const paddedContent = " ".repeat(leftPad) + content + " ".repeat(rightPad);
  const border = colorize(BOX.vertical, theme.border, theme.reset);
  return `${border}${paddedContent}${border}`;
}

/**
 * Render a button
 */
export function renderButton(
  text: string,
  focused: boolean,
  destructive: boolean,
  theme: ITuiTheme,
  disabled: boolean = false,
): string {
  const wrapper = focused ? ["[", "]"] : [" ", " "];
  const buttonText = `${wrapper[0]}${text}${wrapper[1]}`;

  if (disabled) {
    return colorize(buttonText, theme.textDim, theme.reset);
  }
  if (focused) {
    if (destructive) {
      return colorize(buttonText, theme.error, theme.reset);
    }
    return colorize(buttonText, theme.primary, theme.reset);
  }
  return buttonText;
}

/**
 * Render an input field
 */
export function renderInputField(
  value: string,
  width: number,
  focused: boolean,
  editing: boolean,
  isPlaceholder: boolean,
  theme: ITuiTheme,
): string {
  const displayValue = value.slice(0, width - 2).padEnd(width - 2);
  const borderColor = focused ? theme.borderActive : theme.border;
  const textColor = isPlaceholder ? theme.textDim : "";

  let content = colorize(displayValue, textColor, theme.reset);
  if (editing) {
    content = colorize(displayValue, `${ANSI.inverse}`, theme.reset);
  }

  const leftBracket = colorize("[", borderColor, theme.reset);
  const rightBracket = colorize("]", borderColor, theme.reset);

  return `${leftBracket}${content}${rightBracket}`;
}

/**
 * Wrap text to width
 */
export function wrapToWidth(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

// ===== Dialog Render Setup Helper =====

/**
 * Common render setup for dialogs - extracts duplicated initialization code
 */
export function setupDialogRender(options: IDialogRenderOptions): {
  width: number;
  height: number;
  theme: ITuiTheme;
  lines: string[];
  innerWidth: number;
} {
  const width = options.width;
  const height = options.height || TUI_DIALOG_DEFAULT_HEIGHT;
  const theme = getTheme(options.useColors);
  const lines: string[] = [];
  const innerWidth = Math.min(options.width - TUI_DIALOG_INNER_PADDING, TUI_LAYOUT_DIALOG_WIDTH);
  return { width, height, theme, lines, innerWidth };
}

/**
 * Render common dialog ending with buttons and bottom border
 */
export function renderDialogEnding(
  buttonsLine: string,
  innerWidth: number,
  theme: ITuiTheme,
  lines: string[],
): void {
  lines.push(renderBoxLineCentered(buttonsLine, innerWidth, theme));
  lines.push(renderBoxLine("", innerWidth, theme));
  lines.push(renderBoxBottom(innerWidth, theme));
}

/**
 * Render memory update proposal information
 */
export function renderProposalInfo(
  proposal: IMemoryUpdateProposal,
  innerWidth: number,
  theme: ITuiTheme,
  lines: string[],
  options: { showScope?: boolean; showCategory?: boolean } = {},
): void {
  const { showScope = true, showCategory = true } = options;

  // Operation and scope
  const operation = proposal.operation || "add";
  const scope = proposal.target_scope || MemoryScope.GLOBAL;
  const project = proposal.target_project ? ` (${proposal.target_project})` : "";

  lines.push(
    renderBoxLine(`  Operation: ${operation}${showScope ? ` | Scope: ${scope}${project}` : ""}`, innerWidth, theme),
  );

  // Learning title
  if (proposal.learning?.title) {
    lines.push(renderBoxLine(`  Title: ${proposal.learning.title}`, innerWidth, theme));
  }

  // Category if requested
  if (showCategory && proposal.learning?.category) {
    lines.push(renderBoxLine(`  Category: ${proposal.learning.category}`, innerWidth, theme));
  }

  // Agent and reason
  if (proposal.identity_id) {
    lines.push(renderBoxLine(`  Identity: ${proposal.identity_id}`, innerWidth, theme));
  }

  if (proposal.reason) {
    const reason = proposal.reason.length > innerWidth - 10
      ? proposal.reason.slice(0, innerWidth - 13) + "..."
      : proposal.reason;
    lines.push(renderBoxLine(`  Reason: ${reason}`, innerWidth, theme));
  }

  lines.push(renderBoxLine("", innerWidth, theme));
}
