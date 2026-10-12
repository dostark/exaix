/**
 * @module OpenRouterCacheControlTest
 * @path packages/ai-openrouter/tests/openrouter_cache_control_test.ts
 * @description Verifies stable-prefix breakpoints, replay fidelity, the toggle and token measurement.
 * @architectural-layer AI
 * @dependencies [@exaix/ai, @exaix/core]
 * @related-files [packages/ai-openrouter/src/openrouter_provider.ts, packages/ai-openrouter/src/openrouter_cache_control.ts]
 */
import { assertEquals } from "@std/assert";
import type { IModelOptions, INativeConversationSnapshot } from "@exaix/ai/types.ts";
import type { OpenAiChatMessage } from "@exaix/ai/provider_common_utils.ts";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import type { JSONValue } from "@exaix/core";
import { PricingTier } from "@exaix/core";
import type { ITokenizer } from "@exaix/core/func";
import { OpenRouterProvider } from "../src/openrouter_provider.ts";
import { applyCacheControl } from "../src/openrouter_cache_control.ts";
import { OPENROUTER_PROVIDER_METADATA, OpenRouterProviderFactory, PROVIDER_OPENROUTER } from "../mod.ts";

const PROMPT = "Stable prompt prefix";
const QWEN_MODEL = "qwen/qwen3.7-flash";
const CACHED_MODEL = "qwen/qwen3-max";
const CACHE_PART = { type: "text", text: PROMPT, cache_control: { type: "ephemeral" } } as const;

interface ICapturedBody {
  model: string;
  messages: Array<Record<string, JSONValue>>;
}

async function capturedBody(
  model: string,
  cacheControl: boolean = true,
  options: IModelOptions = {},
): Promise<ICapturedBody> {
  const origFetch = globalThis.fetch;
  if (options.nativeConversation) {
    ProviderRegistry.registerWithMetadata(PROVIDER_OPENROUTER, new OpenRouterProviderFactory(), {
      ...OPENROUTER_PROVIDER_METADATA,
      capabilities: [...OPENROUTER_PROVIDER_METADATA.capabilities],
      strengths: [...OPENROUTER_PROVIDER_METADATA.strengths],
      pricingTier: PricingTier.MEDIUM,
      supportsNativeConversation: true,
    });
  }
  let sent: ICapturedBody = { model: "", messages: [] };
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })));
  }) as typeof globalThis.fetch;
  try {
    await new OpenRouterProvider({ apiKey: "sk-test", model, cacheControl }).generate(PROMPT, options);
    return sent;
  } finally {
    globalThis.fetch = origFetch;
    if (options.nativeConversation) ProviderRegistry.clear();
  }
}

for (const model of ["anthropic/claude-sonnet-4", "google/gemini-2.5-flash", "deepseek/deepseek-v3.2", CACHED_MODEL]) {
  Deno.test(`${model} gets cache_control on the first message's last text part`, async () => {
    assertEquals((await capturedBody(model)).messages, [{ role: "user", content: [CACHE_PART] }]);
  });
}

for (const model of [QWEN_MODEL, "deepseek/deepseek-flash-latest", "openai/gpt-4o-mini", "vendor/unlisted-model"]) {
  Deno.test(`${model} is not in the documented explicit-caching list and gets no breakpoint`, async () => {
    assertEquals((await capturedBody(model)).messages, [{ role: "user", content: PROMPT }]);
  });
}

Deno.test("with a native conversation only messages[0] gets the breakpoint, and replayed rounds are unchanged", async () => {
  const toolCalls = [{ id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } }];
  const reasoning = [{ type: "reasoning.text", text: "Disclosed reasoning" }];
  const snapshot: INativeConversationSnapshot = {
    initialPrompt: PROMPT,
    turns: [],
    rounds: [{
      assistant: {
        provider: "openrouter",
        assistantContent: null,
        reasoningContent: "Replay reasoning",
        reasoningDetails: reasoning,
        toolCalls,
      },
      calls: [{
        toolUseId: "call-1",
        index: 0,
        toolName: "read_file",
        toolInput: {},
        toolResultContent: "Tool result",
        toolResultIsError: false,
      }],
    }],
    roundInstruction: "Answer now",
  };
  const before = structuredClone(snapshot);
  const options: IModelOptions = { nativeConversation: snapshot };
  const baseline = await capturedBody(CACHED_MODEL, false, options);
  const first = await capturedBody(CACHED_MODEL, true, options);
  assertEquals(first.messages[0], { role: "user", content: [CACHE_PART] });
  assertEquals(first.messages.slice(1), baseline.messages.slice(1));
  assertEquals(first.messages[1], {
    role: "assistant",
    content: null,
    reasoning_content: "Replay reasoning",
    reasoning_details: reasoning,
    tool_calls: toolCalls,
  });
  assertEquals(await capturedBody(CACHED_MODEL, true, options), first);
  assertEquals(snapshot, before);
});

Deno.test("cache_control false sends no breakpoint for any model", async () => {
  for (const model of ["anthropic/claude-sonnet-4", "google/gemini-2.5-flash", CACHED_MODEL, "vendor/unlisted-model"]) {
    assertEquals((await capturedBody(model, false)).messages, [{ role: "user", content: PROMPT }]);
  }
});

Deno.test("measureInputTokens counts the part array", async () => {
  const counted: string[] = [];
  const tokenizer: ITokenizer = {
    countTokens: (text: string) => {
      counted.push(text);
      return Promise.resolve(text.length);
    },
    countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((text) => text.length)),
  };
  const provider = new OpenRouterProvider({ apiKey: "sk-test", model: CACHED_MODEL, tokenizer });
  const measurement = await provider.measureInputTokens(PROMPT);
  const wire = await capturedBody(CACHED_MODEL);
  const messages = [{ role: "user", content: [CACHE_PART] }];
  assertEquals(wire.messages, messages);
  const projection = JSON.stringify({ messages, tools: [] });
  assertEquals(counted, [projection]);
  assertEquals(measurement.totalTokens, projection.length);
});

Deno.test("the cache projection leaves empty messages and leading replay messages unchanged", () => {
  assertEquals(applyCacheControl([], CACHED_MODEL, true), []);
  const replay: OpenAiChatMessage[] = [{ role: "assistant", content: null, tool_calls: [] }];
  assertEquals(applyCacheControl(replay, CACHED_MODEL, true), [{ role: "assistant", content: null, tool_calls: [] }]);
});

Deno.test("the cache projection preserves the input messages", () => {
  const messages: OpenAiChatMessage[] = [{ role: "user", content: PROMPT }];
  assertEquals(applyCacheControl(messages, CACHED_MODEL, true), [{ role: "user", content: [CACHE_PART] }]);
  assertEquals(messages, [{ role: "user", content: PROMPT }]);
});
