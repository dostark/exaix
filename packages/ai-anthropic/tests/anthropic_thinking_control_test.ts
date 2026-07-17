/**
 * @module AnthropicThinkingControlTest
 * @path packages/ai-anthropic/tests/anthropic_thinking_control_test.ts
 * @related-files [packages/ai-anthropic/src/anthropic_provider.ts]
 * @architectural-layer AI
 * @description Verifies AnthropicProvider honours IModelOptions.thinking: when
 * thinking === false the outbound body carries the Messages API's explicit
 * thinking: { type: "disabled" } (turning off the model's default adaptive
 * thinking, which was observed adding minutes of latency and emitting empty
 * signed thinking blocks); when the flag is absent the body carries no thinking
 * field at all, preserving the API default.
 */

import { assertEquals } from "@std/assert";
import { AnthropicProvider } from "../mod.ts";
import { PROVIDER_EVENT_REQUEST_DEBUG_DUMP } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { spy } from "@std/testing/mock";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { Config } from "@exaix/schemas";
import { anthropicResponseConfig, stubFetchSuccess } from "../../ai/tests/helpers/provider_test_helper.ts";
import { createTestConfig } from "../../ai/tests/helpers/test_config.ts";

async function captureRequestBody(
  options: IModelOptions,
  config?: Config,
): Promise<Record<string, JSONValue>> {
  const logger = new EventLogger({ prefix: "[Test]" });
  const debugSpy = spy(logger, "debug");
  const provider = new AnthropicProvider({ apiKey: "test-key", logger, model: "claude-sonnet-5", config });

  const fetchStub = stubFetchSuccess(anthropicResponseConfig.wrapResponse("ok"));
  try {
    await provider.generate("Fix the bug", options);
  } finally {
    fetchStub.restore();
  }

  const dumpCall = debugSpy.calls.find((c) => c.args[0] === PROVIDER_EVENT_REQUEST_DEBUG_DUMP);
  if (!dumpCall) throw new Error("no request_debug_dump captured");
  const payload = dumpCall.args[2] as Record<string, JSONValue>;
  return payload.request_body as Record<string, JSONValue>;
}

function configWithThinkingDefault(value: boolean): Config {
  const base = createTestConfig();
  return { ...base, ai_anthropic: { ...base.ai_anthropic, thinking_default: value } };
}

Deno.test("AnthropicProvider: thinking === false sends explicit thinking disabled block", async () => {
  const body = await captureRequestBody({ thinking: false });
  assertEquals(
    body.thinking,
    { type: "disabled" },
    "thinking:false must map to the Messages API's explicit disabled block",
  );
});

Deno.test("AnthropicProvider: absent thinking flag sends no thinking field (API default preserved)", async () => {
  const body = await captureRequestBody({ max_tokens: 512 });
  assertEquals(body.thinking, undefined, "no thinking flag must leave the API's default behaviour untouched");
});

Deno.test("AnthropicProvider: ai_anthropic.thinking_default false disables thinking when the call sets none", async () => {
  const body = await captureRequestBody({ max_tokens: 512 }, configWithThinkingDefault(false));
  assertEquals(
    body.thinking,
    { type: "disabled" },
    "config-level thinking_default:false must disable thinking for calls that pass no thinking option",
  );
});

Deno.test("AnthropicProvider: a per-call thinking flag overrides the config default", async () => {
  const body = await captureRequestBody({ thinking: true }, configWithThinkingDefault(false));
  assertEquals(
    body.thinking,
    undefined,
    "an explicit per-call thinking:true must win over config thinking_default:false",
  );
});
