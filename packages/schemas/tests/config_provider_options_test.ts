/**
 * @module ConfigProviderOptionsTest
 * @path packages/schemas/tests/config_provider_options_test.ts
 * @related-files ["packages/schemas/src/config.ts", "packages/core/src/config/config_schema.ts"]
 * @architectural-layer Config
 * @description Phase 80 Step 5 — validates the ai_vertex / ai_openrouter config blocks
 * (defaults, overrides, invalid-URL rejection) and asserts the schemas and core config
 * schema files agree on them (parity guard against drift between the two definitions).
 */

import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";
import { ConfigSchema as CoreConfigSchema } from "@exaix/core/config";
import { ExaPathDefaults, LogLevel } from "@exaix/core";

interface IBaseConfig {
  system: { root: string; log_level: string };
  paths: typeof ExaPathDefaults;
}

function baseConfig(): IBaseConfig {
  return {
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  };
}

Deno.test("[ConfigSchema] applies ai_vertex / ai_openrouter defaults when omitted", () => {
  const result = ConfigSchema.safeParse(baseConfig());
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.ai_vertex.region, "us-central1");
    assertEquals(result.data.ai_vertex.service_account_env, "VERTEX_AI_SERVICE_ACCOUNT");
    assertEquals(result.data.ai_openrouter.site_name, "Exaix");
    assertEquals(result.data.ai_openrouter.api_key_env, "OPENROUTER_API_KEY");
  }
});

Deno.test("[ConfigSchema] accepts explicit ai_vertex / ai_openrouter overrides", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    ai_vertex: { region: "europe-west4", service_account_env: "MY_SA" },
    ai_openrouter: { site_name: "MyApp", site_url: "https://my.app", api_key_env: "OR_KEY" },
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.ai_vertex.region, "europe-west4");
    assertEquals(result.data.ai_openrouter.site_url, "https://my.app");
  }
});

Deno.test("[ConfigSchema] rejects a non-URL ai_openrouter.site_url", () => {
  const result = ConfigSchema.safeParse({ ...baseConfig(), ai_openrouter: { site_url: "not-a-url" } });
  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] schemas and core config files agree on the new provider options (parity)", () => {
  const input = {
    ...baseConfig(),
    ai_vertex: { region: "asia-southeast1", service_account_env: "SA_ENV" },
    ai_openrouter: { site_name: "X", site_url: "https://x.io", api_key_env: "K" },
  };
  const a = ConfigSchema.safeParse(input);
  const b = CoreConfigSchema.safeParse(input);
  assertEquals(a.success, true);
  assertEquals(b.success, true);
  if (a.success && b.success) {
    assertEquals(a.data.ai_vertex, b.data.ai_vertex);
    assertEquals(a.data.ai_openrouter, b.data.ai_openrouter);
  }
});
