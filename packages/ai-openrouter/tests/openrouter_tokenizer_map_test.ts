/**
 * @module OpenRouterTokenizerMapTest
 * @path packages/ai-openrouter/tests/openrouter_tokenizer_map_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/constants.ts"]
 * @architectural-layer AI
 * @description Verifies that input measurement counts with the estimator model that matches the model's
 * tokenizer family, and that every other family keeps the configured model id, so the estimator fallback
 * for an unknown id is unchanged.
 */

import { assertEquals } from "@std/assert";
import type { ITokenizer } from "@exaix/core/func";
import { type IOpenRouterModelEntry, OPENROUTER_TOKENIZER_MODEL_MAP, OpenRouterProvider } from "@exaix/ai-openrouter";

const CONFIGURED = "vendor/configured-model";

function recordingTokenizer(seen: string[]): ITokenizer {
  return {
    countTokens: (text: string, model: string) => {
      seen.push(model);
      return Promise.resolve(Math.ceil(text.length / 4));
    },
    countTokensBatch: (texts: string[], model: string) => {
      seen.push(model);
      return Promise.resolve(texts.map((text) => Math.ceil(text.length / 4)));
    },
  };
}

async function modelsUsedFor(entry: IOpenRouterModelEntry | undefined): Promise<string[]> {
  const seen: string[] = [];
  const provider = new OpenRouterProvider({
    apiKey: "sk-test",
    model: CONFIGURED,
    tokenizer: recordingTokenizer(seen),
    capabilities: { getEntry: () => Promise.resolve(entry) },
  });
  await provider.measureInputTokens("measure this prompt", {});
  return [...new Set(seen)];
}

const entryWith = (tokenizer: string | undefined): IOpenRouterModelEntry => ({
  id: CONFIGURED,
  supportedParameters: [],
  ...(tokenizer ? { tokenizer } : {}),
});

Deno.test("a known tokenizer family counts with the mapped estimator model", async () => {
  for (const [family, estimatorModel] of Object.entries(OPENROUTER_TOKENIZER_MODEL_MAP)) {
    assertEquals(await modelsUsedFor(entryWith(family)), [estimatorModel], family);
  }
});

Deno.test("the map covers the GPT, Claude and Gemini families", () => {
  assertEquals(Object.keys(OPENROUTER_TOKENIZER_MODEL_MAP).sort(), ["Claude", "GPT", "Gemini"]);
});

Deno.test("an unknown or router family keeps the configured model id", async () => {
  for (const family of ["Other", "Router", "Qwen", "Llama3"]) {
    assertEquals(await modelsUsedFor(entryWith(family)), [CONFIGURED], family);
  }
});

Deno.test("no entry, or an entry without a tokenizer, keeps the configured model id", async () => {
  assertEquals(await modelsUsedFor(undefined), [CONFIGURED]);
  assertEquals(await modelsUsedFor(entryWith(undefined)), [CONFIGURED]);
});
