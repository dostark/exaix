/**
 * @module DelegateReturnParserOpencodeCacheTokensTest
 * @path packages/session/tests/delegate_return_parser_opencode_cache_tokens_test.ts
 * @description Phase 140a Step 2 — RED-first test. opencode's step_finish JSONL event's
 * part.tokens has no cache fields, dropping prompt-cache data independent of and separate
 * from Claude Code CLI's identical gap (a different parser, a different tool's event
 * format — completing one does not complete the other). Verifies handleStepFinishEvent/
 * parseDelegateStdout (tool: "opencode") surfaces cacheRead/cacheCreation on
 * IDelegateParsedReturn.tokenStats, using opencode's documented step_finish shape
 * (part.tokens.cache: {read, write}) — this specific field shape is Ledger:
 * LIVE_CACHE_TOKEN_VERIFICATION pending, since no live opencode probe with active prompt
 * caching has been captured yet (unlike the tool_use/tokens shape, which was captured live
 * on 2026-07-20 per delegate_return_parser_test.ts).
 * @architectural-layer Services
 * @related-files [packages/session/src/delegate_return_parser.ts]
 */

import { assertEquals } from "@std/assert";
import { parseDelegateStdout } from "@exaix/session/delegate_return_parser.ts";

Deno.test("[delegate_return_parser] opencode step_finish event with cache fields maps into tokenStats.cacheRead/cacheCreation", () => {
  const stdout =
    `{"type":"step_finish","part":{"tokens":{"input":100,"output":50,"total":150,"cache":{"read":20,"write":80}},"cost":0.002}}\n`;

  const result = parseDelegateStdout(stdout, "opencode");

  assertEquals(result.tokenStats.cacheRead, 20);
  assertEquals(result.tokenStats.cacheCreation, 80);
  // Existing fields remain correct.
  assertEquals(result.tokenStats.input, 100);
  assertEquals(result.tokenStats.output, 50);
});

Deno.test("[delegate_return_parser] opencode step_finish event with no cache field maps to undefined, not 0", () => {
  const stdout = `{"type":"step_finish","part":{"tokens":{"input":100,"output":50,"total":150},"cost":0.002}}\n`;

  const result = parseDelegateStdout(stdout, "opencode");

  assertEquals(result.tokenStats.cacheRead, undefined);
  assertEquals(result.tokenStats.cacheCreation, undefined);
});
