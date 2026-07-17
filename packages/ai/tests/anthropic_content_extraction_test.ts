/**
 * @module AnthropicContentExtractionTest
 * @path packages/ai/tests/anthropic_content_extraction_test.ts
 * @related-files [packages/ai/src/provider_common_utils.ts]
 * @architectural-layer AI
 * @description Regression test for extractAnthropicContent against thinking-model responses.
 * Claude 5 family models (e.g. claude-sonnet-5) prepend a `thinking` content block before the
 * `text` block when adaptive thinking triggers — observed live 2026-07-17 on the swe_tasks
 * analysis prompt, where content[0] was `{type: "thinking"}` and taking content[0].text
 * yielded "" for a response whose text block held a complete 10k-char answer.
 */

import { assertEquals } from "@std/assert";
import { extractAnthropicContent } from "../src/provider_common_utils.ts";

Deno.test("extractAnthropicContent returns the text block when a thinking block precedes it", () => {
  const content = extractAnthropicContent({
    content: [
      { type: "thinking", thinking: "internal reasoning, no text field" },
      { type: "text", text: "the actual answer" },
    ],
  });
  assertEquals(content, "the actual answer");
});

Deno.test("extractAnthropicContent joins multiple text blocks in order", () => {
  const content = extractAnthropicContent({
    content: [
      { type: "text", text: "part one" },
      { type: "thinking", thinking: "reasoning between" },
      { type: "text", text: "part two" },
    ],
  });
  assertEquals(content, "part onepart two");
});

Deno.test("extractAnthropicContent keeps working for plain single-text responses", () => {
  assertEquals(extractAnthropicContent({ content: [{ type: "text", text: "hello" }] }), "hello");
});

Deno.test("extractAnthropicContent tolerates legacy responses without a type field", () => {
  assertEquals(extractAnthropicContent({ content: [{ text: "untyped text" }] }), "untyped text");
});

Deno.test("extractAnthropicContent returns empty string for empty or missing content", () => {
  assertEquals(extractAnthropicContent({}), "");
  assertEquals(extractAnthropicContent({ content: [] }), "");
  assertEquals(extractAnthropicContent({ content: [{ type: "thinking", thinking: "only thinking" }] }), "");
});
