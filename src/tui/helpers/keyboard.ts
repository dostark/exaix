/**
 * @module KeyboardManager
 * @path src/tui/helpers/keyboard.ts
 * @description TUI keyboard handling utilities for consistent key management and binding.
 * @architectural-layer Helpers
 * * @related-files [src/helpers/tree_view.ts]
 */

import { KeyModifier } from "@exaix/core";

// ===== Key Handling Interfaces =====

export type KeyHandler = (key: string) => boolean | void | Promise<boolean | void>;

export interface IKeyEvent {
  key: string;
  modifiers: Set<KeyModifier>;
  raw?: string;
}

export interface IKeyBinding<TAction extends string | KeyHandler = string, TCategory extends string = string> {
  key: KeyValue;
  modifiers?: KeyModifier[];
  action: TAction;
  description: string;
  category?: TCategory;
  global?: boolean;
}

export interface IKeyBindingGroup<TAction extends string | KeyHandler = string> {
  name: string;
  bindings: IKeyBinding<TAction>[];
}

export interface IKeyHandlerMap {
  [key: string]: KeyHandler;
}

export interface INavigationState {
  selectedIndex: number;
  length: number;
  pageSize?: number;
}

// ===== Key Constants =====

/**
 * All possible key values for key bindings
 * This object serves as both the type definition and runtime constants
 */
export const KEYS = {
  // Navigation keys
  UP: "up",
  DOWN: "down",
  LEFT: "left",
  RIGHT: "right",
  HOME: "home",
  END: "end",
  PAGE_UP: "pageup",
  PAGE_DOWN: "pagedown",

  // Action keys
  ENTER: "enter",
  ESCAPE: "escape",
  TAB: "tab",
  CAP_TAB: "Tab",
  SPACE: "space",
  BACKSPACE: "backspace",
  DELETE: "delete",

  // Common shortcuts
  CTRL_C: "ctrl+c",
  CTRL_D: "ctrl+d",
  CTRL_Q: "ctrl+q",
  CTRL_S: "ctrl+s",
  CTRL_R: "ctrl+r",
  CTRL_L: "ctrl+l",

  // Single character keys (lowercase)
  A: "a",
  B: "b",
  C: "c",
  D: "d",
  E: "e",
  F: "f",
  G: "g",
  H: "h",
  I: "i",
  J: "j",
  K: "k",
  L: "l",
  M: "m",
  N: "n",
  O: "o",
  P: "p",
  Q: "q",
  R: "r",
  S: "s",
  T: "t",
  U: "u",
  V: "v",
  W: "w",
  X: "x",
  Y: "y",
  Z: "z",

  // Single character keys (uppercase/special)
  CAP_A: "A",
  CAP_B: "B",
  CAP_C: "C",
  CAP_D: "D",
  CAP_E: "E",
  CAP_F: "F",
  CAP_G: "G",
  CAP_H: "H",
  CAP_I: "I",
  CAP_J: "J",
  CAP_K: "K",
  CAP_L: "L",
  CAP_M: "M",
  CAP_N: "N",
  CAP_O: "O",
  CAP_P: "P",
  CAP_Q: "Q",
  CAP_R: "R",
  CAP_S: "S",
  CAP_T: "T",
  CAP_U: "U",
  CAP_V: "V",
  CAP_W: "W",
  CAP_X: "X",
  CAP_Y: "Y",
  CAP_Z: "Z",

  // Special characters
  QUESTION: "?",
  SLASH: "/",
  F1: "f1",
  ONE: "1",
  TWO: "2",
  THREE: "3",
  FOUR: "4",
  FIVE: "5",
  SIX: "6",
  SEVEN: "7",

  // Special key combinations
  SHIFT_TAB: "Shift+Tab",
  CTRL_LEFT: "Ctrl+Left",
  CTRL_RIGHT: "Ctrl+Right",
  CTRL_UP: "Ctrl+Up",
  CTRL_DOWN: "Ctrl+Down",
  ESC_Q: "Esc/q",
  ONE_TO_SEVEN: "1-7",
} as const;

/**
 * All possible key values for key bindings
 * Derived from the KEYS object values for type safety
 */
export type KeyValue = typeof KEYS[keyof typeof KEYS];

// ===== Key Validation =====

/**
 * All valid key values for runtime validation
 * Automatically derived from KEYS object values
 */
const VALID_KEY_VALUES = new Set(Object.values(KEYS));

/**
 * Type guard to validate if a string is a valid KeyValue
 */
export function isValidKeyValue(key: string): key is KeyValue {
  return VALID_KEY_VALUES.has(key as KeyValue);
}

// ===== Key Binding Categories =====

/**
 * Categories for organizing key bindings in help screens and documentation
 */
export enum KeyBindingCategory {
  NAVIGATION = "Navigation",
  ACTIONS = "Actions",
  VIEW = "View",
  HELP = "Help",
  LAYOUT = "Layout",
  GENERAL = "General",
}

// ===== Keyboard Manager =====

/**
 * Manages keyboard bindings and handlers
 */
export class KeyboardManager<TAction extends string | KeyHandler = string> {
  private bindings: Map<string, IKeyBinding<TAction>> = new Map();
  private handlers: Map<TAction, KeyHandler> = new Map();
  private enabled: boolean = true;

  /**
   * Register a key binding
   */
  bind(binding: IKeyBinding<TAction>): this {
    const key = this.normalizeKey(binding.key, binding.modifiers);
    this.bindings.set(key, binding);
    return this;
  }

  /**
   * Register multiple bindings
   */
  bindAll(bindings: IKeyBinding<TAction>[]): this {
    for (const binding of bindings) {
      this.bind(binding);
    }
    return this;
  }

  /**
   * Register a handler for an action
   */
  on(action: TAction, handler: KeyHandler): this {
    this.handlers.set(action, handler);
    return this;
  }

  /**
   * Handle a key press
   * Returns true if the key was handled
   */
  async handle(key: string): Promise<boolean> {
    if (!this.enabled) return false;

    const normalizedKey = this.normalizeKey(key);
    const binding = this.bindings.get(normalizedKey);

    if (!binding) return false;

    const handler = this.handlers.get(binding.action);
    if (!handler) return false;

    const result = await handler(key);
    return result !== false;
  }

  /**
   * Get all bindings
   */
  getBindings(): IKeyBinding<TAction>[] {
    return Array.from(this.bindings.values());
  }

  /**
   * Get bindings grouped by category
   */
  getBindingsByCategory(): Map<string, IKeyBinding<TAction>[]> {
    const groups = new Map<string, IKeyBinding<TAction>[]>();

    for (const binding of this.bindings.values()) {
      const category = binding.category ?? "General";
      const list = groups.get(category) ?? [];
      list.push(binding);
      groups.set(category, list);
    }

    return groups;
  }

  /**
   * Check if a binding exists for a key
   */
  hasBinding(key: string): boolean {
    return this.bindings.has(this.normalizeKey(key));
  }

  /**
   * Enable keyboard handling
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable keyboard handling
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Normalize key string for consistent matching
   */
  private normalizeKey(key: string, modifiers?: KeyModifier[]): string {
    let normalized = key.toLowerCase();

    // Already has modifiers in string form
    if (normalized.includes("+")) {
      const parts = normalized.split("+");
      const mods = parts.slice(0, -1).sort();
      normalized = [...mods, parts[parts.length - 1]].join("+");
    } else if (modifiers && modifiers.length > 0) {
      // Add modifiers prefix
      const sortedMods = [...modifiers].sort();
      normalized = `${sortedMods.join("+")}+${normalized}`;
    }

    return normalized;
  }
}

// ===== Common Navigation Handlers =====

/**
 * Create navigation key handlers
 */
export function createNavigationHandlers(
  getState: () => INavigationState,
  setState: (index: number) => void,
): IKeyHandlerMap {
  return {
    up: () => {
      const state = getState();
      if (state.selectedIndex > 0) {
        setState(state.selectedIndex - 1);
        return true;
      }
      return false;
    },
    down: () => {
      const state = getState();
      if (state.selectedIndex < state.length - 1) {
        setState(state.selectedIndex + 1);
        return true;
      }
      return false;
    },
    home: () => {
      setState(0);
      return true;
    },
    end: () => {
      const state = getState();
      setState(Math.max(0, state.length - 1));
      return true;
    },
    pageup: () => {
      const state = getState();
      const pageSize = state.pageSize ?? 10;
      setState(Math.max(0, state.selectedIndex - pageSize));
      return true;
    },
    pagedown: () => {
      const state = getState();
      const pageSize = state.pageSize ?? 10;
      setState(Math.min(state.length - 1, state.selectedIndex + pageSize));
      return true;
    },
  };
}

// ===== Key Parsing =====

/**
 * Parse raw key input to IKeyEvent
 */
export function parseKey(raw: string): IKeyEvent {
  const modifiers = new Set<KeyModifier>();
  let key = raw.toLowerCase();

  // Check for modifier prefixes
  if (key.startsWith("ctrl+") || key.startsWith("c-")) {
    modifiers.add(KeyModifier.CTRL);
    key = key.replace(/^(ctrl\+|c-)/, "");
  }
  if (key.startsWith("alt+") || key.startsWith("m-")) {
    modifiers.add(KeyModifier.ALT);
    key = key.replace(/^(alt\+|m-)/, "");
  }
  if (key.startsWith("shift+") || key.startsWith("s-")) {
    modifiers.add(KeyModifier.SHIFT);
    key = key.replace(/^(shift\+|s-)/, "");
  }
  if (key.startsWith("meta+") || key.startsWith("super+")) {
    modifiers.add(KeyModifier.META);
    key = key.replace(/^(meta\+|super\+)/, "");
  }

  return { key, modifiers, raw };
}

/**
 * Format key for display
 */
export function formatKey(key: string, modifiers?: KeyModifier[]): string {
  const parts: string[] = [];

  if (modifiers) {
    if (modifiers.includes(KeyModifier.CTRL)) parts.push("Ctrl");
    if (modifiers.includes(KeyModifier.ALT)) parts.push("Alt");
    if (modifiers.includes(KeyModifier.SHIFT)) parts.push("Shift");
    if (modifiers.includes(KeyModifier.META)) parts.push("Meta");
  }

  // Capitalize special keys
  const displayKey = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);

  parts.push(displayKey);

  return parts.join("+");
}

/**
 * Check if key matches a pattern
 */
export function matchesKey(key: string, pattern: string): boolean {
  const keyEvent = parseKey(key);
  const patternEvent = parseKey(pattern);

  if (keyEvent.key !== patternEvent.key) return false;

  // Check all modifiers match
  if (keyEvent.modifiers.size !== patternEvent.modifiers.size) return false;
  for (const mod of patternEvent.modifiers) {
    if (!keyEvent.modifiers.has(mod)) return false;
  }

  return true;
}

// ===== Help Screen Generation =====

/**
 * Generate help screen content from key bindings
 */
export function generateHelpScreen<TAction extends string | KeyHandler>(
  bindings: IKeyBinding<TAction>[],
  options: { title?: string; useColors?: boolean } = {},
): string[] {
  const { title = "Keyboard Shortcuts", useColors = true } = options;
  const lines: string[] = [];

  // Group by category
  const categories = new Map<string, IKeyBinding<TAction>[]>();
  for (const binding of bindings) {
    const cat = binding.category ?? "General";
    const list = categories.get(cat) ?? [];
    list.push(binding);
    categories.set(cat, list);
  }

  // Title
  if (useColors) {
    lines.push(`\x1b[1;36m${title}\x1b[0m`);
  } else {
    lines.push(title);
  }
  lines.push("");

  // Render each category
  for (const [category, catBindings] of categories) {
    if (useColors) {
      lines.push(`\x1b[1m${category}\x1b[0m`);
    } else {
      lines.push(category);
    }

    for (const binding of catBindings) {
      const keyStr = formatKey(binding.key, binding.modifiers);
      const keyDisplay = keyStr.padEnd(15);

      if (useColors) {
        lines.push(`  \x1b[33m${keyDisplay}\x1b[0m ${binding.description}`);
      } else {
        lines.push(`  ${keyDisplay} ${binding.description}`);
      }
    }

    lines.push("");
  }

  return lines;
}
