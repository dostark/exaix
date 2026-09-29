/**
 * @module ProviderInstanceMetadataTest
 * @path packages/ai/tests/provider_instance_metadata_test.ts
 * @description Verifies exact and longest-prefix provider metadata lookup for instance IDs.
 * @architectural-layer Test
 * @dependencies [@exaix/ai]
 * @related-files [packages/ai/src/provider_registry.ts, packages/ai/src/effort_resolver.ts]
 */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { MockStrategy, PricingTier, ProviderCostTier, ProviderType } from "@exaix/core";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { assertNoNativeConversation, ProviderRegistry } from "../src/provider_registry.ts";
import { longestPrefixMatch } from "../src/provider_registry.ts";
import { resolveProviderType } from "../src/effort_resolver.ts";
import { MockLLMProvider } from "../src/providers/mock_llm_provider.ts";
import { OpenAIProvider } from "@exaix/ai-openai";
import { AnthropicProvider } from "@exaix/ai-anthropic";
import { GoogleProvider } from "@exaix/ai-google";
import { OpenRouterProvider } from "@exaix/ai-openrouter";

Deno.test("existing native providers reject compatible snapshots before transport", async () => {
  ProviderRegistry.clear();
  const originalFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = () => {
    fetched++;
    return Promise.reject(new Error("unexpected transport"));
  };
  try {
    for (const Provider of [OpenAIProvider, AnthropicProvider, GoogleProvider, OpenRouterProvider]) {
      const provider = new Provider({ apiKey: "fixture-key", maxRetries: 1 });
      await assertRejects(
        () => provider.generate("immutable", { nativeConversation: { initialPrompt: "immutable", turns: [] } }),
        Error,
        "does not support",
      );
    }
    assertEquals(fetched, 0);
  } finally {
    globalThis.fetch = originalFetch;
    ProviderRegistry.clear();
  }
});

function metadata(name: string, supportsNativeConversation = false) {
  return {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: true,
    ...(supportsNativeConversation ? { supportsNativeConversation: true } : {}),
  };
}

Deno.test("[phase155.registry] shared prefix matching chooses the longest delimited candidate", () => {
  assertEquals(longestPrefixMatch("openai-chat-gpt-4.1-mini", ["openai", "openai-chat"]), "openai-chat");
  assertEquals(longestPrefixMatch("openai-gpt-5-mini", ["openai", "openai-chat"]), "openai");
  assertEquals(longestPrefixMatch("unknown-x", ["openai", "openai-chat"]), undefined);
});

Deno.test("[phase155.registry] metadata lookup uses exact IDs then longest registered prefixes", () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("openai", new MockProviderFactory(), metadata("openai"));
  ProviderRegistry.registerWithMetadata(
    "openai-chat",
    new MockProviderFactory(),
    metadata("openai-chat", true),
  );
  try {
    assertEquals(ProviderRegistry.getMetadataForInstance("openai-chat-gpt-4.1-mini")?.name, "openai-chat");
    assertEquals(
      ProviderRegistry.getMetadataForInstance("openai-chat-gpt-4.1-mini")?.supportsNativeConversation,
      true,
    );
    assertEquals(ProviderRegistry.getMetadataForInstance("openai-gpt-5-mini")?.name, "openai");
    assertEquals(ProviderRegistry.getMetadataForInstance("unknown-x"), undefined);
    assertEquals(ProviderRegistry.getMetadataForInstance(undefined), undefined);
    assertEquals(resolveProviderType("openai-chat-gpt-4.1-mini"), ProviderType.OPENAI_CHAT);
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("metadata lookup sees through the rate-limited wrapper prefix", () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("openai", new MockProviderFactory(), metadata("openai"));
  ProviderRegistry.registerWithMetadata(
    "openai-chat",
    new MockProviderFactory(),
    metadata("openai-chat", true),
  );
  try {
    assertEquals(ProviderRegistry.getMetadataForInstance("rate-limited-openai-gpt-5.6-terra")?.name, "openai");
    assertEquals(ProviderRegistry.getMetadataForInstance("rate-limited-openai-chat-gpt-6-luna")?.name, "openai-chat");
    assertEquals(ProviderRegistry.getMetadataForInstance("rate-limited-unknown-x"), undefined);
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[phase155.registry] snapshots are accepted only by metadata-enabled provider instances", () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("openai", new MockProviderFactory(), metadata("openai"));
  ProviderRegistry.registerWithMetadata("openai-chat", new MockProviderFactory(), metadata("openai-chat", true));
  const options = { nativeConversation: { initialPrompt: "immutable", turns: [] } };

  assertThrows(() => assertNoNativeConversation("openai-gpt-5", options), Error, "does not support");
  assertNoNativeConversation("openai-chat-fixture-model", options);
});

Deno.test("mock provider rejects a native snapshot instead of silently discarding conversation state", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED);
  await assertRejects(
    () => provider.generate("immutable", { nativeConversation: { initialPrompt: "immutable", turns: [] } }),
    Error,
    "does not support",
  );
});
