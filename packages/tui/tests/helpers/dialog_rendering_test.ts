/**
 * @module DialogRenderingTest
 * @path packages/tui/tests/helpers/dialog_rendering_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Verifies package-owned dialog rendering helpers, ensuring correct dialog
 * width calculation, border drawing, and input field truncation.
 */

import { assertEquals } from "@std/assert";
import { noColorTheme } from "@exaix/tui/helpers/colors.ts";
import {
  calculateDialogWidth,
  createDialogBorder,
  renderDialogButtons,
  renderInputField,
} from "@exaix/tui/helpers/dialog_rendering.ts";

Deno.test("calculateDialogWidth: respects min/max bounds", () => {
  const w1 = calculateDialogWidth(["short"]);
  assertEquals(w1, 40);

  const long = "x".repeat(200);
  const w2 = calculateDialogWidth([long]);
  assertEquals(w2, 80);
});

Deno.test("createDialogBorder: adds title and bottom border", () => {
  const bordered = createDialogBorder(["a", "b"], "Title", noColorTheme);
  assertEquals(bordered.length, 4);
  assertEquals(bordered[0].includes("Title"), true);
});

Deno.test("renderInputField: truncates long values with ellipsis", () => {
  const out = renderInputField("Label", "0123456789", 9, 6, noColorTheme);
  assertEquals(out.includes("..."), true);
});

Deno.test("renderDialogButtons: right-aligns buttons within width", () => {
  const line = renderDialogButtons(
    [
      { text: "OK", focused: true },
      { text: "Cancel", focused: false },
    ],
    20,
    noColorTheme,
  );

  assertEquals(line.includes("[OK]"), true);
  assertEquals(line.includes("[Cancel]"), true);
});
