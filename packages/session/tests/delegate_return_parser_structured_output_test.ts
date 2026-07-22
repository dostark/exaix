/**
 * @module DelegateReturnParserStructuredOutputTest
 * @path packages/session/tests/delegate_return_parser_structured_output_test.ts
 * @description Phase 151 Step 4 — verifies parseClaudeResult() prefers
 * structured_output over result when both are present, and falls back to
 * result when structured_output is absent.
 */
import { assertEquals } from "@std/assert";
import { parseDelegateStdout } from "../src/delegate_return_parser.ts";

Deno.test("parseClaudeResult prefers structured_output over result when both present", () => {
  const stdout = JSON.stringify({
    type: "result",
    result: "free text response",
    structured_output: { title: "Test Plan", description: "A plan", steps: [] },
    usage: { input_tokens: 10, output_tokens: 20 },
  });
  const parsed = parseDelegateStdout(stdout, "claude-code");
  assertEquals(parsed.lastText, JSON.stringify({ title: "Test Plan", description: "A plan", steps: [] }));
});

Deno.test("parseClaudeResult falls back to result when structured_output is absent", () => {
  const stdout = JSON.stringify({
    type: "result",
    result: "fallback text",
    usage: { input_tokens: 5, output_tokens: 15 },
  });
  const parsed = parseDelegateStdout(stdout, "claude-code");
  assertEquals(parsed.lastText, "fallback text");
});

Deno.test("parseClaudeResult falls back to result when structured_output is null", () => {
  const stdout = JSON.stringify({
    type: "result",
    result: "null structured output fallback",
    structured_output: null,
    usage: { input_tokens: 3, output_tokens: 7 },
  });
  const parsed = parseDelegateStdout(stdout, "claude-code");
  assertEquals(parsed.lastText, "null structured output fallback");
});
