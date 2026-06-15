/**
 * @module TeamBootstrap
 * @path packages-team/team-composer/src/team_bootstrap.ts
 * @architectural-layer Team
 * @related-files [apps/common/registry_bootstrap.ts, packages-team/team-composer/src/team_composer.ts]
 * @description Team-edition provider bootstrap — registers Team-only providers
 * (Vertex AI) into the global ProviderRegistry. Called once at app startup
 * when EXAIX_EDITION=team.
 *
 * Vertex AI import from @exaix-team/ai-vertex will be added in Step 3 when
 * the ai-vertex package is relocated to packages-team/.
 */

export function bootstrapTeamProviders(): void {
  // Step 3 (Move ai-vertex to packages-team) will add:
  //   import { PROVIDER_VERTEX, VERTEX_DEFAULTS, VERTEX_PROVIDER_METADATA, VertexProviderFactory } from "@exaix-team/ai-vertex";
  // and register the Vertex AI provider here.
}
