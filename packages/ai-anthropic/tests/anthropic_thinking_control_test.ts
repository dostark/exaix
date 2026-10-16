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

import { assertArrayIncludes, assertEquals, assertFalse } from "@std/assert";
import { AnthropicProvider } from "../mod.ts";
import { PROVIDER_EVENT_REQUEST_DEBUG_DUMP, PROVIDER_EVENT_THINKING_NOT_DISABLED } from "@exaix/core";
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
  model = "claude-sonnet-5",
): Promise<Record<string, JSONValue>> {
  const logger = new EventLogger({ prefix: "[Test]" });
  const debugSpy = spy(logger, "debug");
  const provider = new AnthropicProvider({ apiKey: "test-key", logger, model, config });

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

const HAIKU_5_5 = "claude-haiku-5-5";
const SONNET_5_5 = "claude-sonnet-5-5";
const OPUS_5_5 = "claude-opus-5-5";
const HAIKU_4_5 = "claude-haiku-4-5-20251001";

Deno.test("AnthropicProvider: effort is sent as output_config.effort on a model that accepts it", async () => {
  const body = await captureRequestBody({ effort: "medium" }, undefined, HAIKU_5_5);
  assertEquals(body.output_config, { effort: "medium" });
});

Deno.test("AnthropicProvider: effort is not sent to Haiku 4.5, which rejects it with 400", async () => {
  const body = await captureRequestBody({ effort: "high" }, undefined, HAIKU_4_5);
  assertEquals("output_config" in body, false);
});

Deno.test("AnthropicProvider: an unset effort sends no output_config, keeping the model default", async () => {
  const body = await captureRequestBody({}, undefined, HAIKU_5_5);
  assertEquals("output_config" in body, false);
});

Deno.test("AnthropicProvider: thinking true on an adaptive model sends an explicit adaptive block", async () => {
  const body = await captureRequestBody({ thinking: true }, undefined, HAIKU_5_5);
  assertEquals(body.thinking, { type: "adaptive" });
});

Deno.test("AnthropicProvider: thinking true on Opus 5.5 sends an explicit adaptive block", async () => {
  const body = await captureRequestBody({ thinking: true }, undefined, OPUS_5_5);
  assertEquals(body.thinking, { type: "adaptive" });
});

Deno.test("AnthropicProvider: thinking true on Haiku 4.5 sends a manual budget and keeps max_tokens above it", async () => {
  const body = await captureRequestBody(
    { thinking: true, thinking_budget: 2048, max_tokens: 1024 },
    undefined,
    HAIKU_4_5,
  );
  assertEquals(body.thinking, { type: "enabled", budget_tokens: 2048 });
  assertEquals((body.max_tokens as number) > 2048, true);
});

Deno.test("AnthropicProvider: thinking false on Sonnet 5.5 sends between_tools, because disabled is rejected", async () => {
  const body = await captureRequestBody({ thinking: false }, undefined, SONNET_5_5);
  assertEquals(body.thinking, { type: "between_tools" });
});

Deno.test("AnthropicProvider: thinking false on Opus 5.5 sends adaptive, because the model cannot turn thinking off", async () => {
  const body = await captureRequestBody({ thinking: false }, undefined, OPUS_5_5);
  assertEquals(body.thinking, { type: "adaptive" });
});

Deno.test("AnthropicProvider: every documented effort level is sent on Haiku 5.5, Sonnet 5.5 and Opus 5.5", async () => {
  for (const model of [HAIKU_5_5, SONNET_5_5, OPUS_5_5]) {
    for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
      const body = await captureRequestBody({ effort }, undefined, model);
      assertEquals(body.output_config, { effort }, `${model} at ${effort}`);
    }
  }
});

Deno.test("AnthropicProvider: thinking false at xhigh on Haiku 5.5 sends adaptive, because disabled is refused there", async () => {
  const body = await captureRequestBody({ thinking: false, effort: "xhigh" }, undefined, HAIKU_5_5);
  assertEquals(body.thinking, { type: "adaptive" });
  assertEquals(body.output_config, { effort: "xhigh" });
});

Deno.test("AnthropicProvider: thinking false at max on Sonnet 5.5 sends adaptive, because between_tools is refused there", async () => {
  const body = await captureRequestBody({ thinking: false, effort: "max" }, undefined, SONNET_5_5);
  assertEquals(body.thinking, { type: "adaptive" });
});

Deno.test("AnthropicProvider: thinking false at high on Haiku 5.5 keeps the disabled block, which is allowed there", async () => {
  const body = await captureRequestBody({ thinking: false, effort: "high" }, undefined, HAIKU_5_5);
  assertEquals(body.thinking, { type: "disabled" });
});

async function captureWarningEvents(options: IModelOptions, model: string): Promise<string[]> {
  const logger = new EventLogger({ prefix: "[Test]" });
  const warnSpy = spy(logger, "warn");
  const provider = new AnthropicProvider({ apiKey: "test-key", logger, model });
  const fetchStub = stubFetchSuccess(anthropicResponseConfig.wrapResponse("ok"));
  try {
    await provider.generate("Fix the bug", options);
  } finally {
    fetchStub.restore();
  }
  return warnSpy.calls.map((c) => String(c.args[0]));
}

Deno.test("AnthropicProvider: a thinking-off request that cannot be honoured journals provider.thinking_not_disabled", async () => {
  const events = await captureWarningEvents({ thinking: false, effort: "xhigh" }, HAIKU_5_5);
  assertArrayIncludes(events, [PROVIDER_EVENT_THINKING_NOT_DISABLED]);
});

Deno.test("AnthropicProvider: a thinking-off request that is honoured journals no warning", async () => {
  const events = await captureWarningEvents({ thinking: false, effort: "high" }, HAIKU_5_5);
  assertFalse(events.includes(PROVIDER_EVENT_THINKING_NOT_DISABLED));
});

Deno.test("AnthropicProvider: thinking false on Haiku 5.5 keeps the explicit disabled block", async () => {
  const body = await captureRequestBody({ thinking: false }, undefined, HAIKU_5_5);
  assertEquals(body.thinking, { type: "disabled" });
});

Deno.test("AnthropicProvider: a model outside the rules table keeps the previous thinking mapping", async () => {
  const body = await captureRequestBody({ thinking: true, effort: "high" }, undefined, "claude-sonnet-5");
  assertEquals("thinking" in body, false);
  assertEquals("output_config" in body, false);
});
