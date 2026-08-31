// deno-lint-ignore-file no-explicit-any
/**
 * @module TokenMetricsProvidersIntegrationTest
 * @path tests/integration/provider_token_metrics_test.ts
 * @description Verifies token usage tracking across multiple live LLM providers (Gemini,
 * OpenAI, Anthropic), ensuring correct capture of usage metrics and accurate cost mapping.
 */

import { assert, assertExists } from "@std/assert";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { EventLogger } from "@exaix/core/logger";
import { AnthropicProvider } from "@exaix/ai-anthropic";
import { GoogleProvider } from "@exaix/ai-google";
import { OpenAIProvider } from "@exaix/ai-openai";
import type { IModelProvider } from "@exaix/ai/types.ts";
import * as TEST_CONST from "@exaix/testing";

/**
 * Check if test should run (opt-in required)
 */
function shouldSkipTest(): { skip: boolean; reason?: string } {
  const enabled = Deno.env.get(TEST_CONST.ENV_TEST_ENABLE_PAID_LLM);
  if (enabled !== TEST_CONST.ENV_TEST_ENABLE_PAID_LLM_VALUE) {
    return {
      skip: true,
      reason: TEST_CONST.SKIP_MSG_OPT_IN_REQUIRED,
    };
  }
  return { skip: false };
}

/**
 * Check if provider API key is available
 */
function hasApiKey(envVar: string): boolean {
  const key = Deno.env.get(envVar);
  return !!key && key.length > 0;
}

/**
 * Handle common API errors and skip test if needed
 * Returns true if test should be skipped
 */
function handleApiError(
  error: Error,
  providerName: string,
  skipMessages: {
    invalidKey: string;
    rateLimit: string;
    modelNotFound: string;
    quota: string;
    credits?: string;
  },
): boolean {
  const errMsg = error.message.toLowerCase();

  if (
    errMsg.includes(TEST_CONST.ERROR_PATTERN_401) ||
    errMsg.includes(TEST_CONST.ERROR_PATTERN_UNAUTHORIZED)
  ) {
    console.warn(`⏭️  Skipping ${providerName} test: ${skipMessages.invalidKey}`);
    return true;
  }
  if (
    errMsg.includes(TEST_CONST.ERROR_PATTERN_429) ||
    errMsg.includes(TEST_CONST.ERROR_PATTERN_RATE_LIMIT)
  ) {
    console.warn(`⏭️  Skipping ${providerName} test: ${skipMessages.rateLimit}`);
    return true;
  }
  if (
    errMsg.includes(TEST_CONST.ERROR_PATTERN_404) ||
    errMsg.includes(TEST_CONST.ERROR_PATTERN_NOT_FOUND)
  ) {
    console.warn(`⏭️  Skipping ${providerName} test: ${skipMessages.modelNotFound}`);
    return true;
  }
  if (skipMessages.credits) {
    if (
      errMsg.includes(TEST_CONST.ERROR_PATTERN_400) ||
      errMsg.includes(TEST_CONST.ERROR_PATTERN_CREDIT) ||
      errMsg.includes(TEST_CONST.ERROR_PATTERN_BALANCE)
    ) {
      console.warn(`⏭️  Skipping ${providerName} test: ${skipMessages.credits}`);
      return true;
    }
  }
  if (
    errMsg.includes(TEST_CONST.ERROR_PATTERN_403) ||
    errMsg.includes(TEST_CONST.ERROR_PATTERN_QUOTA)
  ) {
    console.warn(`⏭️  Skipping ${providerName} test: ${skipMessages.quota}`);
    return true;
  }

  return false;
}

interface ActivityRow {
  id: number;
  action_type: string;
  trace_id: string;
  [key: string]: any;
  payload: string;
  timestamp: string;
}

interface LLMUsagePayload {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  model: string;
}

/**
 * Query token events from database
 */
async function queryTokenEvents(env: TestEnvironment): Promise<ActivityRow[]> {
  // Wait for async logging to complete
  await new Promise((resolve) => setTimeout(resolve, TEST_CONST.TOKEN_METRICS_ASYNC_WAIT_MS));

  // Flush database to ensure all events are persisted
  env.db.waitForFlush();

  // Query all llm.usage events from the activity table
  const stmt = env.db["db"].prepare(
    `SELECT id, trace_id, actor, identity_id, action_type, target, payload, timestamp
     FROM activity
     WHERE action_type = '${TEST_CONST.ACTION_TYPE_LLM_USAGE}'
     ORDER BY timestamp DESC
     LIMIT ${TEST_CONST.TOKEN_METRICS_DB_QUERY_LIMIT}`,
  );
  return stmt.all() as ActivityRow[];
}

/**
 * Validate token metrics payload
 */
function validateTokenMetrics(payload: LLMUsagePayload, providerName: string) {
  // Validate token metrics exist
  assertExists(payload.prompt_tokens, TEST_CONST.ASSERT_MSG_PROMPT_TOKENS_EXISTS);
  assertExists(payload.completion_tokens, TEST_CONST.ASSERT_MSG_COMPLETION_TOKENS_EXISTS);
  assertExists(payload.total_tokens, TEST_CONST.ASSERT_MSG_TOTAL_TOKENS_EXISTS);
  assertExists(payload.cost_usd, TEST_CONST.ASSERT_MSG_COST_USD_EXISTS);
  assertExists(payload.model, TEST_CONST.ASSERT_MSG_MODEL_EXISTS);

  // Validate token metrics are positive
  assert(payload.prompt_tokens > 0, TEST_CONST.ASSERT_MSG_PROMPT_TOKENS_GT_ZERO);
  assert(payload.completion_tokens > 0, TEST_CONST.ASSERT_MSG_COMPLETION_TOKENS_GT_ZERO);
  assert(payload.total_tokens > 0, TEST_CONST.ASSERT_MSG_TOTAL_TOKENS_GT_ZERO);
  assert(payload.cost_usd > 0, TEST_CONST.ASSERT_MSG_COST_USD_GT_ZERO);

  console.log(`✅ ${providerName} token metrics validated:`, {
    prompt_tokens: payload.prompt_tokens,
    completion_tokens: payload.completion_tokens,
    total_tokens: payload.total_tokens,
    cost_usd: payload.cost_usd,
    model: payload.model,
  });
}

/**
 * Test token metrics for a provider
 */
async function testProviderTokenMetrics(
  env: TestEnvironment,
  provider: IModelProvider,
  providerName: string,
  assertMessage: string,
  skipMessages: {
    invalidKey: string;
    rateLimit: string;
    modelNotFound: string;
    quota: string;
    credits?: string;
  },
): Promise<void> {
  // Make a simple LLM call with minimal prompt
  try {
    const response = await provider.generate(TEST_CONST.TOKEN_METRICS_TEST_PROMPT);
    assertExists(response, TEST_CONST.ASSERT_MSG_RESPONSE_EXISTS);
    assert(response.content.length > 0, TEST_CONST.ASSERT_MSG_RESPONSE_NOT_EMPTY);
  } catch (error) {
    // Handle common API errors gracefully
    const shouldSkip = handleApiError(error as Error, providerName, skipMessages);
    if (shouldSkip) {
      return;
    }
    // Unexpected error - rethrow
    throw error;
  }

  // Query and validate token events
  const tokenEvents = await queryTokenEvents(env);

  console.log(`Found ${tokenEvents.length} llm.usage events in database`);

  assert(tokenEvents.length > 0, assertMessage);

  const tokenEvent = tokenEvents[tokenEvents.length - 1];
  const payload = JSON.parse(tokenEvent.payload);

  // Validate token metrics
  validateTokenMetrics(payload, providerName);
}

// Google Gemini Token Metrics Test

Deno.test({
  name: "Google Gemini - token metrics tracking with real API",
  ignore: shouldSkipTest().skip,
  async fn() {
    const skipCheck = shouldSkipTest();
    if (skipCheck.skip) {
      console.warn(`⏭️  Skipping test: ${skipCheck.reason}`);
      return;
    }

    if (!hasApiKey(TEST_CONST.ENV_GOOGLE_API_KEY)) {
      console.warn(`⏭️  Skipping Google test: ${TEST_CONST.SKIP_MSG_GOOGLE_API_KEY_MISSING}`);
      return;
    }

    const env = await TestEnvironment.create({ initGit: false });

    try {
      const apiKey = Deno.env.get(TEST_CONST.ENV_GOOGLE_API_KEY)!;
      const logger = new EventLogger({ db: env.db });

      const provider = new GoogleProvider({
        apiKey,
        model: TEST_CONST.TOKEN_METRICS_MODEL_GOOGLE,
        logger,
      });

      await testProviderTokenMetrics(
        env,
        provider,
        "Google",
        TEST_CONST.ASSERT_MSG_LLM_USAGE_EVENTS_GOOGLE,
        {
          invalidKey: TEST_CONST.SKIP_MSG_GOOGLE_INVALID_KEY,
          rateLimit: TEST_CONST.SKIP_MSG_GOOGLE_RATE_LIMIT,
          modelNotFound: TEST_CONST.SKIP_MSG_GOOGLE_MODEL_NOT_FOUND,
          quota: TEST_CONST.SKIP_MSG_GOOGLE_QUOTA,
        },
      );
    } finally {
      await env.cleanup();
    }
  },
});

// OpenAI GPT Token Metrics Test

Deno.test({
  name: "OpenAI GPT - token metrics tracking with real API",
  ignore: shouldSkipTest().skip,
  async fn() {
    const skipCheck = shouldSkipTest();
    if (skipCheck.skip) {
      console.warn(`⏭️  Skipping test: ${skipCheck.reason}`);
      return;
    }

    if (!hasApiKey(TEST_CONST.ENV_OPENAI_API_KEY)) {
      console.warn(`⏭️  Skipping OpenAI test: ${TEST_CONST.SKIP_MSG_OPENAI_API_KEY_MISSING}`);
      return;
    }

    const env = await TestEnvironment.create({ initGit: false });

    try {
      const apiKey = Deno.env.get(TEST_CONST.ENV_OPENAI_API_KEY)!;
      const logger = new EventLogger({ db: env.db });

      const provider = new OpenAIProvider({
        apiKey,
        model: TEST_CONST.TOKEN_METRICS_MODEL_OPENAI,
        logger,
      });

      await testProviderTokenMetrics(
        env,
        provider,
        "OpenAI",
        TEST_CONST.ASSERT_MSG_LLM_USAGE_EVENTS_OPENAI,
        {
          invalidKey: TEST_CONST.SKIP_MSG_OPENAI_INVALID_KEY,
          rateLimit: TEST_CONST.SKIP_MSG_OPENAI_RATE_LIMIT,
          modelNotFound: TEST_CONST.SKIP_MSG_OPENAI_MODEL_NOT_FOUND,
          quota: TEST_CONST.SKIP_MSG_OPENAI_QUOTA,
        },
      );
    } finally {
      await env.cleanup();
    }
  },
});

// Anthropic Claude Token Metrics Test

Deno.test({
  name: "Anthropic Claude - token metrics tracking with real API",
  ignore: shouldSkipTest().skip,
  async fn() {
    const skipCheck = shouldSkipTest();
    if (skipCheck.skip) {
      console.warn(`⏭️  Skipping test: ${skipCheck.reason}`);
      return;
    }

    if (!hasApiKey(TEST_CONST.ENV_ANTHROPIC_API_KEY)) {
      console.warn(`⏭️  Skipping Anthropic test: ${TEST_CONST.SKIP_MSG_ANTHROPIC_API_KEY_MISSING}`);
      return;
    }

    const env = await TestEnvironment.create({ initGit: false });

    try {
      const apiKey = Deno.env.get(TEST_CONST.ENV_ANTHROPIC_API_KEY)!;
      const logger = new EventLogger({ db: env.db });

      const provider = new AnthropicProvider({
        apiKey,
        model: TEST_CONST.TOKEN_METRICS_MODEL_ANTHROPIC,
        logger,
      });

      await testProviderTokenMetrics(
        env,
        provider,
        "Anthropic",
        TEST_CONST.ASSERT_MSG_LLM_USAGE_EVENTS_ANTHROPIC,
        {
          invalidKey: TEST_CONST.SKIP_MSG_ANTHROPIC_INVALID_KEY,
          rateLimit: TEST_CONST.SKIP_MSG_ANTHROPIC_RATE_LIMIT,
          modelNotFound: TEST_CONST.SKIP_MSG_ANTHROPIC_MODEL_NOT_FOUND,
          quota: TEST_CONST.SKIP_MSG_ANTHROPIC_QUOTA,
          credits: TEST_CONST.SKIP_MSG_ANTHROPIC_CREDITS,
        },
      );
    } finally {
      await env.cleanup();
    }
  },
});
