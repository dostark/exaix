/**
 * @module AnthropicRequestDebugDumpTest
 * @path packages/ai-anthropic/tests/anthropic_request_debug_dump_test.ts
 * @related-files [packages/ai-anthropic/src/anthropic_provider.ts, packages/ai-anthropic/src/anthropic_request_schema.ts]
 * @architectural-layer AI
 * @description Verifies AnthropicProvider logs the exact outbound JSON request body at
 * debug level (for diagnosing live-provider issues without a network capture tool) and
 * validates it against the Messages API request schema before sending.
 */

import { assertEquals, assertExists } from "@std/assert";
import { spy } from "@std/testing/mock";
import { AnthropicProvider, AnthropicProviderFactory } from "../mod.ts";
import { PROVIDER_EVENT_REQUEST_DEBUG_DUMP, ProviderType } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { stubFetchSuccess } from "../../ai/tests/helpers/provider_test_helper.ts";
import { anthropicResponseConfig } from "../../ai/tests/helpers/provider_test_helper.ts";
import { createTestConfig } from "../../ai/tests/helpers/test_config.ts";

Deno.test("AnthropicProvider logs the full outbound request JSON at debug level", async () => {
  const logger = new EventLogger({ prefix: "[Test]" });
  const debugSpy = spy(logger, "debug");
  const provider = new AnthropicProvider({ apiKey: "test-key", logger });

  const fetchStub = stubFetchSuccess(anthropicResponseConfig.wrapResponse("ok"));
  try {
    await provider.generate("hello world");
  } finally {
    fetchStub.restore();
  }

  const dumpCall = debugSpy.calls.find((c) => c.args[0] === PROVIDER_EVENT_REQUEST_DEBUG_DUMP);
  assertExists(dumpCall, "expected a provider.request_debug_dump debug log entry");

  const payload = dumpCall.args[2] as Record<string, JSONValue>;
  assertExists(payload.request_body, "debug dump must carry the full request body");
  assertEquals(payload.valid, true, "a well-formed request should validate against the schema");

  const requestBody = payload.request_body as Record<string, JSONValue>;
  assertEquals(requestBody.model, provider.id.replace("anthropic-", ""));
  assertEquals(Array.isArray(requestBody.messages), true);
});

Deno.test("AnthropicProvider request body validates against the Messages API schema", async () => {
  const logger = new EventLogger({ prefix: "[Test]" });
  const debugSpy = spy(logger, "debug");
  const provider = new AnthropicProvider({ apiKey: "test-key", logger, model: "claude-sonnet-5" });

  const fetchStub = stubFetchSuccess(anthropicResponseConfig.wrapResponse("ok"));
  try {
    await provider.generate("Fix the bug", { temperature: 0.2, max_tokens: 1024 });
  } finally {
    fetchStub.restore();
  }

  const dumpCall = debugSpy.calls.find((c) => c.args[0] === PROVIDER_EVENT_REQUEST_DEBUG_DUMP);
  assertExists(dumpCall);
  const payload = dumpCall.args[2] as Record<string, JSONValue>;
  assertEquals(payload.valid, true);
  assertEquals(payload.validation_errors, undefined);
});

Deno.test("AnthropicProviderFactory passes options.config through so provider config blocks apply", async () => {
  const baseConfig = createTestConfig();
  const config = {
    ...baseConfig,
    ai_anthropic: { ...baseConfig.ai_anthropic, max_tokens_default: 8192 },
  };
  const logger = new EventLogger({ prefix: "[Test]" });
  const debugSpy = spy(logger, "debug");
  const factory = new AnthropicProviderFactory();
  const provider = await factory.create({
    provider: ProviderType.ANTHROPIC,
    model: "claude-sonnet-5",
    timeoutMs: 60000,
    apiKey: "test-key",
    logger,
    config,
  });

  const fetchStub = stubFetchSuccess(anthropicResponseConfig.wrapResponse("ok"));
  try {
    await provider.generate("hello");
  } finally {
    fetchStub.restore();
  }

  const dumpCall = debugSpy.calls.find((c) => c.args[0] === PROVIDER_EVENT_REQUEST_DEBUG_DUMP);
  assertExists(dumpCall, "factory-created provider must inherit the logger and dump its request");
  const requestBody = (dumpCall.args[2] as Record<string, JSONValue>).request_body as Record<string, JSONValue>;
  assertEquals(
    requestBody.max_tokens,
    8192,
    "factory-created provider must see config.ai_anthropic.max_tokens_default",
  );
});

Deno.test("AnthropicProvider marks the prompt block with cache_control by default", async () => {
  const logger = new EventLogger({ prefix: "[Test]" });
  const debugSpy = spy(logger, "debug");
  const provider = new AnthropicProvider({ apiKey: "test-key", logger });

  const fetchStub = stubFetchSuccess(anthropicResponseConfig.wrapResponse("ok"));
  try {
    await provider.generate("a repeated analysis prompt");
  } finally {
    fetchStub.restore();
  }

  const dumpCall = debugSpy.calls.find((c) => c.args[0] === PROVIDER_EVENT_REQUEST_DEBUG_DUMP);
  assertExists(dumpCall);
  const requestBody = (dumpCall.args[2] as Record<string, JSONValue>).request_body as Record<string, JSONValue>;
  const messages = requestBody.messages as Array<Record<string, JSONValue>>;
  const content = messages[0].content as Array<Record<string, JSONValue>>;
  // Anthropic prompt caching: repeated identical prompts (provider retries, plan-validation
  // retries, multi-trial eval runs) are billed at ~10% of input cost on cache hits.
  assertEquals(Array.isArray(content), true, "content must be block-array form to carry cache_control");
  assertEquals(content[0].cache_control, { type: "ephemeral" });
  assertEquals(content[0].text, "a repeated analysis prompt");
});

Deno.test("AnthropicProviderFactory passes options.timeoutMs through to the provider", async () => {
  const factory = new AnthropicProviderFactory();
  const provider = await factory.create({
    provider: ProviderType.ANTHROPIC,
    model: "claude-sonnet-5",
    timeoutMs: 240000,
    apiKey: "test-key",
  });

  // timeoutMs is resolved by ProviderFactory.resolveOptions from [models.<name>].timeout_ms /
  // env / ai_timeout config — dropping it here silently pins every factory-created provider to
  // the 60s package default, which a thinking model's plan-sized generation routinely exceeds.
  assertEquals((provider as AnthropicProvider).timeoutMs, 240000);
});

Deno.test("AnthropicProvider honours config.ai_anthropic.max_tokens_default in the request body", async () => {
  const baseConfig = createTestConfig();
  const config = {
    ...baseConfig,
    ai_anthropic: { ...baseConfig.ai_anthropic, max_tokens_default: 8192 },
  };
  const logger = new EventLogger({ prefix: "[Test]" });
  const debugSpy = spy(logger, "debug");
  const provider = new AnthropicProvider({ apiKey: "test-key", logger, config });

  const fetchStub = stubFetchSuccess(anthropicResponseConfig.wrapResponse("ok"));
  try {
    await provider.generate("hello");
  } finally {
    fetchStub.restore();
  }

  const dumpCall = debugSpy.calls.find((c) => c.args[0] === PROVIDER_EVENT_REQUEST_DEBUG_DUMP);
  assertExists(dumpCall);
  const requestBody = (dumpCall.args[2] as Record<string, JSONValue>).request_body as Record<string, JSONValue>;
  assertEquals(requestBody.max_tokens, 8192);
});
