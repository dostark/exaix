// deno-lint-ignore-file no-explicit-any
/**
 * @module CommandUtilsTest
 * @path tests/cli/helpers/command_utils_test.ts
 * @description Tests for CommandUtils helper functions: formatValidationErrors, printMetadata.
 */

import { assertEquals } from "@std/assert";
import { CommandUtils } from "@exaix/cli/helpers/command_utils.ts";

// ──────────────────────────────────────────────────────────────────────
// formatValidationErrors
// ──────────────────────────────────────────────────────────────────────

Deno.test("CommandUtils.formatValidationErrors: returns empty string when valid", () => {
  assertEquals(CommandUtils.formatValidationErrors({ isValid: true, errors: [] }), "");
});

Deno.test("CommandUtils.formatValidationErrors: returns empty string even if errors present on valid result", () => {
  assertEquals(CommandUtils.formatValidationErrors({ isValid: true, errors: ["leftover"] }), "");
});

Deno.test("CommandUtils.formatValidationErrors: formats single error without colon", () => {
  const result = CommandUtils.formatValidationErrors({
    isValid: false,
    errors: ["Something went wrong"],
  });
  assertEquals(result, "Validation failed:\n- Something went wrong");
});

Deno.test("CommandUtils.formatValidationErrors: formats 'is required' errors", () => {
  const result = CommandUtils.formatValidationErrors({
    isValid: false,
    errors: ["reason: is required"],
  });
  assertEquals(result, "Validation failed:\n- Rejection reason is required");
});

Deno.test("CommandUtils.formatValidationErrors: capitalizes field for 'is required'", () => {
  const result = CommandUtils.formatValidationErrors({
    isValid: false,
    errors: ["name: is required"],
  });
  assertEquals(result, "Validation failed:\n- Name is required");
});

Deno.test("CommandUtils.formatValidationErrors: handles 'at least' pattern", () => {
  const result = CommandUtils.formatValidationErrors({
    isValid: false,
    errors: ["comments: at least one comment is required"],
  });
  assertEquals(result, "Validation failed:\n- At least one comment is required");
});

Deno.test("CommandUtils.formatValidationErrors: handles 'cannot' pattern", () => {
  const result = CommandUtils.formatValidationErrors({
    isValid: false,
    errors: ["name: cannot be empty"],
  });
  assertEquals(result, "Validation failed:\n- Name cannot be empty");
});

Deno.test("CommandUtils.formatValidationErrors: handles 'must' pattern", () => {
  const result = CommandUtils.formatValidationErrors({
    isValid: false,
    errors: ["length: must be positive"],
  });
  assertEquals(result, "Validation failed:\n- Length must be positive");
});

Deno.test("CommandUtils.formatValidationErrors: handles default colon format", () => {
  const result = CommandUtils.formatValidationErrors({
    isValid: false,
    errors: ["field: some unknown pattern here"],
  });
  assertEquals(result, "Validation failed:\n- Field: some unknown pattern here");
});

Deno.test("CommandUtils.formatValidationErrors: handles multiple errors", () => {
  const result = CommandUtils.formatValidationErrors({
    isValid: false,
    errors: ["reason: is required", "comments: at least one comment is required"],
  });
  assertEquals(
    result,
    "Validation failed:\n- Rejection reason is required\n- At least one comment is required",
  );
});

Deno.test("CommandUtils.formatValidationErrors: handles values containing colons", () => {
  const result = CommandUtils.formatValidationErrors({
    isValid: false,
    errors: ["url: invalid format: http://example.com"],
  });
  // key="url", rest="invalid format: http://example.com" - falls to the default
  assertEquals(result, "Validation failed:\n- Url: invalid format: http://example.com");
});

// ──────────────────────────────────────────────────────────────────────
// printMetadata
// ──────────────────────────────────────────────────────────────────────

Deno.test("CommandUtils.printMetadata: prints title and key-value pairs", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: Array<unknown>) => logs.push(args.join(" "));

  try {
    CommandUtils.printMetadata("Test Title", {
      name: "test",
      value: 42,
      empty: null,
    });

    // Should have: title, separator, "name" line, "value" line, empty line
    assertEquals(logs.length >= 3, true);
    assertEquals(logs[0], "\nTest Title");
    assertEquals(logs[1], "=".repeat("Test Title".length));
    // null values should be skipped
    const allContent = logs.join("\n");
    assertEquals(allContent.includes("empty"), false);
    assertEquals(allContent.includes("name"), true);
    assertEquals(allContent.includes("42"), true);
  } finally {
    console.log = originalLog;
  }
});

Deno.test("CommandUtils.printMetadata: handles undefined values", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: Array<unknown>) => logs.push(args.join(" "));

  try {
    CommandUtils.printMetadata("Info", {
      present: "yes",
      absent: (undefined as any) as string,
    });

    const allContent = logs.join("\n");
    assertEquals(allContent.includes("present"), true);
    assertEquals(allContent.includes("absent"), false);
  } finally {
    console.log = originalLog;
  }
});
