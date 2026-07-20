/**
 * @module DelegateReturnParserTest
 * @path packages/session/tests/delegate_return_parser_test.ts
 * @description Phase 123 Step 1 — tests for the extracted delegate return parser
 *   module. Covers opencode JSONL, claude single-result, tool_use path extraction,
 *   missing-step_finish fallback, and multi-chunk stream draining.
 */

import { assertEquals } from "@std/assert";
import { parseDelegateStdout } from "@exaix/session/delegate_return_parser.ts";

Deno.test("[delegate_return_parser] opencode JSONL across multiple chunks yields last text + step_finish tokens", () => {
  const stdout = [
    `{"type":"text","part":{"text":"first message"}}\n`,
    `{"type":"tool_use","part":{"tool_use":{"name":"create_file","input":{"file_path":"src/foo.ts"}}}}\n`,
    `{"type":"text","part":{"text":"second message"}}\n`,
    `{"type":"step_finish","part":{"tokens":{"input":100,"output":50,"total":150},"cost":0.002}}\n`,
  ].join("");

  const result = parseDelegateStdout(stdout, "opencode");
  assertEquals(result.lastText, "second message");
  assertEquals(result.tokenStats.input, 100);
  assertEquals(result.tokenStats.output, 50);
  assertEquals(result.tokenStats.total, 150);
  assertEquals(result.costUsd, 0.002);
});

Deno.test("[delegate_return_parser] opencode tool_use write events contribute file paths", () => {
  const stdout = [
    `{"type":"text","part":{"text":"creating files"}}\n`,
    `{"type":"tool_use","part":{"tool":"write","state":{"input":{"filePath":"src/bar.ts"}}}}\n`,
    `{"type":"tool_use","part":{"tool":"edit","state":{"input":{"filePath":"src/bar.ts"}}}}\n`,
    `{"type":"tool_use","part":{"tool":"read","state":{"input":{"filePath":"src/lib.ts"}}}}\n`,
    `{"type":"step_finish","part":{"tokens":{"input":200,"output":100,"total":300},"cost":0.004}}\n`,
  ].join("");

  const result = parseDelegateStdout(stdout, "opencode");
  // write and edit contribute paths; read does not
  assertEquals(result.toolPaths, ["src/bar.ts"]);
});

Deno.test("[delegate_return_parser] opencode tool_use write and edit contribute paths", () => {
  const stdout = [
    `{"type":"tool_use","part":{"tool":"write","state":{"input":{"filePath":"src/new.ts"}}}}\n`,
    `{"type":"tool_use","part":{"tool":"edit","state":{"input":{"filePath":"src/existing.ts"}}}}\n`,
    `{"type":"step_finish","part":{"tokens":{"input":50,"output":25,"total":75},"cost":0.001}}\n`,
  ].join("");

  const result = parseDelegateStdout(stdout, "opencode");
  assertEquals(result.toolPaths, ["src/new.ts", "src/existing.ts"]);
  assertEquals(result.costUsd, 0.001);
});

Deno.test("[delegate_return_parser] opencode real CLI event shape (tool + state.input.filePath) is parsed, not the legacy tool_use.input.file_path shape", () => {
  // Captured verbatim from a live `opencode run --format json` probe (2026-07-20):
  // the real event nests the tool name directly under `part.tool` and the path
  // under `part.state.input.filePath` — not `part.tool_use.name`/`.input.file_path`.
  const stdout =
    `{"type":"tool_use","timestamp":1784539276452,"sessionID":"ses_1","part":{"type":"tool","tool":"edit","callID":"call_1","state":{"status":"completed","input":{"filePath":"/tmp/opencode_probe2/utils.ts","oldString":"x.assignee.name","newString":"x.assignee?.name"},"output":"Edit applied successfully."}}}\n`;

  const result = parseDelegateStdout(stdout, "opencode");
  assertEquals(result.toolPaths, ["/tmp/opencode_probe2/utils.ts"]);
});

Deno.test("[delegate_return_parser] claude result object yields result text + usage tokens", () => {
  const stdout = JSON.stringify({
    type: "result",
    result: "Here is the change I made.",
    session_id: "sess_123",
    total_cost_usd: 0.015,
    duration_ms: 5000,
    num_turns: 2,
    usage: { input_tokens: 500, output_tokens: 200 },
  });

  const result = parseDelegateStdout(stdout, "claude-code");
  assertEquals(result.lastText, "Here is the change I made.");
  assertEquals(result.tokenStats.input, 500);
  assertEquals(result.tokenStats.output, 200);
  assertEquals(result.tokenStats.total, 700);
  assertEquals(result.costUsd, 0.015);
  assertEquals(result.toolPaths, []);
});

Deno.test("[delegate_return_parser] claude result with no usage yields zero tokens", () => {
  const stdout = JSON.stringify({
    type: "result",
    result: "Done.",
    session_id: "sess_456",
  });

  const result = parseDelegateStdout(stdout, "claude-code");
  assertEquals(result.lastText, "Done.");
  assertEquals(result.tokenStats.input, 0);
  assertEquals(result.tokenStats.output, 0);
  assertEquals(result.tokenStats.total, 0);
  assertEquals(result.costUsd, 0);
});

Deno.test("[delegate_return_parser] missing step_finish → tokens zero but paths still come from tool_use", () => {
  const stdout = [
    `{"type":"text","part":{"text":"no finish event"}}\n`,
    `{"type":"tool_use","part":{"tool":"write","state":{"input":{"filePath":"src/missing.ts"}}}}\n`,
  ].join("");

  const result = parseDelegateStdout(stdout, "opencode");
  assertEquals(result.lastText, "no finish event");
  assertEquals(result.tokenStats.input, 0);
  assertEquals(result.tokenStats.output, 0);
  assertEquals(result.tokenStats.total, 0);
  assertEquals(result.costUsd, undefined);
  assertEquals(result.toolPaths, ["src/missing.ts"]);
});

Deno.test("[delegate_return_parser] empty stdout yields empty result", () => {
  const result = parseDelegateStdout("", "opencode");
  assertEquals(result.lastText, "");
  assertEquals(result.tokenStats.input, 0);
  assertEquals(result.tokenStats.output, 0);
  assertEquals(result.tokenStats.total, 0);
  assertEquals(result.toolPaths, []);
  assertEquals(result.costUsd, undefined);
});

Deno.test("[delegate_return_parser] non-JSON stdout yields empty result", () => {
  const result = parseDelegateStdout("not json at all\njust text\n", "opencode");
  assertEquals(result.lastText, "");
  assertEquals(result.tokenStats.input, 0);
  assertEquals(result.tokenStats.output, 0);
  assertEquals(result.tokenStats.total, 0);
  assertEquals(result.toolPaths, []);
});
