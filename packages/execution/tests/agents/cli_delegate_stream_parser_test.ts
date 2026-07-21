/**
 * @module CliDelegateStreamParserTest
 * @path packages/execution/tests/agents/cli_delegate_stream_parser_test.ts
 * @related-files [packages/execution/src/strategies/cli_delegate_stream_parser.ts]
 * @architectural-layer Services
 * @description Verifies parseCliDelegateStreamTurn against real
 * `claude -p <objective> --output-format stream-json` event shapes captured
 * from a live cold-spawned call (text-only turn, a Write tool-use turn, an
 * is_error turn, and session_id extraction for the --resume handoff).
 */

import { assertEquals } from "@std/assert";
import { parseCliDelegateStreamTurn } from "@exaix/execution";

Deno.test("parseCliDelegateStreamTurn: text-only turn extracts result text, tokens, and cost", () => {
  const lines = [
    '{"type":"system","subtype":"init","session_id":"s1"}',
    '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello there, friend!"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Hello there, friend!","total_cost_usd":0.061,"usage":{"input_tokens":2,"output_tokens":10}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.lastText, "Hello there, friend!");
  assertEquals(turn.isError, false);
  assertEquals(turn.tokenStats, {
    input: 2,
    output: 10,
    total: 12,
    cacheRead: undefined,
    cacheCreation: undefined,
  });
  assertEquals(turn.costUsd, 0.061);
  assertEquals(turn.toolPaths, []);
  assertEquals(turn.sessionId, "s1");
});

Deno.test("parseCliDelegateStreamTurn: a Write tool_use event contributes file_path to toolPaths", () => {
  const lines = [
    '{"type":"system","subtype":"init","session_id":"s1"}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"/repo/src/utils.ts","content":"x"}}]}}',
    '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"t1","type":"tool_result","content":"File created"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Created utils.ts"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Created utils.ts","total_cost_usd":0.02,"usage":{"input_tokens":5,"output_tokens":20}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.lastText, "Created utils.ts");
  assertEquals(turn.toolPaths, ["/repo/src/utils.ts"]);
});

Deno.test("parseCliDelegateStreamTurn: duplicate tool_use paths are deduplicated", () => {
  const lines = [
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/repo/a.ts"}}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/repo/a.ts"}}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/repo/b.ts"}}]}}',
    '{"type":"result","result":"done","usage":{"input_tokens":1,"output_tokens":1}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.toolPaths, ["/repo/a.ts", "/repo/b.ts"]);
});

Deno.test("parseCliDelegateStreamTurn: is_error true is surfaced", () => {
  const lines = [
    '{"type":"result","subtype":"error","is_error":true,"result":"API error","usage":{"input_tokens":1,"output_tokens":0}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.isError, true);
  assertEquals(turn.lastText, "API error");
});

Deno.test("parseCliDelegateStreamTurn: non-tool_use content blocks (e.g. thinking) are ignored for toolPaths", () => {
  const lines = [
    '{"type":"assistant","message":{"content":[{"type":"thinking","text":"reasoning..."}]}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"final answer"}]}}',
    '{"type":"result","result":"final answer","usage":{"input_tokens":1,"output_tokens":1}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.toolPaths, []);
  assertEquals(turn.lastText, "final answer");
});

Deno.test("parseCliDelegateStreamTurn: malformed JSON lines are skipped, not fatal", () => {
  const lines = [
    "not json at all",
    '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}',
    "{broken",
    '{"type":"result","result":"ok","usage":{"input_tokens":1,"output_tokens":1}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.lastText, "ok");
  assertEquals(turn.isError, false);
});

Deno.test("parseCliDelegateStreamTurn: no result event yields the empty-turn shape with last seen text", () => {
  const lines = [
    '{"type":"assistant","message":{"content":[{"type":"text","text":"still working"}]}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.lastText, "still working");
  assertEquals(turn.isError, false);
  assertEquals(turn.tokenStats, { input: 0, output: 0, total: 0 });
  assertEquals(turn.toolPaths, []);
});

Deno.test("parseCliDelegateStreamTurn: session_id absent from every line yields sessionId undefined", () => {
  const lines = [
    '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}',
    '{"type":"result","result":"ok","usage":{"input_tokens":1,"output_tokens":1}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.sessionId, undefined);
});

Deno.test("parseCliDelegateStreamTurn: a later system event does not override an earlier session_id", () => {
  const lines = [
    '{"type":"system","subtype":"init","session_id":"s1"}',
    '{"type":"system","subtype":"other"}',
    '{"type":"result","result":"ok","usage":{"input_tokens":1,"output_tokens":1}}',
  ];

  const turn = parseCliDelegateStreamTurn(lines);

  assertEquals(turn.sessionId, "s1");
});
