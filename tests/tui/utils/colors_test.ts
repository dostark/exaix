/**
 * @module TUIColorsTest
 * @path tests/tui/utils/colors_test.ts
 * @description Verifies the logic for ANSI color and style code management in the TUI,
 * ensuring correct visual feedback across different terminal environments.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { EvaluationVerdict } from "@exaix/core";
import {
  ANSI,
  bold,
  center,
  colorize,
  defaultTheme,
  dim,
  error,
  getTheme,
  info,
  noColorTheme,
  padEnd,
  padStart,
  stripAnsi,
  success,
  visibleLength,
  warning,
} from "../../../src/tui/helpers/colors.ts";

// ===== ANSI Constants Tests =====

Deno.test("ANSI: has reset code", () => {
  assertEquals(ANSI.reset, "\x1b[0m");
});

Deno.test("ANSI: has standard colors", () => {
  assertEquals(ANSI.red, "\x1b[31m");
  assertEquals(ANSI.green, "\x1b[32m");
  assertEquals(ANSI.yellow, "\x1b[33m");
  assertEquals(ANSI.blue, "\x1b[34m");
  assertEquals(ANSI.cyan, "\x1b[36m");
});

Deno.test("ANSI: has style codes", () => {
  assertEquals(ANSI.bold, "\x1b[1m");
  assertEquals(ANSI.dim, "\x1b[2m");
  assertEquals(ANSI.italic, "\x1b[3m");
  assertEquals(ANSI.underline, "\x1b[4m");
});

// ===== Theme Tests =====

Deno.test("getTheme: returns default theme when colors enabled", () => {
  const theme = getTheme(true);
  assertEquals(theme, defaultTheme);
  assertStringIncludes(theme.primary, "\x1b[");
});

Deno.test("getTheme: returns no-color theme when colors disabled", () => {
  const theme = getTheme(false);
  assertEquals(theme, noColorTheme);
  assertEquals(theme.primary, "");
  assertEquals(theme.reset, "");
});

Deno.test("noColorTheme: all values are empty strings", () => {
  for (const [key, value] of Object.entries(noColorTheme)) {
    assertEquals(value, "", `noColorTheme.${key} should be empty`);
  }
});

Deno.test("defaultTheme: has all required keys", () => {
  const requiredKeys = [
    "primary",
    "secondary",
    "accent",
    "border",
    "text",
    "success",
    "warning",
    "error",
    "info",
    "reset",
  ];
  for (const key of requiredKeys) {
    assertEquals(key in defaultTheme, true, `Theme should have key: ${key}`);
  }
});

// ===== Colorize Tests =====

Deno.test("colorize: wraps text with color and reset", () => {
  const result = colorize("hello", ANSI.red);
  assertEquals(result, `${ANSI.red}hello${ANSI.reset}`);
});

Deno.test("colorize: returns plain text when color is empty", () => {
  const result = colorize("hello", "");
  assertEquals(result, "hello");
});

Deno.test("colorize: uses custom reset", () => {
  const result = colorize("hello", ANSI.red, ANSI.blue);
  assertEquals(result, `${ANSI.red}hello${ANSI.blue}`);
});

// ===== Helper Function Tests =====

Deno.test("bold: applies bold styling when colors enabled", () => {
  const result = bold("hello", true);
  assertStringIncludes(result, ANSI.bold);
  assertStringIncludes(result, "hello");
});

Deno.test("bold: returns plain text when colors disabled", () => {
  const result = bold("hello", false);
  assertEquals(result, "hello");
});

Deno.test("dim: applies dim styling when colors enabled", () => {
  const result = dim("hello", true);
  assertStringIncludes(result, ANSI.dim);
});

Deno.test("success: applies green color", () => {
  const result = success("ok", true);
  assertStringIncludes(result, ANSI.green);
});

Deno.test("warning: applies yellow color", () => {
  const result = warning("caution", true);
  assertStringIncludes(result, ANSI.yellow);
});

Deno.test("error: applies red color", () => {
  const result = error(EvaluationVerdict.FAIL, true);
  assertStringIncludes(result, ANSI.red);
});

Deno.test("info: applies blue color", () => {
  const result = info("note", true);
  assertStringIncludes(result, ANSI.blue);
});

// ===== Strip ANSI Tests =====

Deno.test("stripAnsi: removes color codes", () => {
  const colored = `${ANSI.red}hello${ANSI.reset}`;
  const stripped = stripAnsi(colored);
  assertEquals(stripped, "hello");
});

Deno.test("stripAnsi: handles multiple codes", () => {
  const colored = `${ANSI.bold}${ANSI.red}hello${ANSI.reset} ${ANSI.blue}world${ANSI.reset}`;
  const stripped = stripAnsi(colored);
  assertEquals(stripped, "hello world");
});

Deno.test("stripAnsi: handles text without codes", () => {
  const plain = "hello world";
  const stripped = stripAnsi(plain);
  assertEquals(stripped, "hello world");
});

// ===== Visible Length Tests =====

Deno.test("visibleLength: calculates length excluding ANSI codes", () => {
  const colored = `${ANSI.red}hello${ANSI.reset}`;
  assertEquals(visibleLength(colored), 5);
});

Deno.test("visibleLength: handles plain text", () => {
  assertEquals(visibleLength("hello"), 5);
});

Deno.test("visibleLength: handles multiple codes", () => {
  const colored = `${ANSI.bold}a${ANSI.reset}${ANSI.red}b${ANSI.reset}`;
  assertEquals(visibleLength(colored), 2);
});

// ===== Padding Tests =====

Deno.test("padEnd: pads plain text to width", () => {
  const result = padEnd("hi", 5);
  assertEquals(result, "hi   ");
  assertEquals(result.length, 5);
});

Deno.test("padEnd: pads colored text correctly", () => {
  const colored = `${ANSI.red}hi${ANSI.reset}`;
  const result = padEnd(colored, 5);
  assertEquals(visibleLength(result), 5);
  assertStringIncludes(result, "hi");
});

Deno.test("padEnd: does not truncate if text is longer", () => {
  const result = padEnd("hello world", 5);
  assertEquals(result, "hello world");
});

Deno.test("padEnd: uses custom padding character", () => {
  const result = padEnd("hi", 5, "-");
  assertEquals(result, "hi---");
});

Deno.test("padStart: pads from the start", () => {
  const result = padStart("hi", 5);
  assertEquals(result, "   hi");
});

Deno.test("padStart: pads colored text correctly", () => {
  const colored = `${ANSI.red}hi${ANSI.reset}`;
  const result = padStart(colored, 5);
  assertEquals(visibleLength(result), 5);
});

Deno.test("center: centers text", () => {
  const result = center("hi", 6);
  assertEquals(result, "  hi  ");
});

Deno.test("center: handles odd width", () => {
  const result = center("hi", 5);
  // Should be " hi  " or "  hi " - just check length
  assertEquals(result.length, 5);
  assertStringIncludes(result, "hi");
});

Deno.test("center: centers colored text", () => {
  const colored = `${ANSI.red}hi${ANSI.reset}`;
  const result = center(colored, 6);
  assertEquals(visibleLength(result), 6);
});
