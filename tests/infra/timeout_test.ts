/**
 * @module InfraTimeoutTest
 * @path tests/infra/timeout_test.ts
 * @description Verifies LLM provider timeout configurations, ensuring that
 * network deadlines are correctly propagated to provider-specific SDKs.
 */
import { assertEquals } from "@std/assert";
import { OpenAIProvider } from "@exaix/ai/providers/openai_provider.ts";
import { AnthropicProvider } from "@exaix/ai/providers/anthropic_provider.ts";
import { GoogleProvider } from "@exaix/ai/providers/google_provider.ts";
import { LlamaProvider } from "@exaix/ai/providers/llama_provider.ts";
Deno.test("Provider timeout configuration - OpenAI with option", () => {
  const provider = new OpenAIProvider({
    apiKey: "test-key",
    timeoutMs: 45000,
  });

  // Verify timeout is set from option
  assertEquals(provider.timeoutMs, 45000);
});

Deno.test("Provider timeout configuration - Anthropic with option", () => {
  const provider = new AnthropicProvider({
    apiKey: "test-key",
    timeoutMs: 60000,
  });

  // Verify timeout is set from option
  assertEquals(provider.timeoutMs, 60000);
});

Deno.test("Provider timeout configuration - Google with option", () => {
  const provider = new GoogleProvider({
    apiKey: "test-key",
    timeoutMs: 30000,
  });

  // Verify timeout is set from option
  assertEquals(provider.timeoutMs, 30000);
});

Deno.test("Provider timeout configuration - Ollama with option", () => {
  const provider = new LlamaProvider({
    model: "llama3.2:8b",
    timeoutMs: 120000,
  });

  // Verify timeout is set from option
  assertEquals(provider.timeoutMs, 120000);
});

Deno.test("Provider timeout configuration - defaults", () => {
  // Test defaults when no config or options provided
  const openaiProvider = new OpenAIProvider({ apiKey: "test-key" });
  const anthropicProvider = new AnthropicProvider({ apiKey: "test-key" });
  const googleProvider = new GoogleProvider({ apiKey: "test-key" });
  const llamaProvider = new LlamaProvider({ model: "llama3.2:8b" });

  // Verify defaults are used
  assertEquals(openaiProvider.timeoutMs, 30000); // DEFAULT_OPENAI_TIMEOUT_MS
  assertEquals(anthropicProvider.timeoutMs, 60000); // DEFAULT_ANTHROPIC_TIMEOUT_MS
  assertEquals(googleProvider.timeoutMs, 30000); // DEFAULT_GOOGLE_TIMEOUT_MS
  assertEquals(llamaProvider.timeoutMs, 120000); // DEFAULT_OLLAMA_TIMEOUT_MS
});
