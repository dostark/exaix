/**
 * @module AnthropicProviderThinkingConflictTest
 * @path packages/ai/tests/providers/anthropic_provider_thinking_conflict_test.ts
 * @description Tests that tool_choice + thinking conflict throws AnthropicToolChoiceThinkingConflictError.
 */

import { assertRejects } from "@std/assert";
import { AnthropicProvider } from "@exaix/ai-anthropic";
import { ModelProviderError } from "../../src/providers/common.ts";

Deno.test("tool_choice any + manual thinking throws AnthropicToolChoiceThinkingConflictError", async () => {
  const provider = new AnthropicProvider({ apiKey: "test-key", model: "claude-haiku-4-5-20251001" });
  await assertRejects(
    () =>
      provider.generate("test", {
        thinking: true,
        tools: [{ name: "patch_file", description: "Patch", inputSchema: { type: "object" } }],
        toolChoice: { type: "any" },
      }),
    ModelProviderError,
    "tool_choice",
  );
});

Deno.test("tool_choice tool + manual thinking throws AnthropicToolChoiceThinkingConflictError", async () => {
  const provider = new AnthropicProvider({ apiKey: "test-key", model: "claude-haiku-4-5-20251001" });
  await assertRejects(
    () =>
      provider.generate("test", {
        thinking: true,
        tools: [{ name: "patch_file", description: "Patch", inputSchema: { type: "object" } }],
        toolChoice: { type: "tool", name: "patch_file" },
      }),
    ModelProviderError,
    "tool_choice",
  );
});

Deno.test("tool_choice auto + thinking does NOT throw", async () => {
  const provider = new AnthropicProvider({ apiKey: "test-key" });
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "ok" }],
            usage: { input_tokens: 5, output_tokens: 3 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    // auto + thinking should not throw — just passes through to API
    await provider.generate("test", {
      thinking: true,
      tools: [{ name: "patch_file", description: "Patch", inputSchema: { type: "object" } }],
      toolChoice: { type: "auto" },
    });
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("tool_choice any + adaptive thinking on Haiku 5.5 does NOT throw, because adaptive mode allows forced tool use", async () => {
  const provider = new AnthropicProvider({ apiKey: "test-key", model: "claude-haiku-5-5" });
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "ok" }],
            usage: { input_tokens: 5, output_tokens: 3 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    await provider.generate("test", {
      thinking: true,
      tools: [{ name: "patch_file", description: "Patch", inputSchema: { type: "object" } }],
      toolChoice: { type: "any" },
    });
  } finally {
    globalThis.fetch = origFetch;
  }
});
