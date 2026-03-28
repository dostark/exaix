/**
 * @module GoogleProviderUnitTest
 * @path tests/ai/google_provider_unit_test.ts
 * @description Unit tests for Google Gemini provider.
 */

import { assertEquals } from "@std/assert";
import { GoogleProvider } from "../../src/ai/providers/google_provider.ts";
import { spyFetch } from "./helpers/provider_test_helper.ts";

Deno.test("GoogleProvider: generate calls correct endpoint and extracts text content", async () => {
  const provider = new GoogleProvider({ apiKey: "test-key", model: "gemini-pro" });

  const mockResponse = {
    candidates: [{
      content: {
        parts: [{ text: "Hello! This is Gemini." }],
      },
    }],
    usageMetadata: {
      promptTokenCount: 5,
      candidatesTokenCount: 10,
      totalTokenCount: 15,
    },
  };

  const { spy: fetchSpy, restore } = spyFetch(mockResponse);

  try {
    const result = await provider.generate("Hi Gemini");
    assertEquals(result, "Hello! This is Gemini.");

    const call = fetchSpy.calls[0];
    const url = call.args[0] as string;
    assertEquals(url.includes("gemini-pro:generateContent"), true);
    assertEquals(url.includes("key=test-key"), true);
  } finally {
    restore();
  }
});

Deno.test("GoogleProvider: generate passes generation binary options to API", async () => {
  const provider = new GoogleProvider({ apiKey: "test-key" });

  const mockResponse = {
    candidates: [{ content: { parts: [{ text: "ok" }] } }],
  };

  const { spy: fetchSpy, restore } = spyFetch(mockResponse);

  try {
    await provider.generate("Hi", {
      temperature: 0.5,
      max_tokens: 100,
      stop: ["STOP"],
    });

    const body = JSON.parse(fetchSpy.calls[0].args[1].body);
    assertEquals(body.generationConfig.temperature, 0.5);
    assertEquals(body.generationConfig.maxOutputTokens, 100);
    assertEquals(body.generationConfig.stopSequences, ["STOP"]);
  } finally {
    restore();
  }
});
