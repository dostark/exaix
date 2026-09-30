/**
 * @module BindingCatalogTest
 * @path packages/model-registry/tests/binding_catalog_test.ts
 * @description Verifies built-in binding routes derive from registered source facts.
 */

import { assertEquals, assertExists } from "@std/assert";
import { OPENAI_COMPATIBLE_PROFILE_DEFAULTS } from "@exaix/core";
import { getDefaultModels } from "@exaix/schemas";
import { buildBuiltInCatalog, mergeCatalogs } from "@exaix/model-registry";
import { STATIC_OVERLAY } from "@exaix/model-registry";

Deno.test("built-in binding catalog projects static model and qualified compatible routes", () => {
  const catalog = buildBuiltInCatalog();
  for (const key of Object.keys(STATIC_OVERLAY)) {
    const separator = key.indexOf(":");
    const canonical = `${key.slice(0, separator)}/${key.slice(separator + 1)}`;
    assertExists(catalog.models[canonical], canonical);
    if (key.startsWith("anthropic:")) assertExists(catalog.services.anthropic?.serves[canonical]);
  }
  assertEquals(
    catalog.services["openai-chat"].serves["openai/gpt-6-luna"],
    OPENAI_COMPATIBLE_PROFILE_DEFAULTS.openai.model,
  );
  assertEquals(
    catalog.services.deepseek.serves["deepseek/deepseek-v4-pro"],
    OPENAI_COMPATIBLE_PROFILE_DEFAULTS.deepseek.model,
  );
  assertEquals(Object.keys(catalog.services.deepseek.serves), ["deepseek/deepseek-v4-pro"]);
  assertEquals(catalog.services.deepseek.profile, "deepseek");
  assertEquals(catalog.services["openai-chat"].profile, "openai");
  assertEquals(catalog.services.openrouter.serves["*"], "{model}");
  assertEquals(catalog.services.mock.transport, "local");
  assertEquals(catalog.services["claude-cli"].interface, "cli");
  assertExists(catalog.models[`mock/${getDefaultModels().mock}`]);
});

Deno.test("catalog merge overrides one entry without dropping other built-ins", () => {
  const base = buildBuiltInCatalog();
  const merged = mergeCatalogs(base, {
    services: {
      lab: { adapter: "mock", transport: "local", interface: "api", serves: {} },
    },
  });
  assertEquals(merged.services.lab.adapter, "mock");
  assertEquals(merged.services.deepseek.profile, "deepseek");
  assertExists(merged.models["openai/gpt-6-luna"]);
});

Deno.test("catalog omits a provider default that no package registered", () => {
  const catalog = buildBuiltInCatalog();
  assertEquals(catalog.models["google/google-model"], undefined);
});

Deno.test("operator catalog cannot assert unverified model capabilities", () => {
  const base = buildBuiltInCatalog();
  const merged = mergeCatalogs(base, {
    models: { "mock/unverified": { model_provider: "mock", capabilities: ["thinking"] } },
  });
  assertEquals(merged.models["mock/unverified"].capabilities, undefined);
});

Deno.test("each model provider prefers its same-named service then openrouter", () => {
  const catalog = buildBuiltInCatalog();
  for (const [provider, path] of Object.entries(catalog.preferences)) {
    assertExists(path, provider);
    assertEquals(path.at(-1), "openrouter");
    if (catalog.services[provider]) assertEquals(path[0], provider);
    for (const candidate of path.slice(0, -1)) {
      assertExists(catalog.services[candidate], `${provider} prefers ${candidate}`);
    }
  }
});

Deno.test("a config catalog service entry adds a service and overrides a built-in by name", () => {
  const base = buildBuiltInCatalog();
  const merged = mergeCatalogs(base, {
    services: {
      "openai-chat": {
        adapter: "openai-chat",
        profile: "openai",
        endpoint: "https://operator.example/v1",
        transport: "cloud",
        interface: "api",
        serves: { "openai/gpt-6-luna": "gpt-6-luna" },
      },
      "operator-lab": {
        adapter: "mock",
        transport: "local",
        interface: "api",
        serves: { "mock/alpha": "alpha" },
      },
    },
  });
  assertEquals(merged.services["openai-chat"].endpoint, "https://operator.example/v1");
  assertExists(merged.services["operator-lab"]);
  assertExists(merged.services.deepseek);
});
