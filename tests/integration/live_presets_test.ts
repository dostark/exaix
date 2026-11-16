/**
 * @module LivePresetsTest
 * @path tests/integration/live_presets_test.ts
 * @description Proves that an in-process live test is configured and gated by the cell preset of configs/model_presets.toml that names its service: the preset gives the binding, the catalog entries and the requires_key and requires_optin predicates, and the shared cell evaluator skips with a named reason.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing]
 * @related-files [tests/helpers/live_presets.ts, tests/scenario_framework/runner/cell_catalog.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { liveCatalogOverlay, livePresetName, liveSkipReason, liveSpecOf } from "./../helpers/live_presets.ts";

const PAID_OPT_IN = "EXA_TEST_ENABLE_PAID_LLM";
const OLLAMA_OPT_IN = "EXA_MATRIX_OLLAMA";
const DEEPSEEK_KEY = "DEEPSEEK_API_KEY";

Deno.test("[live_presets] a service maps to the live preset row that names it", () => {
  assertEquals(livePresetName("deepseek"), "live-deepseek");
  assertEquals(livePresetName("ollama-chat"), "live-ollama-chat");
});

Deno.test("[live_presets] the binding of a service comes from its preset row", () => {
  assertEquals(liveSpecOf("deepseek"), { service: "deepseek", service_model_id: "deepseek-v4-pro" });
  assertEquals(liveSpecOf("opencode-go"), { service: "opencode-go", service_model_id: "deepseek-v4.1-flash" });
});

Deno.test("[live_presets] a billable service needs its opt-in and its key, and each gap has a named reason", async () => {
  await withEnv({ [PAID_OPT_IN]: null, [DEEPSEEK_KEY]: "key" }, () => {
    assertStringIncludes(liveSkipReason("deepseek") ?? "", PAID_OPT_IN);
  });
  await withEnv({ [PAID_OPT_IN]: "1", [DEEPSEEK_KEY]: null }, () => {
    assertStringIncludes(liveSkipReason("deepseek") ?? "", DEEPSEEK_KEY);
  });
  await withEnv({ [PAID_OPT_IN]: "1", [DEEPSEEK_KEY]: "key" }, () => {
    assertEquals(liveSkipReason("deepseek"), null);
  });
});

Deno.test("[live_presets] a local service needs only its own EXA_MATRIX opt-in", async () => {
  await withEnv({ [OLLAMA_OPT_IN]: null, [PAID_OPT_IN]: "1" }, () => {
    assertStringIncludes(liveSkipReason("ollama-chat") ?? "", OLLAMA_OPT_IN);
  });
  await withEnv({ [OLLAMA_OPT_IN]: "1", [PAID_OPT_IN]: null }, () => {
    assertEquals(liveSkipReason("ollama-chat"), null);
  });
});

Deno.test("[live_presets] the OpenCode Go service reaches the catalog from its preset, with its endpoint and key variable", () => {
  const service = liveCatalogOverlay().services?.["opencode-go"];
  assertEquals(service?.endpoint, "https://opencode.ai/inference/go/openai/v1/chat/completions");
  assertEquals(service?.key_env, "OPENCODE_API_KEY");
  assertEquals(service?.profile, "self-hosted");
  assertEquals(service?.headers, { "x-opencode-session": "{session_id}", "user-agent": "exaix-live-tests/1.0" });
});

Deno.test("[live_presets] a service without a live preset fails closed with the row to add", () => {
  assertThrows(() => liveSkipReason("no-such-service"), Error, "[tool.live-no-such-service]");
});
