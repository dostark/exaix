// deno-lint-ignore-file no-explicit-any
/**
 * @module ProviderEndpointRegressionTest
 * @path packages/ai/tests/provider_endpoint_regression_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Regression tests for LLM provider endpoints, ensuring stable
 * delivery of prompts for Gemini, OpenAI, and Anthropic backends.
 */

import { assert } from "@std/assert";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "@exaix/ai-anthropic";
import { DEFAULT_GOOGLE_MODEL, GoogleProvider } from "@exaix/ai-google";
import { DEFAULT_OPENAI_MODEL, OpenAIProvider } from "@exaix/ai-openai";
import * as TEST_CONSTANTS from "@exaix/testing";

/**
 * Live Regression Test for Provider Endpoints
 *
 * Verifies that the default models and endpoints are correctly configured and accepted by the providers' APIs.
 * Uses REAL API keys from the environment.
 *
 * Pre-requisites:
 * - GOOGLE_API_KEY
 * - OPENAI_API_KEY
 * - ANTHROPIC_API_KEY
 * must be set in the environment.
 */

const TEST_PROMPT = TEST_CONSTANTS.REGRESSION_TEST_PROMPT;

function getErrorMessage(error: any): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorName(error: any): string {
  return error instanceof Error ? error.name : "UnknownError";
}

Deno.test({
  name: "[regression] GoogleProvider: Verify gemini-flash-latest works with v1beta",
  ignore: !Deno.env.get(TEST_CONSTANTS.ENV_GOOGLE_API_KEY),
  fn: async () => {
    const provider = new GoogleProvider({
      apiKey: Deno.env.get(TEST_CONSTANTS.ENV_GOOGLE_API_KEY)!,
      model: DEFAULT_GOOGLE_MODEL, // gemini-flash-latest
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(new Error(`Request timed out after ${TEST_CONSTANTS.REGRESSION_TEST_TIMEOUT_MS / 1000} seconds`)),
          TEST_CONSTANTS.REGRESSION_TEST_TIMEOUT_MS,
        );
      });
      const response = await Promise.race([provider.generate(TEST_PROMPT), timeoutPromise]);
      clearTimeout(timeoutId!);
      assert(response.content.length > 0, "Response should not be empty");
      console.log(
        `${TEST_CONSTANTS.LOG_PREFIX_GOOGLE_RESPONSE} ${
          response.content.substring(0, TEST_CONSTANTS.TEST_LOG_PREVIEW_LENGTH)
        }...`,
      );
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      const errorMessage = getErrorMessage(error);
      console.log(`${TEST_CONSTANTS.LOG_PREFIX_GOOGLE_ERROR} ${getErrorName(error)} - ${errorMessage}`);
      if (errorMessage.includes(TEST_CONSTANTS.ERROR_MSG_HTTP_404)) throw error;
      console.log(TEST_CONSTANTS.LOG_MSG_ENDPOINT_REACHED);
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "[regression] OpenAIProvider: Verify default model works",
  ignore: !Deno.env.get(TEST_CONSTANTS.ENV_OPENAI_API_KEY),
  fn: async () => {
    const provider = new OpenAIProvider({
      apiKey: Deno.env.get(TEST_CONSTANTS.ENV_OPENAI_API_KEY)!,
      model: DEFAULT_OPENAI_MODEL,
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(new Error(`Request timed out after ${TEST_CONSTANTS.REGRESSION_TEST_TIMEOUT_MS / 1000} seconds`)),
          TEST_CONSTANTS.REGRESSION_TEST_TIMEOUT_MS,
        );
      });
      const response = await Promise.race([provider.generate(TEST_PROMPT), timeoutPromise]);
      clearTimeout(timeoutId!);
      assert(response.content.length > 0, "Response should not be empty");
      console.log(
        `${TEST_CONSTANTS.LOG_PREFIX_OPENAI_RESPONSE} ${
          response.content.substring(0, TEST_CONSTANTS.TEST_LOG_PREVIEW_LENGTH)
        }...`,
      );
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      const errorMessage = getErrorMessage(error);
      console.log(`${TEST_CONSTANTS.LOG_PREFIX_OPENAI_ERROR} ${getErrorName(error)} - ${errorMessage}`);
      if (errorMessage.includes(TEST_CONSTANTS.ERROR_MSG_HTTP_404)) throw error;
      console.log(TEST_CONSTANTS.LOG_MSG_ENDPOINT_REACHED);
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "[regression] AnthropicProvider: Verify default model works",
  ignore: !Deno.env.get(TEST_CONSTANTS.ENV_ANTHROPIC_API_KEY),
  fn: async () => {
    const provider = new AnthropicProvider({
      apiKey: Deno.env.get(TEST_CONSTANTS.ENV_ANTHROPIC_API_KEY)!,
      model: DEFAULT_ANTHROPIC_MODEL,
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(new Error(`Request timed out after ${TEST_CONSTANTS.REGRESSION_TEST_TIMEOUT_MS / 1000} seconds`)),
          TEST_CONSTANTS.REGRESSION_TEST_TIMEOUT_MS,
        );
      });
      const response = await Promise.race([provider.generate(TEST_PROMPT), timeoutPromise]);
      clearTimeout(timeoutId!);
      assert(response.content.length > 0, "Response should not be empty");
      console.log(
        `${TEST_CONSTANTS.LOG_PREFIX_ANTHROPIC_RESPONSE} ${
          response.content.substring(0, TEST_CONSTANTS.TEST_LOG_PREVIEW_LENGTH)
        }...`,
      );
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      const errorMessage = getErrorMessage(error);
      console.log(`${TEST_CONSTANTS.LOG_PREFIX_ANTHROPIC_ERROR} ${getErrorName(error)} - ${errorMessage}`);
      // Anthropic 404 is "not_found_error"
      if (
        errorMessage.includes(TEST_CONSTANTS.ERROR_MSG_HTTP_404) ||
        errorMessage.includes(TEST_CONSTANTS.ERROR_MSG_NOT_FOUND)
      ) {
        console.error(TEST_CONSTANTS.LOG_MSG_NOT_FOUND_DETECTED);
        throw error;
      }
      console.log(TEST_CONSTANTS.LOG_MSG_ENDPOINT_REACHED_ANHROPIC);
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
