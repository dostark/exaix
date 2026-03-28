/**
 * @module LlamaProviderUnitTest
 * @path tests/ai/llama_provider_unit_test.ts
 * @description Unit tests for Llama LLM provider.
 */

import { assertEquals } from "@std/assert";
import { LlamaProvider } from "../../src/ai/providers/llama_provider.ts";
import { spyFetch } from "./helpers/provider_test_helper.ts";

Deno.test("LlamaProvider: constructor validates model name", () => {
  // Should throw for unsupported models
  let thrown = false;
  try {
    new LlamaProvider({ model: "gpt-4" });
  } catch (err) {
    thrown = true;
    assertEquals((err as Error).message, "Unsupported model");
  }
  assertEquals(thrown, true);

  // Should accept llama and codellama models
  new LlamaProvider({ model: "llama3:latest" });
  new LlamaProvider({ model: "codellama:7b" });
});

Deno.test("LlamaProvider: generate handles JSON extraction from response", async () => {
  const provider = new LlamaProvider({ model: "llama3:latest", endpoint: "http://ollama:11434/api/generate" });

  const mockResponse = {
    response: 'Sure! Here\'s the result: ```json\n{"id": "test"}\n```',
  };

  const { spy: _fetchSpy, restore } = spyFetch(mockResponse);

  try {
    const result = await provider.generate("Hi");
    assertEquals(result, '{"id": "test"}');
  } finally {
    restore();
  }
});

Deno.test("LlamaProvider: generate handles raw response backup", async () => {
  const provider = new LlamaProvider({ model: "llama3:latest", endpoint: "http://ollama:11434/api/generate" });

  const mockResponse = {
    response: "This is not JSON at all.",
  };

  const { spy: _fetchSpy, restore } = spyFetch(mockResponse);

  try {
    const result = await provider.generate("Hi");
    assertEquals(result, "This is not JSON at all.");
  } finally {
    restore();
  }
});

Deno.test("LlamaProvider: generate handles partial JSON object extraction", async () => {
  const provider = new LlamaProvider({ model: "llama3:latest", endpoint: "http://ollama:11434/api/generate" });

  const mockResponse = {
    response: 'Here is your JSON object: {"key": "value"}. Hope it helps!',
  };

  const { spy: _fetchSpy, restore } = spyFetch(mockResponse);

  try {
    const result = await provider.generate("Hi");
    assertEquals(result, '{"key": "value"}');
  } finally {
    restore();
  }
});

Deno.test("LlamaProvider: constructor uses default endpoint and retry settings", () => {
  const provider = new LlamaProvider({ model: "llama3:latest" });
  assertEquals(provider.endpoint.includes("localhost:11434"), true);
  assertEquals(provider.timeoutMs > 0, true);
});
