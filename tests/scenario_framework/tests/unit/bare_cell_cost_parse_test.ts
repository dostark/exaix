/**
 * @module BareCellCostParseTest
 * @path tests/scenario_framework/tests/unit/bare_cell_cost_parse_test.ts
 * @description Phase 143 Step 1 — RED-first tests (pre-gap GAP-3). Bare-cell cost/token capture
 * reuses the daemon's own `parseDelegateStdout` (packages/session) via the
 * `parseDelegateStepLlmMetrics` mapping: Claude `{type:"result"}` JSON usage and OpenCode JSONL
 * `step_finish` token/cost events must land in the existing `tracked_cost_usd` / `tokens_*`
 * history step fields. Absent cost is tolerated (OpenCode: undefined; Claude: 0 per the daemon
 * parser contract), and a delegate stdout with nothing parseable must record NO metrics rather
 * than fake zeros.
 * @architectural-layer Test
 * @related-files [packages/session/src/delegate_return_parser.ts, tests/scenario_framework/runner/step_llm_metrics.ts]
 */

import { assertEquals } from "@std/assert";
import { parseDelegateStepLlmMetrics } from "../../runner/step_llm_metrics.ts";

const CLAUDE_RESULT_JSON =
  '{"type":"result","result":"All tests passed","usage":{"input_tokens":123,"output_tokens":45},' +
  '"total_cost_usd":0.0123}';

const CLAUDE_RESULT_NO_COST_JSON =
  '{"type":"result","result":"All tests passed","usage":{"input_tokens":10,"output_tokens":5}}';

const OPENCODE_JSONL = [
  '{"type":"text","part":{"text":"starting"}}',
  '{"type":"tool_use","part":{"tool":"write","state":{"input":{"filePath":"src/main.ts"}}}}',
  '{"type":"step_finish","part":{"tokens":{"input":200,"output":80,"total":280},"cost":0.0456}}',
  '{"type":"step_finish","part":{"tokens":{"input":300,"output":120,"total":420},"cost":0.0789}}',
].join("\n");

const OPENCODE_JSONL_NO_COST = [
  '{"type":"step_finish","part":{"tokens":{"input":50,"output":25,"total":75}}}',
].join("\n");

Deno.test("[BareCellCostParse] Claude result JSON maps usage + total_cost_usd into the history step fields", () => {
  const metrics = parseDelegateStepLlmMetrics(CLAUDE_RESULT_JSON, "claude-code");
  assertEquals(metrics.tokens, {
    prompt: 123,
    completion: 45,
    cacheRead: undefined,
    cacheCreation: undefined,
    total: 168,
  });
  assertEquals(metrics.trackedCostUsd, 0.0123);
});

Deno.test("[BareCellCostParse] Claude result without cost maps tokens with trackedCostUsd 0 (parser contract)", () => {
  const metrics = parseDelegateStepLlmMetrics(CLAUDE_RESULT_NO_COST_JSON, "claude-code");
  assertEquals(metrics.tokens?.prompt, 10);
  assertEquals(metrics.tokens?.completion, 5);
  assertEquals(metrics.tokens?.total, 15);
  assertEquals(metrics.trackedCostUsd, 0);
});

Deno.test("[BareCellCostParse] OpenCode JSONL step_finish events carry the last event's tokens and cost", () => {
  const metrics = parseDelegateStepLlmMetrics(OPENCODE_JSONL, "opencode");
  assertEquals(metrics.tokens?.prompt, 300);
  assertEquals(metrics.tokens?.completion, 120);
  assertEquals(metrics.tokens?.total, 420);
  assertEquals(metrics.trackedCostUsd, 0.0789);
});

Deno.test("[BareCellCostParse] OpenCode JSONL without cost maps tokens with trackedCostUsd undefined", () => {
  const metrics = parseDelegateStepLlmMetrics(OPENCODE_JSONL_NO_COST, "opencode");
  assertEquals(metrics.tokens?.prompt, 50);
  assertEquals(metrics.tokens?.completion, 25);
  assertEquals(metrics.tokens?.total, 75);
  assertEquals(metrics.trackedCostUsd, undefined);
});

Deno.test("[BareCellCostParse] unparseable delegate stdout records no metrics at all", () => {
  const metrics = parseDelegateStepLlmMetrics("not json at all\njust some log lines", "opencode");
  assertEquals(metrics, {});
});

Deno.test("[BareCellCostParse] empty delegate stdout records no metrics at all", () => {
  const metrics = parseDelegateStepLlmMetrics("", "claude-code");
  assertEquals(metrics, {});
});
