/**
 * @module CliDelegateStreamParserCacheTokensTest
 * @path packages/execution/tests/agents/cli_delegate_stream_parser_cache_tokens_test.ts
 * @related-files [packages/execution/src/strategies/cli_delegate_stream_parser.ts]
 * @architectural-layer Services
 * @description Phase 140a Step 2 — RED-first test. Claude Code CLI's real
 * `--output-format stream-json` `result` event reports
 * cache_creation_input_tokens/cache_read_input_tokens when prompt caching was used, but
 * IStreamResultEvent.usage only declares input_tokens/output_tokens — the real cache fields
 * are dropped at parse time, independent of the direct-API Anthropic parser's identical gap
 * (this is a separate parser for a separate call path). Verifies
 * parseCliDelegateStreamTurn surfaces cacheRead/cacheCreation on ICliDelegateTurnResult
 * .tokenStats.
 */

import { assertEquals } from "@std/assert";
import { parseCliDelegateStreamTurn } from "@exaix/execution";

Deno.test("parseCliDelegateStreamTurn: result event with cache fields maps into tokenStats.cacheRead/cacheCreation", () => {
  const lines = [
    '{"type":"system","subtype":"init","session_id":"s1"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello there, friend!"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Hello there, friend!","total_cost_usd":0.061,"usage":{"input_tokens":2,"output_tokens":10,"cache_creation_input_tokens":500,"cache_read_input_tokens":100}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.tokenStats.cacheRead, 100);
  assertEquals(turn.tokenStats.cacheCreation, 500);
  // Existing fields remain correct.
  assertEquals(turn.tokenStats.input, 2);
  assertEquals(turn.tokenStats.output, 10);
});

Deno.test("parseCliDelegateStreamTurn: a result event with no cache fields maps to undefined, not 0", () => {
  const lines = [
    '{"type":"result","result":"done","usage":{"input_tokens":1,"output_tokens":1}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.tokenStats.cacheRead, undefined);
  assertEquals(turn.tokenStats.cacheCreation, undefined);
});
