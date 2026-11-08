/**
 * @module ExaCtlShellTest
 * @path apps/exactl/tests/exactl_shell_test.ts
 * @description Verifies the shell quoting of printed command text: quotes, substitutions, control characters, plain words and the echo limit.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/exactl_shell.ts]
 * @related-files [apps/exactl/src/exactl_shell.ts]
 */

import { assertEquals } from "@std/assert";
import { MAX_HINT_ECHO_CHARS, quoteArgument, quoteForShell } from "../src/exactl_shell.ts";

Deno.test("quoteForShell neutralizes quotes, $(…), backticks, newlines and control characters, and truncates at MAX_HINT_ECHO_CHARS", () => {
  assertEquals(quoteForShell("Fix bug"), "'Fix bug'");
  assertEquals(quoteForShell("it's"), `'it'\\''s'`);
  assertEquals(quoteForShell("$(rm -rf ~)"), "'$(rm -rf ~)'");
  assertEquals(quoteForShell("`id`"), "'`id`'");
  assertEquals(quoteForShell("a\nb"), "'ab'");
  assertEquals(quoteForShell("a\u0007b\u001b[31mc"), "'ab[31mc'");
  const long = "a".repeat(MAX_HINT_ECHO_CHARS + 10);
  assertEquals(quoteForShell(long), `'${"a".repeat(MAX_HINT_ECHO_CHARS)}'`);
});

Deno.test("quoteArgument keeps a plain word, quotes other text and removes control characters without cutting", () => {
  assertEquals(quoteArgument("plan-1.md"), "plan-1.md");
  assertEquals(quoteArgument("feat/request-x:1"), "feat/request-x:1");
  assertEquals(quoteArgument("my plan"), "'my plan'");
  assertEquals(quoteArgument("it's"), `'it'\\''s'`);
  assertEquals(quoteArgument("a\u001bb"), "ab");
  const long = "a".repeat(MAX_HINT_ECHO_CHARS * 3);
  assertEquals(quoteArgument(long), long);
});
