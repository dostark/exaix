/**
 * @module SubjectGeneratorUnitTest
 * @path packages/cli/tests/helpers/subject_generator_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Unit tests for subject_generator utilities.
 */

import { assertEquals } from "@std/assert";
import { extractFallbackSubject, resolveSubject, validateSubject } from "@exaix/cli/helpers/subject_generator.ts";

Deno.test("extractFallbackSubject: handles empty input", () => {
  assertEquals(extractFallbackSubject(""), "");
});

Deno.test("extractFallbackSubject: cleans up markdown prefixes", () => {
  assertEquals(extractFallbackSubject("# My Title"), "My Title");
  assertEquals(extractFallbackSubject("- Item 1"), "Item 1");
  assertEquals(extractFallbackSubject("1. Numbered"), "Numbered");
  assertEquals(extractFallbackSubject("> Quote"), "Quote");
});

Deno.test("extractFallbackSubject: truncates at word boundary", () => {
  const longText = "This is a very long sentence that should be truncated at some point.";
  const result = extractFallbackSubject(longText, 20);
  assertEquals(result, "This is a very long…");
});

Deno.test("validateSubject: rejects non-strings", () => {
  assertEquals(validateSubject(123), null);
  assertEquals(validateSubject(null), null);
});

Deno.test("validateSubject: rejects multiline strings", () => {
  assertEquals(validateSubject("First line\nSecond line"), null);
});

Deno.test("validateSubject: rejects overly long strings", () => {
  assertEquals(validateSubject("a".repeat(81)), null);
});

Deno.test("validateSubject: rejects generic subjects if too long", () => {
  assertEquals(validateSubject("Request-123"), "Request-123");
  assertEquals(validateSubject("Request-" + "a".repeat(15)), null);
});

Deno.test("resolveSubject: uses explicit, then agent, then fallback", () => {
  const description = "My description";
  assertEquals(resolveSubject({ explicit: "User", description }), "User");
  assertEquals(resolveSubject({ agentSubject: "Agent", description }), "Agent");
  assertEquals(resolveSubject({ description }), "My description");
});
