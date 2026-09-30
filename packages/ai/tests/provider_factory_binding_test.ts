/**
 * @module ProviderFactoryBindingTest
 * @path packages/ai/tests/provider_factory_binding_test.ts
 * @description Checks binding-specific provider creation and compatible qualification.
 */

import { assertInstanceOf, assertRejects, assertStringIncludes } from "@std/assert";
import { ProviderFactory } from "@exaix/ai";
import { ConfigSchema, type IResolvedBinding } from "@exaix/schemas";
import { withEnv } from "@exaix/testing";
import { OPENAI_COMPATIBLE_PROFILE_DEFAULTS } from "@exaix/core";

const config = ConfigSchema.parse({ system: {}, paths: {}, ai: { provider: "mock", model: "boot-model" } });
const mockBinding: IResolvedBinding = {
  service: "mock",
  model_provider: "mock",
  model: "mock/bound-model",
  service_model_id: "bound-model",
  transport: "local",
  interface: "api",
  adapter: "mock",
  sources: {},
  fingerprint: "a".repeat(64),
};

Deno.test("binding factory ignores EXA_LLM_PROVIDER and EXA_LLM_MODEL", async () => {
  await withEnv({ EXA_LLM_PROVIDER: "missing-provider", EXA_LLM_MODEL: "wrong-model" }, async () => {
    const provider = await ProviderFactory.createFromBinding(config, mockBinding);
    assertStringIncludes(provider.id, "bound-model");
  });
});

Deno.test("binding factory rejects unsupported compatible profiles and service models", async () => {
  const compatible: IResolvedBinding = {
    ...mockBinding,
    service: "compat-fixture",
    model_provider: "openai",
    model: "openai/compat-fixture-v1",
    service_model_id: "compat-fixture-v1",
    adapter: "openai-chat",
    profile: "local-test",
    endpoint: "http://127.0.0.1:8765/v1/chat/completions",
  };
  await assertRejects(() => ProviderFactory.createFromBinding(config, { ...compatible, profile: "self-hosted" }));
  const endpointError = await assertRejects(() =>
    ProviderFactory.createFromBinding(config, {
      ...compatible,
      profile: "openai",
      service_model_id: OPENAI_COMPATIBLE_PROFILE_DEFAULTS.openai.model,
      endpoint: "https://example.com/v1/chat/completions",
    })
  );
  assertInstanceOf(endpointError, Error);
  assertStringIncludes(endpointError.message, "pinned endpoint");
  await assertRejects(() =>
    ProviderFactory.createFromBinding(config, { ...compatible, allow_insecure_loopback: false })
  );
  await assertRejects(() =>
    ProviderFactory.createFromBinding(config, {
      ...compatible,
      service_model_id: "other-model",
      allow_insecure_loopback: true,
    })
  );
});
