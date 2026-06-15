/**
 * @module TeamBootstrap
 * @path packages-team/team-composer/src/team_bootstrap.ts
 * @architectural-layer Team
 * @related-files [apps/common/registry_bootstrap.ts, packages-team/team-composer/src/team_composer.ts]
 * @ungrounded
 * @description Team-edition provider bootstrap — registers Team-only providers
 * (Vertex AI) into the global ProviderRegistry. Called once at app startup
 * when EXAIX_EDITION=team.
 */

import { type IProviderMetadata, ProviderRegistry } from "@exaix/ai";
import { PricingTier, ProviderDefaultsRegistry } from "@exaix/core";
import {
  PROVIDER_VERTEX,
  VERTEX_DEFAULTS,
  VERTEX_PROVIDER_METADATA,
  VertexProviderFactory,
} from "@exaix-team/ai-vertex";

export function bootstrapTeamProviders(): void {
  const supported = ProviderRegistry.getSupportedProviders();
  if (!supported.includes(PROVIDER_VERTEX)) {
    const vertexMetadata: IProviderMetadata = {
      name: VERTEX_PROVIDER_METADATA.name,
      description: VERTEX_PROVIDER_METADATA.description,
      capabilities: [...VERTEX_PROVIDER_METADATA.capabilities],
      costTier: VERTEX_PROVIDER_METADATA.costTier,
      pricingTier: PricingTier.MEDIUM,
      strengths: [...VERTEX_PROVIDER_METADATA.strengths],
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_VERTEX,
      new VertexProviderFactory(),
      vertexMetadata,
    );
  }
  if (!supported.includes(PROVIDER_VERTEX)) {
    ProviderDefaultsRegistry.register(PROVIDER_VERTEX, VERTEX_DEFAULTS);
  }
}
