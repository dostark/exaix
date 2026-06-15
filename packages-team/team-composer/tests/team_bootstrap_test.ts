/**
 * @module TeamBootstrapTest
 * @path packages-team/team-composer/tests/team_bootstrap_test.ts
 * @description Unit tests for bootstrapTeamProviders — verifies Vertex AI registration, defaults, idempotency.
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { PricingTier, ProviderDefaultsRegistry } from "@exaix/core";
import { ProviderRegistry } from "@exaix/ai";
import {
  PROVIDER_VERTEX,
  VERTEX_DEFAULTS,
  VERTEX_PROVIDER_METADATA,
  VertexProviderFactory,
} from "@exaix-team/ai-vertex";
import { bootstrapTeamProviders } from "../src/team_bootstrap.ts";

describe("bootstrapTeamProviders", () => {
  it("registers Vertex AI in ProviderRegistry", () => {
    ProviderRegistry.clear();
    ProviderDefaultsRegistry.clear();

    bootstrapTeamProviders();

    const supported = ProviderRegistry.getSupportedProviders();
    assertEquals(supported.includes(PROVIDER_VERTEX), true);
    const factory = ProviderRegistry.getFactory(PROVIDER_VERTEX);
    assertExists(factory);
    assertEquals(factory instanceof VertexProviderFactory, true);
  });

  it("registers VERTEX_DEFAULTS in ProviderDefaultsRegistry", () => {
    ProviderRegistry.clear();
    ProviderDefaultsRegistry.clear();

    bootstrapTeamProviders();

    const defaults = ProviderDefaultsRegistry.get(PROVIDER_VERTEX);
    assertExists(defaults);
    assertEquals(defaults.defaultModel, VERTEX_DEFAULTS.defaultModel);
    assertEquals(defaults.defaultEndpoint, VERTEX_DEFAULTS.defaultEndpoint);
  });

  it("is idempotent (second call does not throw)", () => {
    ProviderRegistry.clear();
    ProviderDefaultsRegistry.clear();

    bootstrapTeamProviders();
    bootstrapTeamProviders();

    const supported = ProviderRegistry.getSupportedProviders();
    assertEquals(supported.includes(PROVIDER_VERTEX), true);
  });

  it("handles pre-registered Vertex AI without duplicate registration", () => {
    ProviderRegistry.clear();
    ProviderDefaultsRegistry.clear();

    ProviderRegistry.registerWithMetadata(
      PROVIDER_VERTEX,
      new VertexProviderFactory(),
      {
        name: VERTEX_PROVIDER_METADATA.name,
        description: VERTEX_PROVIDER_METADATA.description,
        capabilities: [...VERTEX_PROVIDER_METADATA.capabilities],
        costTier: VERTEX_PROVIDER_METADATA.costTier,
        pricingTier: PricingTier.MEDIUM,
        strengths: [...VERTEX_PROVIDER_METADATA.strengths],
      },
    );

    bootstrapTeamProviders();

    const supported = ProviderRegistry.getSupportedProviders();
    assertEquals(supported.includes(PROVIDER_VERTEX), true);
    const count = supported.filter((p) => p === PROVIDER_VERTEX).length;
    assertEquals(count, 1);
  });
});
