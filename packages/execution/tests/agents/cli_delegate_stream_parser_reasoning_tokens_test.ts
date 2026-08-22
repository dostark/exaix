/**
 * @module CliDelegateStreamParserReasoningTokensTest
 * @path packages/execution/tests/agents/cli_delegate_stream_parser_reasoning_tokens_test.ts
 * @related-files [packages/execution/src/strategies/cli_delegate_stream_parser.ts]
 * @architectural-layer Services
 * @description Phase 167 Step 12 — RED-first test. Claude Code CLI's real
 * `--output-format stream-json --verbose` `result` event reports
 * output_tokens_details.thinking_tokens when extended thinking was used, but
 * IStreamResultEvent.usage only declares input_tokens/output_tokens/cache_*_tokens — the real
 * thinking-token breakdown is dropped at parse time, independent of the direct-API Anthropic
 * parser's and delegate_return_parser.ts's identical gaps (this is a THIRD, separate parser for
 * a separate call path: CliDelegateStrategy's per-plan-step execution). thinking_tokens is a
 * SUBSET of output_tokens, so total accounting is unaffected — purely a dropped-visibility gap.
 * Verifies parseCliDelegateStreamTurn surfaces reasoning on ICliDelegateTurnResult.tokenStats.
 */

import { assertEquals } from "@std/assert";
import { parseCliDelegateStreamTurn } from "@exaix/execution";

Deno.test("parseCliDelegateStreamTurn: result event with a thinking breakdown maps into tokenStats.reasoning", () => {
  const lines = [
    '{"type":"system","subtype":"init","session_id":"s1"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello there, friend!"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Hello there, friend!","total_cost_usd":0.061,"usage":{"input_tokens":150,"output_tokens":2340,"output_tokens_details":{"thinking_tokens":2048}}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.tokenStats.reasoning, 2048);
  // thinking_tokens is a SUBSET of output_tokens — existing fields remain correct.
  assertEquals(turn.tokenStats.output, 2340);
  assertEquals(turn.tokenStats.total, 150 + 2340);
});

Deno.test("parseCliDelegateStreamTurn: a result event with no thinking breakdown maps tokenStats.reasoning to undefined, not 0", () => {
  const lines = [
    '{"type":"result","result":"done","usage":{"input_tokens":1,"output_tokens":1}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.tokenStats.reasoning, undefined);
});
