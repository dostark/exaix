/**
 * @module ParsingPackageConstantsTest
 * @path packages/parsing/tests/constants_test.ts
 * @description Verifies @exaix/parsing package-local constants and enums are exported and behave as expected.
 */
import { assertEquals, assertMatch } from "@std/assert";
import { FRONTMATTER_REGEX, ParserActivityActionType } from "@exaix/parsing";
import { SYSTEM_ACTIVITY_ACTOR } from "@exaix/core";

Deno.test("Parsing package constants are accessible and correct", () => {
  assertEquals(SYSTEM_ACTIVITY_ACTOR, "system");
  assertEquals(ParserActivityActionType.REQUEST_VALIDATED, "request.validated");
  assertEquals(ParserActivityActionType.REQUEST_VALIDATION_FAILED, "request.validation_failed");

  const markdown = "---\nfoo: bar\n---\nbody\n";
  assertMatch(markdown, FRONTMATTER_REGEX);
});
