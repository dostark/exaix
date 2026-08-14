/**
 * @module ExtractOpenAiContentUnchangedTest
 * @path packages/ai/tests/extract_openai_content_unchanged_test.ts
 * @description Phase 153 Step 2 [regression] — `extractOpenAIContent()`'s pre-existing
 * text-only extraction behavior is unchanged by this step's tool_calls/toolCallExtractor
 * additions to the same file.
 * @architectural-layer Tests
 * @related-files ["packages/ai/src/provider_common_utils.ts"]
 */

import { assertEquals } from "@std/assert";
import { extractOpenAIContent, type OpenAIResponse } from "../src/provider_common_utils.ts";

Deno.test("[regression] extractOpenAIContent still extracts choices[0].message.content unchanged", () => {
  const response: OpenAIResponse = { choices: [{ message: { content: "hello world" } }] };
  assertEquals(extractOpenAIContent(response), "hello world");
});

Deno.test("[regression] extractOpenAIContent still returns empty string when content is absent", () => {
  assertEquals(extractOpenAIContent({}), "");
  assertEquals(extractOpenAIContent({ choices: [] }), "");
  assertEquals(extractOpenAIContent({ choices: [{ message: {} }] }), "");
});

Deno.test("[regression] extractOpenAIContent ignores tool_calls and still returns content text", () => {
  const response: OpenAIResponse = {
    choices: [{
      message: {
        content: "I'll call a tool",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "write_file", arguments: "{}" } }],
      },
    }],
  };
  assertEquals(extractOpenAIContent(response), "I'll call a tool");
});
