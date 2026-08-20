/**
 * @module DelegateReturnParserCodexTest
 * @path packages/session/tests/delegate_return_parser_codex_test.ts
 * @description Phase 166 Step 1 — RED-first tests for Codex's `codex exec --json` JSONL
 *   event stream support in `parseDelegateStdout`/`parseCodexJsonl`. Codex is a third
 *   headless CLI-delegate tool (alongside claude-code and opencode); its event shape is
 *   JSONL like opencode's but with different field names (`item.completed`/`item.type`
 *   instead of `part.tool`/`part.text`). Covers lastText accumulation from
 *   `item.completed` `agent_message` items, deduplicated `toolPaths` from official
 *   `file_change.changes[]` items (including partial/failed items), `tokenStats` from
 *   `turn.completed.usage` (including the `cached_input_tokens`
 *   → `cacheRead` mapping), tolerance of unrecognized `item.type` values (Codex may add
 *   new item types in a future release), a `turn.failed` turn producing an empty result
 *   rather than throwing, and a regression guard proving the claude-code/opencode
 *   dispatch branches are unaffected by adding the third tool arm.
 * @architectural-layer Services
 * @related-files [packages/session/src/delegate_return_parser.ts]
 */

import { assertEquals } from "@std/assert";
import { parseDelegateStdout } from "@exaix/session/delegate_return_parser.ts";

Deno.test("[delegate_return_parser] codex parseCodexJsonl extracts lastText from the last item.completed agent_message", () => {
  const stdout = [
    `{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"first message"}}`,
    `{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"second message"}}`,
  ].join("\n");

  const result = parseDelegateStdout(stdout, "codex");
  assertEquals(result.lastText, "second message");
});

Deno.test("[delegate_return_parser] codex parses every deduplicated path from official file_change changes arrays", () => {
  const stdout = [
    `{"type":"item.completed","item":{"id":"item_1","type":"file_change","changes":[{"path":"src/foo.ts","kind":"update"},{"path":"src/bar.ts","kind":"add"}],"status":"completed"}}`,
    `{"type":"item.completed","item":{"id":"item_2","type":"file_change","changes":[{"path":"src/foo.ts","kind":"update"},{"path":"src/old.ts","kind":"delete"}],"status":"completed"}}`,
  ].join("\n");

  const result = parseDelegateStdout(stdout, "codex");
  assertEquals(result.toolPaths, ["src/foo.ts", "src/bar.ts", "src/old.ts"]);
});

Deno.test("[delegate_return_parser][security] codex conservatively retains paths from partial and failed file changes", () => {
  const stdout = [
    `{"type":"item.started","item":{"id":"item_1","type":"file_change","changes":[{"path":"src/partial.ts","kind":"add"}],"status":"in_progress"}}`,
    `{"type":"item.completed","item":{"id":"item_2","type":"file_change","changes":[{"path":".env","kind":"add"}],"status":"failed"}}`,
    `{"type":"item.completed","item":{"id":"item_3","type":"file_change","changes":[{"path":"","kind":"add"},{"kind":"delete"}],"status":"failed"}}`,
  ].join("\n");

  const result = parseDelegateStdout(stdout, "codex");
  assertEquals(result.toolPaths, ["src/partial.ts", ".env"]);
});

Deno.test("[delegate_return_parser] codex parseCodexJsonl extracts tokenStats from turn.completed usage, mapping cached_input_tokens to cacheRead", () => {
  const stdout =
    `{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":40,"output_tokens":60,"reasoning_output_tokens":10}}`;

  const result = parseDelegateStdout(stdout, "codex");
  assertEquals(result.tokenStats.input, 120);
  assertEquals(result.tokenStats.output, 60);
  assertEquals(result.tokenStats.total, 180);
  assertEquals(result.tokenStats.cacheRead, 40);
  // Codex's usage payload has no write-side cache field.
  assertEquals(result.tokenStats.cacheCreation, undefined);
});

Deno.test("[delegate_return_parser] codex parseCodexJsonl tolerates an unknown item.type without throwing", () => {
  const stdout = [
    `{"type":"item.completed","item":{"id":"item_1","type":"future_item_type","text":"should not throw"}}`,
    `{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"real message"}}`,
  ].join("\n");

  const result = parseDelegateStdout(stdout, "codex");
  assertEquals(result.lastText, "real message");
  assertEquals(result.toolPaths, []);
});

Deno.test("[delegate_return_parser] codex parseCodexJsonl returns empty lastText on turn.failed", () => {
  const stdout = [
    `{"type":"thread.started","thread_id":"thread_abc"}`,
    `{"type":"turn.started"}`,
    `{"type":"turn.failed","message":"subprocess crashed"}`,
  ].join("\n");

  const result = parseDelegateStdout(stdout, "codex");
  assertEquals(result.lastText, "");
  assertEquals(result.tokenStats, { input: 0, output: 0, total: 0 });
  assertEquals(result.toolPaths, []);
  assertEquals(result.costUsd, undefined);
});

Deno.test("[delegate_return_parser] codex parseDelegateStdout dispatches to parseCodexJsonl and covers every documented event type (thread.started, turn.started, item.started, item.completed x2 subtypes, turn.completed)", () => {
  const stdout = [
    `{"type":"thread.started","thread_id":"thread_xyz789"}`,
    `{"type":"turn.started"}`,
    `{"type":"item.started","item":{"id":"item_1","type":"agent_message"}}`,
    `{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"first draft"}}`,
    `{"type":"item.completed","item":{"id":"item_2","type":"file_change","changes":[{"path":"src/foo.ts","kind":"update"}],"status":"completed"}}`,
    `{"type":"item.completed","item":{"id":"item_3","type":"file_change","changes":[{"path":"src/foo.ts","kind":"update"}],"status":"completed"}}`,
    `{"type":"item.completed","item":{"id":"item_4","type":"agent_message","text":"final answer"}}`,
    `{"type":"turn.completed","usage":{"input_tokens":200,"cached_input_tokens":75,"output_tokens":90,"reasoning_output_tokens":15}}`,
  ].join("\n");

  const result = parseDelegateStdout(stdout, "codex");
  assertEquals(result.lastText, "final answer");
  assertEquals(result.toolPaths, ["src/foo.ts"]);
  assertEquals(result.tokenStats.input, 200);
  assertEquals(result.tokenStats.output, 90);
  assertEquals(result.tokenStats.total, 290);
  assertEquals(result.tokenStats.cacheRead, 75);
  // Codex's usage payload carries no cost data; the caller (CliDelegateModelProvider,
  // Step 2) sets cost_usd: 0 downstream since the subscription bills flat-rate.
  assertEquals(result.costUsd, undefined);
});

Deno.test("[delegate_return_parser] [regression] codex dispatch addition leaves claude-code and opencode branches unchanged", () => {
  const claudeStdout =
    `{"type":"result","result":"claude answer","usage":{"input_tokens":10,"output_tokens":5},"total_cost_usd":0.001}`;
  const claudeResult = parseDelegateStdout(claudeStdout, "claude-code");
  assertEquals(claudeResult.lastText, "claude answer");
  assertEquals(claudeResult.tokenStats, { input: 10, output: 5, total: 15 });
  assertEquals(claudeResult.costUsd, 0.001);

  const opencodeStdout = `{"type":"text","part":{"text":"opencode answer"}}\n`;
  const opencodeResult = parseDelegateStdout(opencodeStdout, "opencode");
  assertEquals(opencodeResult.lastText, "opencode answer");
});
