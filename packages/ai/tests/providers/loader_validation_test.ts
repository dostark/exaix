/**
 * @module LoaderValidationTest
 * @path packages/ai/tests/providers/loader_validation_test.ts
 * @description Phase 157 Step 2 — `loadRecordingsFromDir` must validate each recording
 *   against the `IRecordedResponse` contract and fail loudly, naming the offending file,
 *   instead of an unvalidated `JSON.parse` crash (invalid JSON) or silently loading a
 *   malformed object (valid JSON, wrong shape).
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/mock_llm_provider.ts]
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { MockStrategy } from "@exaix/core";
import { MockLLMError, MockLLMProvider } from "../../src/providers/mock_llm_provider.ts";

Deno.test("[loader_validation] invalid JSON in a fixture file fails construction, naming the file", async () => {
  const dir = await Deno.makeTempDir();
  const badFile = `${dir}/broken.json`;
  await Deno.writeTextFile(badFile, "{ this is not valid json");

  assertThrows(
    () => new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir }),
    MockLLMError,
    badFile,
  );
});

Deno.test("[loader_validation] a schema-violating fixture (valid JSON, wrong shape) fails construction, naming the file", async () => {
  const dir = await Deno.makeTempDir();
  const badFile = `${dir}/missing_fields.json`;
  await Deno.writeTextFile(badFile, JSON.stringify({ promptHash: "abc" })); // missing everything else

  assertThrows(
    () => new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir }),
    MockLLMError,
    badFile,
  );
});

Deno.test("[loader_validation] a well-formed fixture file still loads and replays", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/good.json`,
    JSON.stringify({
      promptHash: "abc123",
      promptPreview: "You are a senior...",
      response: "## Plan\n\n1. First step",
      model: "claude-x",
      tokens: { input: 10, output: 5 },
      recordedAt: "2026-01-01T00:00:00Z",
    }),
  );

  const provider = new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir, patterns: [] });
  const result = await provider.generate("You are a senior...");
  assertEquals(result.content, "## Plan\n\n1. First step");

  await assertRejects(
    async () => await provider.generate("a totally different prompt"),
    MockLLMError,
  );
});
