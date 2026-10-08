/**
 * @module ConfigFlowNamespacePromptTest
 * @path packages/schemas/tests/config_flow_namespace_prompt_test.ts
 * @description Verifies that `flow.namespace_prompt_max_bytes` survives config parsing and is bounded.
 * @architectural-layer Schemas
 * @dependencies [@exaix/schemas, @std/assert, @std/toml]
 */
import { assertEquals, assertThrows } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { ConfigSchema } from "../src/config.ts";

const BASE = "[system]\nwatcher_timeout_sec = 60\n";

Deno.test("[config] flow.namespace_prompt_max_bytes is kept when set", () => {
  const config = ConfigSchema.parse(parseToml(`${BASE}[flow]\nnamespace_prompt_max_bytes = 2048\n`));
  assertEquals(config.flow?.namespace_prompt_max_bytes, 2048);
  assertEquals(config.flow?.max_gate_evaluations, 10);
});

Deno.test("[config] flow.namespace_prompt_max_bytes outside 1024 to 65536 is rejected", () => {
  for (const value of [1023, 65537, 0, -1]) {
    assertThrows(() => ConfigSchema.parse(parseToml(`${BASE}[flow]\nnamespace_prompt_max_bytes = ${value}\n`)));
  }
});

Deno.test("[config] flow.namespace_prompt_max_bytes is left unset so the registered default applies", () => {
  const config = ConfigSchema.parse(parseToml(`${BASE}[flow]\nmax_gate_evaluations = 4\n`));
  assertEquals(config.flow?.namespace_prompt_max_bytes, undefined);
});
