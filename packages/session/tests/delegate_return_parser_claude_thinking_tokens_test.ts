/**
 * @module DelegateReturnParserClaudeThinkingTokensTest
 * @path packages/session/tests/delegate_return_parser_claude_thinking_tokens_test.ts
 * @description Phase 167 Step 12 — RED-first test. Claude Code CLI's `--output-format json`
 * `result` event forwards Anthropic's real usage object verbatim (parseClaudeResult already
 * reads input_tokens/output_tokens matching Anthropic's raw API field names, not CLI-specific
 * renames), so when extended thinking is used it also forwards
 * usage.output_tokens_details.thinking_tokens — but parseClaudeResult never reads that field.
 * thinking_tokens is a SUBSET of output_tokens (billed as output), so total accounting is
 * unaffected — this is purely a dropped-visibility gap, independent of the direct-API
 * Anthropic parser's identical gap (this is a separate parser for a separate call path: the
 * embedded CLI-delegate provider and headless session-delegate launcher, not the direct API).
 * @architectural-layer Services
 * @related-files [packages/session/src/delegate_return_parser.ts]
 */

import { assertEquals } from "@std/assert";
import { parseDelegateStdout } from "@exaix/session/delegate_return_parser.ts";

Deno.test("[delegate_return_parser] claude-code parseClaudeResult maps output_tokens_details.thinking_tokens into tokenStats.reasoning", () => {
  const stdout = JSON.stringify({
    type: "result",
    result: "Here is the change I made.",
    usage: {
      input_tokens: 150,
      output_tokens: 2340,
      output_tokens_details: { thinking_tokens: 2048 },
    },
    total_cost_usd: 0.42,
  });

  const result = parseDelegateStdout(stdout, "claude-code");

  assertEquals(result.lastText, "Here is the change I made.");
  assertEquals(result.tokenStats.reasoning, 2048);
  // thinking_tokens is a SUBSET of output_tokens — existing total accounting is unaffected.
  assertEquals(result.tokenStats.output, 2340);
  assertEquals(result.tokenStats.total, 150 + 2340);
  assertEquals(result.costUsd, 0.42);
});

Deno.test("[delegate_return_parser] claude-code result with no thinking breakdown maps tokenStats.reasoning to undefined, not 0", () => {
  const stdout = JSON.stringify({
    type: "result",
    result: "Done.",
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  const result = parseDelegateStdout(stdout, "claude-code");

  assertEquals(result.tokenStats.reasoning, undefined);
});
