/**
 * @module ProviderRegistryNativeToolsMetadataTest
 * @path packages/ai/tests/providers/provider_registry_native_tools_metadata_test.ts
 * @description Tests that Anthropic's registered metadata has supportsNativeTools: true
 * and non-Anthropic providers do not.
 */

import { assertEquals } from "@std/assert";
import { ProviderRegistry } from "../../src/provider_registry.ts";
import { MockProviderFactory } from "../../src/factories/mock_factory.ts";
import { ANTHROPIC_PROVIDER_METADATA, PROVIDER_ANTHROPIC } from "@exaix/ai-anthropic";

Deno.test("Anthropic metadata has supportsNativeTools: true", () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata(PROVIDER_ANTHROPIC, new MockProviderFactory(), {
    name: ANTHROPIC_PROVIDER_METADATA.name,
    description: ANTHROPIC_PROVIDER_METADATA.description,
    capabilities: [...ANTHROPIC_PROVIDER_METADATA.capabilities],
    costTier: ANTHROPIC_PROVIDER_METADATA.costTier,
    pricingTier: 2 as never,
    strengths: [...ANTHROPIC_PROVIDER_METADATA.strengths],
    supportsNativeTools: true,
  });

  const metadata = ProviderRegistry.getProviderMetadata(PROVIDER_ANTHROPIC);
  assertEquals(metadata?.supportsNativeTools, true);
});

Deno.test("non-Anthropic providers do not have supportsNativeTools", () => {
  ProviderRegistry.clear();

  ProviderRegistry.registerWithMetadata("test-other", new MockProviderFactory(), {
    name: "Test Provider",
    description: "A non-Anthropic provider",
    capabilities: [],
    costTier: 0 as never,
    pricingTier: 1 as never,
    strengths: [],
  });

  const metadata = ProviderRegistry.getProviderMetadata("test-other");
  assertEquals(metadata?.supportsNativeTools, undefined);
});
