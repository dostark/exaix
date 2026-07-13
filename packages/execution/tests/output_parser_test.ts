/**
 * @module OutputParserTest
 * @path packages/execution/tests/output_parser_test.ts
 * @description Tests for OutputParser — LLM response parsing and
 *   changeset result validation.
 * @architectural-layer Tests
 */

import { assertEquals, assertThrows } from "@std/assert";
import { OutputParser } from "../src/output_parser.ts";

Deno.test("OutputParser.parseAgentResponse extracts JSON from triple-backtick block", () => {
  const parser = new OutputParser();
  const response =
    'Some text\n```json\n{"branch": "feat/test", "commit_sha": "abc1234", "files_changed": ["a.ts"], "description": "test", "tool_calls": 2, "execution_time_ms": 100}\n```\nMore text';
  const result = parser.parseAgentResponse(response, {
    trace_id: "trace-1",
    request_id: "req-1",
    plan: "test plan",
  }, 0);

  assertEquals(result.branch, "feat/test");
  assertEquals(result.commit_sha, "abc1234");
  assertEquals(result.files_changed, ["a.ts"]);
  assertEquals(result.description, "test");
  assertEquals(result.tool_calls, 2);
});

Deno.test("OutputParser.parseAgentResponse falls back to bare JSON match", () => {
  const parser = new OutputParser();
  const response =
    '{"branch": "feat/fallback", "commit_sha": "def456", "files_changed": ["b.ts"], "description": "fallback", "tool_calls": 1, "execution_time_ms": 50}';
  const result = parser.parseAgentResponse(response, {
    trace_id: "trace-2",
    request_id: "req-2",
    plan: "fallback plan",
  }, 0);

  assertEquals(result.branch, "feat/fallback");
  assertEquals(result.files_changed, ["b.ts"]);
});

Deno.test("OutputParser.parseAgentResponse returns default on no JSON match", () => {
  const parser = new OutputParser();
  const startTime = Date.now();
  const result = parser.parseAgentResponse("Just some plain text without JSON", {
    trace_id: "trace-3",
    request_id: "req-3",
    plan: "default plan",
  }, startTime);

  assertEquals(result.branch, "feat/req-3-trace-3");
  assertEquals(result.files_changed, []);
  assertEquals(result.description, "default plan");
  assertEquals(result.tool_calls, 0);
});

Deno.test("OutputParser.parseAgentResponse fills missing fields from context", () => {
  const parser = new OutputParser();
  const response = '{"branch": "feat/partial"}';
  const result = parser.parseAgentResponse(response, {
    trace_id: "trace-4",
    request_id: "req-4",
    plan: "partial plan",
  }, 100);

  assertEquals(result.branch, "feat/partial");
  assertEquals(result.commit_sha, "0000000000000000000000000000000000000000");
  assertEquals(result.files_changed, []);
  assertEquals(result.description, "partial plan");
  assertEquals(result.tool_calls, 0);
});

Deno.test("OutputParser.parseAgentResponse handles malformed JSON gracefully", () => {
  const parser = new OutputParser();
  const response = "```json\n{invalid json}\n```";
  const result = parser.parseAgentResponse(response, {
    trace_id: "trace-5",
    request_id: "req-5",
    plan: "error plan",
  }, 0);

  assertEquals(result.description, "error plan");
});

Deno.test("OutputParser.validateReviewResult accepts valid changeset", () => {
  const parser = new OutputParser();
  const valid = {
    branch: "feat/valid",
    commit_sha: "abc1234",
    files_changed: ["file.ts"],
    description: "valid",
    tool_calls: 3,
    execution_time_ms: 200,
  };
  const result = parser.validateReviewResult(valid);
  assertEquals(result.branch, "feat/valid");
});

Deno.test("OutputParser.validateReviewResult rejects invalid changeset", () => {
  const parser = new OutputParser();
  assertThrows(() => parser.validateReviewResult({}));
});
