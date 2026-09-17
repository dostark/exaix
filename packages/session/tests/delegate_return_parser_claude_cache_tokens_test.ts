/**
 * @module DelegateReturnParserClaudeCacheTokensTest
 * @path packages/session/tests/delegate_return_parser_claude_cache_tokens_test.ts
 * @description Claude Code CLI's `--output-format json` `result` event forwards
 * Anthropic's real usage object verbatim, including `cache_read_input_tokens` and
 * `cache_creation_input_tokens` — but parseClaudeResult never read them, so every
 * cli-delegate call through claude-code silently dropped its cache-token visibility
 * (opencode and codex already populate tokenStats.cacheRead/cacheCreation).
 * @architectural-layer Services
 * @related-files [packages/session/src/delegate_return_parser.ts]
 */

import { assertEquals } from "@std/assert";
import { parseDelegateStdout } from "@exaix/session/delegate_return_parser.ts";

Deno.test("[delegate_return_parser] claude-code parseClaudeResult maps cache_read/creation_input_tokens into tokenStats", () => {
  const stdout = JSON.stringify({
    type: "result",
    result: "Here is the change I made.",
    usage: {
      input_tokens: 8,
      output_tokens: 2428,
      cache_read_input_tokens: 134127,
      cache_creation_input_tokens: 19773,
    },
    total_cost_usd: 0.1366,
  });

  const result = parseDelegateStdout(stdout, "claude-code");

  assertEquals(result.tokenStats.cacheRead, 134127);
  assertEquals(result.tokenStats.cacheCreation, 19773);
  // Cache tokens are additional to input/output — existing total accounting is unaffected.
  assertEquals(result.tokenStats.total, 8 + 2428);
});

Deno.test("[delegate_return_parser] claude-code result with no cache usage maps tokenStats.cacheRead/cacheCreation to undefined, not 0", () => {
  const stdout = JSON.stringify({
    type: "result",
    result: "Done.",
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  const result = parseDelegateStdout(stdout, "claude-code");

  assertEquals(result.tokenStats.cacheRead, undefined);
  assertEquals(result.tokenStats.cacheCreation, undefined);
});
