/**
 * @module AIPackageBarrelExportsRegressionTest
 * @path packages/ai/tests/barrel_exports_regression_test.ts
 * @description Guards the public @exaix/ai barrel so provider contracts and
 * helpers remain available to downstream packages.
 */

import { assertEquals, assertExists } from "@std/assert";
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

Deno.test("@exaix/ai/providers exports provider contracts and helpers", async () => {
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
