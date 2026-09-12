/**
 * @module Phase176DogfoodContextConfigTest
 * @path packages/schemas/tests/phase176_dogfood_context_config_test.ts
 * @description Phase 176 Step 1: the dogfood.context config block defaults to disabled,
 * an absent block parses with all documented defaults (old-config compatibility), an
 * explicit enabled: true override round-trips, and cross-field limits (reserve < input
 * cap, portal+memory tokens <= input cap) are enforced.
 * @architectural-layer Config
 * @related-files [packages/schemas/src/config.ts]
 */

import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";
import { ExaPathDefaults, LogLevel } from "@exaix/core";
import * as DEFAULTS from "@exaix/core";

function baseConfig() {
  return {
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  };
}

Deno.test("[ConfigSchema] dogfood.context defaults to disabled when the block is absent (old-config compatibility)", () => {
  const result = ConfigSchema.safeParse(baseConfig());
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.dogfood!.context.enabled, false);
});

Deno.test("[ConfigSchema] dogfood.context parses with all documented defaults when the block is absent", () => {
  const result = ConfigSchema.safeParse(baseConfig());
  assertEquals(result.success, true);
  if (!result.success) return;
  const ctx = result.data.dogfood!.context;
  assertEquals(ctx.portal_alias, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_PORTAL_ALIAS);
  assertEquals(ctx.portal_top_k, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_PORTAL_TOP_K);
  assertEquals(ctx.memory_top_k, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_MEMORY_TOP_K);
  assertEquals(ctx.portal_tokens, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_PORTAL_TOKENS);
  assertEquals(ctx.memory_tokens, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_MEMORY_TOKENS);
  assertEquals(ctx.max_input_tokens, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_MAX_INPUT_TOKENS);
  assertEquals(ctx.output_reserve_tokens, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_OUTPUT_RESERVE_TOKENS);
  assertEquals(ctx.query_chars, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_QUERY_CHARS);
  assertEquals(ctx.query_timeout_ms, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_QUERY_TIMEOUT_MS);
  assertEquals(ctx.max_query_calls, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_MAX_QUERY_CALLS);
  assertEquals(ctx.max_query_tokens, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_MAX_QUERY_TOKENS);
  assertEquals(ctx.max_response_bytes, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_MAX_RESPONSE_BYTES);
  assertEquals(ctx.max_request_bytes, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_MAX_REQUEST_BYTES);
  assertEquals(ctx.max_record_bytes, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_MAX_RECORD_BYTES);
  assertEquals(ctx.max_records_per_trace, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_MAX_RECORDS_PER_TRACE);
  assertEquals(ctx.retention_days, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_RETENTION_DAYS);
  assertEquals(ctx.trusted_agent_roles, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_TRUSTED_AGENT_ROLES);
});

Deno.test("[ConfigSchema] dogfood.context.trusted_agent_roles accepts an explicit override", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    dogfood: { context: { trusted_agent_roles: ["custom-role"] } },
  });
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.dogfood!.context.trusted_agent_roles, ["custom-role"]);
});

Deno.test("[ConfigSchema] dogfood.context.trusted_agent_roles rejects an empty-string entry", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    dogfood: { context: { trusted_agent_roles: [""] } },
  });
  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] dogfood.context.enabled: true overrides the disabled default", () => {
  const result = ConfigSchema.safeParse({ ...baseConfig(), dogfood: { context: { enabled: true } } });
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.dogfood!.context.enabled, true);
  // Every other field still falls back to its documented default.
  assertEquals(result.data.dogfood!.context.portal_top_k, DEFAULTS.DEFAULT_DOGFOOD_CONTEXT_PORTAL_TOP_K);
});

Deno.test("[ConfigSchema] dogfood.context accepts an explicit valid override", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    dogfood: { context: { enabled: true, portal_top_k: 3, memory_tokens: 0 } },
  });
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.dogfood!.context.portal_top_k, 3);
  assertEquals(result.data.dogfood!.context.memory_tokens, 0, "zero must be accepted — it disables the section");
});

Deno.test("[ConfigSchema] dogfood.context.portal_top_k rejects a value above 20", () => {
  const result = ConfigSchema.safeParse({ ...baseConfig(), dogfood: { context: { portal_top_k: 21 } } });
  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] dogfood.context.portal_top_k rejects zero (minimum is 1)", () => {
  const result = ConfigSchema.safeParse({ ...baseConfig(), dogfood: { context: { portal_top_k: 0 } } });
  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] dogfood.context.query_chars rejects a value above the 16384-char ceiling", () => {
  const result = ConfigSchema.safeParse({ ...baseConfig(), dogfood: { context: { query_chars: 16_385 } } });
  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] dogfood.context.query_timeout_ms rejects a value above the 30000ms ceiling", () => {
  const result = ConfigSchema.safeParse({ ...baseConfig(), dogfood: { context: { query_timeout_ms: 30_001 } } });
  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] dogfood.context.retention_days rejects a value above 30", () => {
  const result = ConfigSchema.safeParse({ ...baseConfig(), dogfood: { context: { retention_days: 31 } } });
  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] dogfood.context rejects output_reserve_tokens >= max_input_tokens (cross-field limit)", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    dogfood: { context: { max_input_tokens: 1000, output_reserve_tokens: 1000 } },
  });
  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] dogfood.context rejects portal_tokens + memory_tokens exceeding max_input_tokens (cross-field limit)", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    dogfood: { context: { max_input_tokens: 1000, portal_tokens: 600, memory_tokens: 600 } },
  });
  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] dogfood.context accepts portal_tokens + memory_tokens exactly equal to max_input_tokens", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    dogfood: { context: { max_input_tokens: 1000, portal_tokens: 500, memory_tokens: 500, output_reserve_tokens: 0 } },
  });
  assertEquals(result.success, true);
});
