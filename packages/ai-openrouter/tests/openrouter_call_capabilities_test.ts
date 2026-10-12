/**
 * @module OpenRouterCallCapabilitiesTest
 * @path packages/ai-openrouter/tests/openrouter_call_capabilities_test.ts
 * @description Verifies the per-model call capabilities that the call projection and the ReAct tool_choice read.
 * @architectural-layer AI
 * @dependencies [@exaix/ai, @exaix/schemas]
 * @related-files [packages/ai-openrouter/src/openrouter_call_capabilities.ts, packages/execution/src/strategies/react_loop_strategy.ts]
 */
import { assertEquals } from "@std/assert";
import { EffortTierSchema } from "@exaix/schemas";
import { openrouterCallCapabilities } from "../src/openrouter_call_capabilities.ts";
import { OpenRouterProvider } from "../src/openrouter_provider.ts";

Deno.test("[openrouter capabilities] a qwen/ model refuses the any tool_choice and forced choice with thinking", () => {
  const capabilities = openrouterCallCapabilities("qwen/qwen3.7-flash");
  assertEquals(capabilities.supportsAnyToolChoice, false);
  assertEquals(capabilities.supportsForcedToolChoiceWithThinking, false);
  assertEquals(capabilities.supportsForcedToolChoice, undefined);
});

Deno.test("[openrouter capabilities] other models keep every tool_choice form", () => {
  const capabilities = openrouterCallCapabilities("inclusionai/ling-3.0-flash");
  assertEquals(capabilities.supportsAnyToolChoice, undefined);
  assertEquals(capabilities.supportsForcedToolChoiceWithThinking, undefined);
  assertEquals(capabilities.supportsForcedToolChoice, undefined);
  assertEquals(capabilities.supportsToolChoice, undefined);
});

Deno.test("[openrouter capabilities] thinking and every effort tier keep the call projection unchanged", () => {
  for (const model of ["qwen/qwen3.7-flash", "inclusionai/ling-3.0-flash"]) {
    const capabilities = openrouterCallCapabilities(model);
    assertEquals(capabilities.profile, "openrouter");
    assertEquals(capabilities.supportsThinking, true);
    assertEquals([...capabilities.supportedEffortTiers], [...EffortTierSchema.options]);
  }
});

Deno.test("[openrouter capabilities] the provider exposes the capabilities of its own model", () => {
  const provider = new OpenRouterProvider({ apiKey: "fixture-key", model: "qwen/qwen3.7-flash" });
  assertEquals(provider.callCapabilities?.supportsAnyToolChoice, false);
  assertEquals(provider.callCapabilities?.supportsForcedToolChoiceWithThinking, false);
});
