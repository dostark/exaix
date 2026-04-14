/**
 * @module MockAIProviderHelper
 * @path tests/helpers/mock_provider.ts
 * @description Provides a configurable mock LLM provider for tests, ensuring
 * stable control over agent responses, token usage, and error states.
 */

import type { IModelProvider } from "../../src/ai/types.ts";
import type { IGenerateResult } from "../../src/ai/providers/common.ts";
import { makeGenerateResult } from "./test_helpers.ts";

/**
 * Creates a mock LLM provider that returns predefined responses.
 * Used across multiple test files to avoid duplication.
 */
export function createMockProvider(responses: string[]): IModelProvider {
  let callCount = 0;
  return {
    id: "mock-provider",
    generate: (_prompt: string): Promise<IGenerateResult> => {
      const response = responses[Math.min(callCount, responses.length - 1)];
      callCount++;
      return Promise.resolve(makeGenerateResult(response));
    },
  };
}
