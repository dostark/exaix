/**
 * @module ConfigProviderOptionsTest
 * @path packages/schemas/tests/config_provider_options_test.ts
 * @related-files ["packages/schemas/src/config.ts"]
 * @architectural-layer Config
 * @description Phase 80 Step 5 — validates the ai_vertex / ai_openrouter config blocks
 * (defaults, overrides, invalid-URL rejection). The former core/schemas parity guard
 * is obsolete: @exaix/schemas/config.ts is the single ConfigSchema definition.
 */

import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";
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

Deno.test("[ConfigSchema] accepts the combined ai_vertex / ai_openrouter override shape", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    ai_vertex: { region: "asia-southeast1", service_account_env: "SA_ENV" },
    ai_openrouter: { site_name: "X", site_url: "https://x.io", api_key_env: "K" },
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.ai_vertex.region, "asia-southeast1");
    assertEquals(result.data.ai_openrouter.api_key_env, "K");
  }
});

Deno.test("[ConfigSchema] ai_openrouter.routing accepts valid routing block", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    ai_openrouter: {
      routing: {
        models: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
        provider: {
          order: ["openai", "anthropic"],
          sort: "cost",
        },
        zdr: true,
        data_collection: "deny",
      },
    },
  });
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.ai_openrouter.routing?.models?.length, 2);
  assertEquals(result.data.ai_openrouter.routing?.zdr, true);
  assertEquals(result.data.ai_openrouter.routing?.data_collection, "deny");
});

Deno.test("[ConfigSchema] ai_openrouter.routing rejects >3 models", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    ai_openrouter: {
      routing: {
        models: ["a/a", "b/b", "c/c", "d/d"],
      },
    },
  });
  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] ai_openrouter.routing accepts provider.max_price", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    ai_openrouter: {
      routing: {
        provider: {
          max_price: { completion: 0.01, request: 0.002 },
        },
      },
    },
  });
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.ai_openrouter.routing?.provider?.max_price?.completion, 0.01);
});

Deno.test("[ConfigSchema] ai_openrouter.routing rejects negative max_price", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    ai_openrouter: {
      routing: {
        provider: {
          max_price: { completion: -0.01 },
        },
      },
    },
  });
  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] ai_openrouter.routing rejects invalid data_collection", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    ai_openrouter: {
      routing: {
        data_collection: "maybe",
      },
    },
  });
  assertEquals(result.success, false);
});
