/**
 * @module GoogleProviderTest
 * @path tests/ai/google_provider_test.ts
 * @description Verifies the Google LLM provider implementation, ensuring correct
 * API endpoint construction and response parsing for Gemini models.
 */

import { assertStringIncludes } from "@std/assert";
import { GoogleProvider } from "../../src/ai/providers/google_provider.ts";
import { googleResponseConfig, registerProviderTests, spyFetch } from "./helpers/provider_test_helper.ts";

// Register all standard provider tests with Google-specific body extractor
registerProviderTests<{ id: string; generate: (prompt: string) => Promise<string> }>({
  name: "GoogleProvider",
  createProvider: (options, logger) => new GoogleProvider({ apiKey: "test-key", ...options, logger }),
  defaultId: "google-gemini-flash-latest",
  responseConfig: googleResponseConfig,
  apiKeyHeader: "Content-Type",
  apiKeyValue: "application/json",
  stopSequenceKey: "stopSequences",
});

// Google-specific tests

Deno.test("GoogleProvider - generate URL", async () => {
  const provider = new GoogleProvider({ apiKey: "test-key", model: "gemini-3-pro" });

  const { spy: fetchSpy, restore } = spyFetch(googleResponseConfig.wrapResponse("ok"));

  try {
    await provider.generate("Hi");
    const call = fetchSpy.calls[0];
    const url = call.args[0] as string;
    assertStringIncludes(url, "gemini-3-pro:generateContent");
    assertStringIncludes(url, "key=test-key");
  } finally {
    restore();
  }
});
