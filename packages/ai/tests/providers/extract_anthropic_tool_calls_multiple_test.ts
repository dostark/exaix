/**
 * @module ExtractAnthropicToolCallsMultipleTest
 * @path packages/ai/tests/providers/extract_anthropic_tool_calls_multiple_test.ts
 * @description Tests for extractAnthropicToolCalls — verifies multiple parallel tool_use blocks
 * are ALL extracted, and undefined is returned when no tool_use blocks exist.
 */

import { assertEquals } from "@std/assert";
import { type AnthropicResponse, extractAnthropicToolCalls } from "../../src/provider_common_utils.ts";

Deno.test("extractAnthropicToolCalls extracts multiple parallel tool_use blocks", () => {
  const response: AnthropicResponse = {
    content: [
      { type: "text", text: "I'll make those changes." },
      { type: "tool_use", id: "toolu_1", name: "write_file", input: { path: "a.ts" } },
      { type: "tool_use", id: "toolu_2", name: "patch_file", input: { path: "b.ts" } },
    ],
  };
  const result = extractAnthropicToolCalls(response);
  assertEquals(result!.length, 2);
  assertEquals(result![0].id, "toolu_1");
  assertEquals(result![0].name, "write_file");
  assertEquals(result![1].id, "toolu_2");
  assertEquals(result![1].name, "patch_file");
});

Deno.test("extractAnthropicToolCalls extracts single tool_use block", () => {
  const response: AnthropicResponse = {
    content: [
      { type: "text", text: "Fixing it." },
      { type: "tool_use", id: "toolu_3", name: "patch_file", input: { path: "c.ts" } },
    ],
  };
  const result = extractAnthropicToolCalls(response);
  assertEquals(result!.length, 1);
  assertEquals(result![0].id, "toolu_3");
});

Deno.test("extractAnthropicToolCalls returns undefined when no tool_use blocks exist", () => {
  const response: AnthropicResponse = {
    content: [
      { type: "text", text: "Done." },
      { type: "thinking", thinking: "reasoning" },
    ],
  };
  const result = extractAnthropicToolCalls(response);
  assertEquals(result, undefined);
});

Deno.test("extractAnthropicToolCalls returns undefined for empty content", () => {
  assertEquals(extractAnthropicToolCalls({ content: [] }), undefined);
  assertEquals(extractAnthropicToolCalls({}), undefined);
});

Deno.test("extractAnthropicToolCalls preserves tool input fields", () => {
  const response: AnthropicResponse = {
    content: [
      { type: "tool_use", id: "toolu_4", name: "write_file", input: { path: "d.ts", content: "hello" } },
    ],
  };
  const result = extractAnthropicToolCalls(response);
  assertEquals(result![0].input.path, "d.ts");
  assertEquals(result![0].input.content, "hello");
});
