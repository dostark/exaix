/**
 * @module KeyBindingsBase
 * @path packages/tui/src/base/key_bindings_base.ts
 * @description Base class for defining typed key binding collections, ensuring consistency across TUI components.
 * @architectural-layer TUI
 * @ungrounded
 * @related-files ["packages/tui/src/helpers/keyboard.ts"]
 */

import type { IKeyBinding, KeyHandler } from "@exaix/tui/helpers/keyboard.ts";

/** Base class for key binding collections with typed KEY_BINDINGS arrays. */
export abstract class KeyBindingsBase<
  TAction extends string | KeyHandler = string | KeyHandler,
  TCategory extends string = string,
> {
  /** The key bindings collection for this component. */
  abstract readonly KEY_BINDINGS: readonly IKeyBinding<TAction>[];

  /**
   * Get all key bindings for this component.
   */
  getKeyBindings(): IKeyBinding<string | KeyHandler>[] {
    return [...this.KEY_BINDINGS];
  }

  /**
   * Find a key binding by action.
   */
  findBindingByAction(action: TAction): IKeyBinding<TAction> | undefined {
    return this.KEY_BINDINGS.find((binding) => binding.action === action);
  }

  /**
   * Find a key binding by key.
   */
  findBindingByKey(key: string): IKeyBinding<TAction> | undefined {
    return this.KEY_BINDINGS.find((binding) => binding.key === key);
  }

  /**
   * Get all actions available in this key binding collection.
   */
  getActions(): TAction[] {
    return this.KEY_BINDINGS.map((binding) => binding.action);
  }

  /**
   * Get all keys used in this key binding collection.
   */
  getKeys(): string[] {
    return this.KEY_BINDINGS.map((binding) => binding.key);
  }
}
