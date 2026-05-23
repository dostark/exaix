// deno-lint-ignore-file no-explicit-any
/**
 * @module ProviderUsageMappingTest
 * @path packages/ai/tests/providers/provider_usage_mapping_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Unit tests verifying that provider.generate() returns IGenerateResult with usage and cost fields.
 */

import { assertEquals, assertExists } from "@std/assert";
import { OpenAIProvider } from "@exaix/ai-openai";
import type { IGenerateResult } from "../../src/providers/common.ts";

/**
 * Stub attemptGenerate on OpenAIProvider to bypass real network call.
 * Validates that the base class plumbing correctly surfaces the IGenerateResult.
 */
Deno.test("Provider.generate returns IGenerateResult with usage and cost", async () => {
  const provider = new OpenAIProvider({ apiKey: "test" });

  // Stub attemptGenerate to return a known fixture
  const stubbedResult: IGenerateResult = {
    content: "test",
    usage: {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    },
    model: "gpt-4",
    provider: "openai",
    cost_usd: 0.001,
  };

  const proto = Object.getPrototypeOf(provider) as { attemptGenerate: any };
  const originalAttempt = proto.attemptGenerate;
  // deno-lint-ignore require-await
  proto.attemptGenerate = async function (): Promise<IGenerateResult> {
    return stubbedResult;
  };

  const result = await provider.generate("test");
  assertExists(result.usage);
  assertEquals(result.usage.promptTokens, 10);
  assertEquals(result.cost_usd, 0.001);
  assertEquals(typeof result.content, "string");

  // Clean up
  proto.attemptGenerate = originalAttempt;
});
