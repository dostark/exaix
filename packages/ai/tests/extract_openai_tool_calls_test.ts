/**
 * @module ExtractOpenAiToolCallsTest
 * @path packages/ai/tests/extract_openai_tool_calls_test.ts
 * @description Phase 153 Step 2 — tests for `extractOpenAIToolCalls()`: parses well-formed
 * `choices[0].message.tool_calls[]` into `IProviderToolCall[]` with `input` as a PARSED
 * object (OpenAI's `function.arguments` is a JSON-encoded string on the wire), handles
 * multiple parallel tool calls, and degrades gracefully (never throws) on malformed
 * `arguments` JSON — matching Phase 152's "provider integrity, not crash" precedent for
 * Anthropic's extraction.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai/src/provider_common_utils.ts",
 *   "packages/ai/tests/providers/extract_anthropic_tool_calls_multiple_test.ts"
 * ]
 */

import { assertEquals } from "@std/assert";
import { extractOpenAIToolCalls, type OpenAIResponse } from "../src/provider_common_utils.ts";

Deno.test("extractOpenAIToolCalls parses a well-formed tool_calls response into IProviderToolCall[] with parsed input", () => {
  const response: OpenAIResponse = {
    choices: [{
      message: {
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "write_file", arguments: '{"path":"a.ts","content":"hello"}' },
        }],
      },
    }],
  };
  const result = extractOpenAIToolCalls(response);
  assertEquals(result!.length, 1);
  assertEquals(result![0].id, "call_1");
  assertEquals(result![0].name, "write_file");
  assertEquals(result![0].input, { path: "a.ts", content: "hello" });
});

Deno.test("extractOpenAIToolCalls extracts multiple parallel tool calls", () => {
  const response: OpenAIResponse = {
    choices: [{
      message: {
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "write_file", arguments: '{"path":"a.ts"}' } },
          { id: "call_2", type: "function", function: { name: "patch_file", arguments: '{"path":"b.ts"}' } },
        ],
      },
    }],
  };
  const result = extractOpenAIToolCalls(response);
  assertEquals(result!.length, 2);
  assertEquals(result![0].id, "call_1");
  assertEquals(result![1].id, "call_2");
  assertEquals(result![1].name, "patch_file");
});

Deno.test("extractOpenAIToolCalls returns undefined when tool_calls is absent", () => {
  const response: OpenAIResponse = { choices: [{ message: { content: "no tools here" } }] };
  assertEquals(extractOpenAIToolCalls(response), undefined);
});

Deno.test("extractOpenAIToolCalls returns undefined for empty choices/message", () => {
  assertEquals(extractOpenAIToolCalls({}), undefined);
  assertEquals(extractOpenAIToolCalls({ choices: [] }), undefined);
});

Deno.test("extractOpenAIToolCalls does not throw on malformed arguments JSON, and omits that entry", () => {
  const response: OpenAIResponse = {
    choices: [{
      message: {
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "write_file", arguments: "{not valid json" } },
          { id: "call_2", type: "function", function: { name: "patch_file", arguments: '{"path":"b.ts"}' } },
        ],
      },
    }],
  };
  const result = extractOpenAIToolCalls(response);
  // The malformed entry is dropped; the well-formed one still comes through.
  assertEquals(result!.length, 1);
  assertEquals(result![0].id, "call_2");
});

Deno.test("extractOpenAIToolCalls returns undefined when every entry has malformed arguments", () => {
  const response: OpenAIResponse = {
    choices: [{
      message: {
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "write_file", arguments: "not json at all" } },
        ],
      },
    }],
  };
  assertEquals(extractOpenAIToolCalls(response), undefined);
});

Deno.test('extractOpenAIToolCalls sets type to "function" on each entry', () => {
  const response: OpenAIResponse = {
    choices: [{
      message: {
        tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }],
      },
    }],
  };
  const result = extractOpenAIToolCalls(response);
  assertEquals(result![0].type, "function");
});

Deno.test("extractOpenAIToolCalls captures reasoning_content onto the tool call (GAP-153-G)", () => {
  const response: OpenAIResponse = {
    choices: [{
      message: {
        reasoning_content: "I need to read the file first.",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }],
      },
    }],
  };
  const result = extractOpenAIToolCalls(response);
  assertEquals(result![0].reasoningContent, "I need to read the file first.");
});

Deno.test("extractOpenAIToolCalls leaves reasoningContent undefined when the message omits it", () => {
  const response: OpenAIResponse = {
    choices: [{
      message: {
        tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }],
      },
    }],
  };
  const result = extractOpenAIToolCalls(response);
  assertEquals(result![0].reasoningContent, undefined);
});
