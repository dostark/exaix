/**
 * @module AIPackageBarrelExportsRegressionTest
 * @path packages/ai/tests/barrel_exports_regression_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Guards the public @exaix/ai surfaces so provider contracts and
 * helpers remain available to downstream packages via their canonical aliases.
 * Provider contracts live in @exaix/ai/providers; shared utilities in @exaix/ai.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ModelFactory } from "@exaix/ai";
import {
  BaseProvider,
  ConnectionError,
  createFailingMock,
  createPlanGeneratorMock,
  createSlowMock,
  type IBaseProviderOptions,
  type IGenerateResult,
  isRetryable,
  LazyProvider,
  MockLLMProvider,
  withRetry,
} from "@exaix/ai/providers";

function assertGenerateResultShape(_result: IGenerateResult): void {
  // Type-level helper: compiles only if IGenerateResult is publicly reachable.
}

Deno.test("@exaix/ai/providers subpath exports provider contracts and helpers", async () => {
  assertExists(BaseProvider);
  assertExists(LazyProvider);
  assertExists(MockLLMProvider);
  assertEquals(typeof withRetry, "function");
  assertEquals(typeof isRetryable, "function");
  assertEquals(typeof createPlanGeneratorMock, "function");
  assertEquals(typeof createFailingMock, "function");
  assertEquals(typeof createSlowMock, "function");

  const options: IBaseProviderOptions = { apiKey: "test-api-key" };
  assertEquals(options.apiKey, "test-api-key");

  const retryable = isRetryable(new ConnectionError("mock", "boom"));
  assertEquals(retryable, true);

  const generated = await withRetry(() => Promise.resolve("ok"), { maxRetries: 1, baseDelayMs: 1 });
  assertEquals(generated, "ok");

  assertGenerateResultShape({
    content: "ok",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: "mock-model",
    provider: "mock",
  });
});

Deno.test("@exaix/ai root barrel exports shared utilities", () => {
  assertExists(ModelFactory);
});
