/**
 * @module KeyBindingsBaseRegressionTest
 * @path tests/tui/key_bindings_base_regression_test.ts
 * @description Regression tests for the core TUI key-binding system, ensuring type safety and
 * consistent behavior for complex keyboard interaction patterns.
 */

import { assertEquals } from "@std/assert";
import { KeyBindingsBase } from "../../src/tui/base/key_bindings_base.ts";
import type { IKeyBinding } from "../../src/tui/helpers/keyboard.ts";

// Test implementation of KeyBindingsBase
class TestKeyBindings extends KeyBindingsBase {
  readonly KEY_BINDINGS: readonly IKeyBinding[] = [
    { key: "a", action: "test-action-1", description: "Test action 1", category: "General" },
    { key: "b", action: "test-action-2", description: "Test action 2", category: "General" },
  ];
}

/**
 * Regression test for: KeyBindingsBase provides strict typing for KEY_BINDINGS collections
 * Root cause: KEY_BINDINGS collections used generic string types without centralized structure
 * Fix: Created KeyBindingsBase abstract class with strict typing and utility methods
 */
Deno.test("[regression] KeyBindingsBase provides strict typing and utility methods", () => {
  const keyBindings = new TestKeyBindings();

  // Test that KEY_BINDINGS is readonly and properly typed
  assertEquals(keyBindings.KEY_BINDINGS.length, 2);
  assertEquals(keyBindings.KEY_BINDINGS[0].key, "a");
  assertEquals(keyBindings.KEY_BINDINGS[0].action, "test-action-1");
  assertEquals(keyBindings.KEY_BINDINGS[0].description, "Test action 1");
  assertEquals(keyBindings.KEY_BINDINGS[0].category, "General");

  // Test utility methods
  const allBindings = keyBindings.getKeyBindings();
  assertEquals(allBindings.length, 2);

  // Returned list should be a copy
  allBindings.pop();
  assertEquals(keyBindings.KEY_BINDINGS.length, 2);

  const binding = keyBindings.findBindingByAction("test-action-1");
  assertEquals(binding?.key, "a");

  const nonExistent = keyBindings.findBindingByAction("non-existent");
  assertEquals(nonExistent, undefined);

  const byKey = keyBindings.findBindingByKey("b");
  assertEquals(byKey?.action, "test-action-2");

  const byKeyMissing = keyBindings.findBindingByKey("z");
  assertEquals(byKeyMissing, undefined);

  assertEquals(keyBindings.getActions(), ["test-action-1", "test-action-2"]);
  assertEquals(keyBindings.getKeys(), ["a", "b"]);
});
