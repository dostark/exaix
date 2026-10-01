/**
 * @module BindingValidationTest
 * @path packages/ai/tests/bindings/binding_validation_test.ts
 * @description Step-6 coverage for the binding validation module: every code in the
 *   validation table except the Step-7 host/lock checks (capability_missing for native
 *   tools/effort/thinking, interface_unsupported, key_missing, optin_missing,
 *   endpoint_invalid, local_host_not_private, pricing_unavailable), plus the security
 *   endpoint cases and the adapter/profile/local-test/openrouter failure cases.
 * @architectural-layer AI
 * @related-files [packages/ai/src/bindings/binding_validation.ts, packages/ai/src/bindings/binding_resolver.ts]
 */

import { assertEquals } from "@std/assert";
import type { IBindingStepRef, IResolvedBinding } from "@exaix/schemas";
import type { PricingProvenance } from "@exaix/core/types";
import { adapterKeyId, validateBinding } from "@exaix/ai/bindings/binding_validation.ts";
import { OPENAI_COMPATIBLE_PROFILE_DEFAULTS } from "@exaix/core";

const ref: IBindingStepRef = {
  flowId: "research",
  stepId: "compose",
  agentRole: "composer",
  kind: "agent",
  nativeTools: false,
};

function binding(overrides: Partial<IResolvedBinding> = {}): IResolvedBinding {
  return {
    service: "alpha",
    model_provider: "mock",
    model: "mock/alpha",
    service_model_id: "alpha",
    transport: "cloud",
    interface: "api",
    adapter: "mock",
    sources: {},
    fingerprint: "0".repeat(64),
    ...overrides,
  };
}

function codes(
  b: Partial<IResolvedBinding>,
  ctx?: Partial<Parameters<typeof validateBinding>[1]>,
): Promise<string[]> {
  return validateBinding(ref, {
    binding: binding(b),
    probe: { hasKey: () => true, hasOptIn: () => true },
    adapterKeyEnv: {},
    ...ctx,
  }).then((issues) => issues.map((issue) => issue.code));
}

Deno.test("[validation] capability_missing for native tools when the model or adapter lacks it", async () => {
  const b = binding({});
  // nativeTools requested on the ref, catalog model lacks the capability.
  const nativeRef = { ...ref, nativeTools: true };
  const result = await validateBinding(nativeRef, {
    binding: b,
    catalogModel: { model_provider: "mock" },
    probe: { hasKey: () => true, hasOptIn: () => true },
    adapterKeyEnv: {},
    getAdapterMetadata: () => ({
      name: "mock",
      description: "",
      capabilities: [],
      costTier: 0 as never,
      pricingTier: 0 as never,
      strengths: [],
      supportsNativeTools: false,
    }),
  });
  assertEquals(result.map((issue) => issue.code).includes("capability_missing"), true);
});

Deno.test("[validation] capability_missing for effort and thinking", async () => {
  const effort = await codes(binding({ effort: "high" }), {
    catalogModel: { model_provider: "mock" },
    getAdapterMetadata: () => ({
      name: "mock",
      description: "",
      capabilities: [],
      costTier: 0 as never,
      pricingTier: 0 as never,
      strengths: [],
      supportsEffort: false,
    }),
  });
  assertEquals(effort.includes("capability_missing"), true);

  const thinking = await codes(binding({ thinking: true }), {
    catalogModel: { model_provider: "mock" },
    getAdapterMetadata: () => ({
      name: "mock",
      description: "",
      capabilities: [],
      costTier: 0 as never,
      pricingTier: 0 as never,
      strengths: [],
      supportsThinking: false,
    }),
  });
  assertEquals(thinking.includes("capability_missing"), true);
});

Deno.test("[validation] interface_unsupported when a non-cli-delegate step gets a cli interface", async () => {
  const result = await validateBinding({ ...ref, strategy: "react" }, {
    binding: binding({ interface: "cli" }),
    probe: { hasKey: () => true, hasOptIn: () => true },
    adapterKeyEnv: {},
  });
  assertEquals(result.map((issue) => issue.code).includes("interface_unsupported"), true);
});

Deno.test("[validation] key_missing when the credential is absent, and when the variable name is wrong", async () => {
  const absent = await validateBinding(ref, {
    binding: binding({ service: "svc" }),
    probe: { hasKey: () => false, hasOptIn: () => true },
    service: { adapter: "mock", transport: "cloud", interface: "api", serves: {}, key_env: "KEY_ONE" },
    adapterKeyEnv: {},
  });
  assertEquals(absent.map((issue) => issue.code).includes("key_missing"), true);

  // key_env differs from the adapter's fixed key variable.
  const wrong = await validateBinding(ref, {
    binding: binding({ service: "svc" }),
    probe: { hasKey: () => true, hasOptIn: () => true },
    service: { adapter: "mock", transport: "cloud", interface: "api", serves: {}, key_env: "WRONG_KEY" },
    adapterKeyEnv: { [adapterKeyId("mock", undefined)]: "MOCK_API_KEY" },
  });
  assertEquals(wrong.map((issue) => issue.code).includes("key_missing"), true);
});

Deno.test("[validation] optin_missing when the opt-in variable is unset", async () => {
  const result = await validateBinding(ref, {
    binding: binding({ service: "svc" }),
    probe: { hasKey: () => true, hasOptIn: () => false },
    service: { adapter: "mock", transport: "cloud", interface: "api", serves: {}, requires_optin: "SOME_FEATURE" },
    adapterKeyEnv: {},
  });
  assertEquals(result.map((issue) => issue.code).includes("optin_missing"), true);
});

Deno.test("[validation][security] endpoint_invalid for plain HTTP to a public host, userinfo, query and fragment", async () => {
  const endpointCases = [
    "http://example.com/v1",
    "https://user:pass@example.com/v1",
    "https://example.com/v1?key=1",
    "https://example.com/v1#frag",
  ];
  for (const endpoint of endpointCases) {
    const result = await codes(binding({ endpoint }), {
      service: { adapter: "mock", transport: "cloud", interface: "api", serves: {}, endpoint },
    });
    assertEquals(result.includes("endpoint_invalid"), true, `endpoint ${endpoint} must be invalid`);
  }
});

Deno.test("[validation][security] local_host_not_private for a local service on a public host", async () => {
  const result = await codes(binding({ transport: "local", endpoint: "https://public.example.com/v1" }), {
    service: {
      adapter: "mock",
      transport: "local",
      interface: "api",
      serves: {},
      endpoint: "https://public.example.com/v1",
    },
  });
  assertEquals(result.includes("local_host_not_private"), true);
  // A loopback host is allowed.
  const loopback = await codes(binding({ transport: "local", endpoint: "http://127.0.0.1:8080/v1" }), {
    service: {
      adapter: "mock",
      transport: "local",
      interface: "api",
      serves: {},
      endpoint: "http://127.0.0.1:8080/v1",
    },
  });
  assertEquals(loopback.includes("local_host_not_private"), false);
});

Deno.test("[validation] pricing_unavailable when cloud pricing provenance is unknown under a finite cap", async () => {
  const result = await codes(binding({ transport: "cloud" }), {
    maxCostPerDay: 10,
    service: { adapter: "openrouter", transport: "cloud", interface: "api", serves: {} },
    modelRegistry: {
      getModelPricing: () =>
        Promise.resolve({ provider: "openrouter", model: "x", provenance: "unknown" as PricingProvenance }),
    } as never,
  });
  assertEquals(result.includes("pricing_unavailable"), true);
});

Deno.test("[validation] no pricing guard when the cap is unlimited", async () => {
  const result = await codes(binding({ transport: "cloud" }), {
    service: { adapter: "openrouter", transport: "cloud", interface: "api", serves: {} },
    modelRegistry: {
      getModelPricing: () =>
        Promise.resolve({ provider: "openrouter", model: "x", provenance: "unknown" as PricingProvenance }),
    } as never,
  });
  assertEquals(result.includes("pricing_unavailable"), false);
});

Deno.test("[validation] an unsupported compatible profile and local-test without loopback opt-in fail", async () => {
  const unsupported = await codes(binding({ adapter: "openai-chat", profile: "not-a-profile" }), {
    service: { adapter: "openai-chat", profile: "not-a-profile", transport: "cloud", interface: "api", serves: {} },
  });
  assertEquals(unsupported.includes("interface_unsupported"), true);

  const localTestNoOptIn = await codes(
    binding({ adapter: "openai-chat", profile: "local-test", endpoint: "http://127.0.0.1:8000/v1" }),
    {
      service: {
        adapter: "openai-chat",
        profile: "local-test",
        transport: "local",
        interface: "api",
        serves: {},
        endpoint: "http://127.0.0.1:8000/v1",
      },
    },
  );
  assertEquals(localTestNoOptIn.includes("interface_unsupported"), true);
});

Deno.test("[validation] a known compatible profile passes its adapter check", async () => {
  const known = await codes(
    binding({ adapter: "openai-chat", profile: "deepseek", model: "deepseek/deepseek-v4-pro" }),
    {
      service: { adapter: "openai-chat", profile: "deepseek", transport: "cloud", interface: "api", serves: {} },
    },
  );
  assertEquals(known.includes("interface_unsupported"), false);
  assertEquals(typeof OPENAI_COMPATIBLE_PROFILE_DEFAULTS.deepseek, "object");
});

Deno.test("[validation] a host outside an explicit allow_net is host_not_allowed", async () => {
  const result = await codes(binding({ endpoint: "https://unlisted.example.com/v1" }), {
    service: {
      adapter: "mock",
      transport: "cloud",
      interface: "api",
      serves: {},
      endpoint: "https://unlisted.example.com/v1",
    },
    allowNet: ["allowed.example.com", "allowed.example.net:8443"],
  });
  assertEquals(result.includes("host_not_allowed"), true);
  // A grant entry matching the endpoint host (any port) passes.
  const ok = await codes(binding({ endpoint: "https://allowed.example.com/v1" }), {
    service: {
      adapter: "mock",
      transport: "cloud",
      interface: "api",
      serves: {},
      endpoint: "https://allowed.example.com/v1",
    },
    allowNet: ["allowed.example.com"],
  });
  assertEquals(ok.includes("host_not_allowed"), false);
});

Deno.test("[validation] a new host outside the start grant is needs_restart when allow_net is unset", async () => {
  const result = await codes(binding({ endpoint: "https://newhost.example.com/v1" }), {
    service: {
      adapter: "mock",
      transport: "cloud",
      interface: "api",
      serves: {},
      endpoint: "https://newhost.example.com/v1",
    },
    startNetGrant: ["known.example.com"],
  });
  assertEquals(result.includes("needs_restart"), true);
  // A host inside the start grant passes without restart.
  const ok = await codes(binding({ endpoint: "https://known.example.com/v1" }), {
    service: {
      adapter: "mock",
      transport: "cloud",
      interface: "api",
      serves: {},
      endpoint: "https://known.example.com/v1",
    },
    startNetGrant: ["known.example.com"],
  });
  assertEquals(ok.includes("needs_restart"), false);
});

const nativeAdapter = (supportsNativeTools: boolean) => () => ({
  name: "mock",
  description: "",
  capabilities: [],
  costTier: 0 as never,
  pricingTier: 0 as never,
  strengths: [],
  supportsNativeTools,
});

Deno.test("[validation] native tools: unknown model capabilities pass, a declared set without native_tools fails", async () => {
  const nativeRef = { ...ref, nativeTools: true };
  const base = { binding: binding({}), probe: { hasKey: () => true, hasOptIn: () => true }, adapterKeyEnv: {} };
  const unknown = await validateBinding(nativeRef, {
    ...base,
    catalogModel: { model_provider: "mock" },
    getAdapterMetadata: nativeAdapter(true),
  });
  assertEquals(unknown.map((issue) => issue.code), []);
  const declared = await validateBinding(nativeRef, {
    ...base,
    catalogModel: { model_provider: "mock", capabilities: ["thinking"] },
    getAdapterMetadata: nativeAdapter(true),
  });
  assertEquals(declared.map((issue) => issue.code), ["capability_missing"]);
  const supported = await validateBinding(nativeRef, {
    ...base,
    catalogModel: { model_provider: "mock", capabilities: ["native_tools"] },
    getAdapterMetadata: nativeAdapter(true),
  });
  assertEquals(supported.map((issue) => issue.code), []);
});
