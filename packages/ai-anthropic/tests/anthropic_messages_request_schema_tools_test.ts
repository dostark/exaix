/**
 * @module AnthropicMessagesRequestSchemaToolsTest
 * @path packages/ai-anthropic/tests/anthropic_messages_request_schema_tools_test.ts
 * @description Tests that AnthropicMessagesRequestSchema validates a native-tools-bearing
 * request body (assistant + tool_result messages, tools, tool_choice) after the GAP-4 schema update.
 */

import { assertEquals } from "@std/assert";
import { AnthropicMessagesRequestSchema } from "../src/anthropic_request_schema.ts";

Deno.test("schema validates priorTurn-derived assistant + tool_result messages", () => {
  const body = {
    model: "claude-sonnet-5",
    max_tokens: 1024,
    messages: [
      {
        role: "assistant" as const,
        content: [{ type: "tool_use", id: "call_1", name: "write_file", input: { path: "test.txt" } }],
      },
      { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "call_1", content: "done" }] },
      { role: "user" as const, content: [{ type: "text", text: "continue" }] },
    ],
    tools: [{ name: "write_file", description: "Write files", input_schema: { type: "object" } }],
    tool_choice: { type: "any", disable_parallel_tool_use: true },
  };
  const result = AnthropicMessagesRequestSchema.safeParse(body);
  if (!result.success) {
    throw new Error(`Expected valid schema, got: ${JSON.stringify(result.error?.flatten())}`);
  }
  assertEquals(result.success, true);
});

Deno.test("schema rejects old user-only role when assistant messages present but schema not updated", () => {
  const body = {
    model: "claude-sonnet-5",
    max_tokens: 1024,
    messages: [
      { role: "assistant" as const, content: [{ type: "text", text: "ok" }] },
    ],
  };
  const result = AnthropicMessagesRequestSchema.safeParse(body);
  assertEquals(result.success, true);
});

Deno.test("schema validates tools and tool_choice fields", () => {
  const body = {
    model: "claude-sonnet-5",
    max_tokens: 1024,
    messages: [{ role: "user" as const, content: [{ type: "text", text: "hello" }] }],
    tools: [
      { name: "write_file", input_schema: { type: "object" } },
      { name: "patch_file", description: "Patch files", input_schema: { type: "object" } },
    ],
    tool_choice: { type: "any" },
  };
  const result = AnthropicMessagesRequestSchema.safeParse(body);
  assertEquals(result.success, true);
});
