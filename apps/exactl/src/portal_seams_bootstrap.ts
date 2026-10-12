/**
 * @module PortalSeamsBootstrap
 * @path apps/exactl/src/portal_seams_bootstrap.ts
 * @description Fills the paid-edition capability seams that `exactl portal
 * analyze` needs (Phase 178 Step 2). Before this, the CLI registered no
 * capability module, so the extended-language symbol extractors were absent
 * from every CLI analysis run.
 * @architectural-layer Application
 * @related-files [apps/exactl/src/init.ts, apps/daemon/src/bootstrap_team.ts]
 */

import { EDITION_ENTERPRISE, EDITION_TEAM } from "@exaix/core";
import { SoloComposer } from "@exaix/core/composer";
import type { ISeamRegistryPlaceholder } from "@exaix/core/composer";
import type { TeamComposer } from "@exaix-team/team-composer";
import type { ISymbolExtractorRegistry, ISymbolReferenceExtractorRegistry } from "@exaix/portal/knowledge";

/** The subset of a composer this helper needs. */
interface IPortalSeamComposer {
  registerCapabilityModule(module: {
    registerSymbolExtractors?(registry: ISeamRegistryPlaceholder): void;
    registerSymbolReferenceExtractors?(registry: ISeamRegistryPlaceholder): void;
  }): void;
  getModules(): ReadonlyArray<{
    registerSymbolExtractors?(registry: ISeamRegistryPlaceholder): void;
    registerSymbolReferenceExtractors?(registry: ISeamRegistryPlaceholder): void;
  }>;
}

/**
 * Registers the paid-edition portal extractor module and runs both seam hooks.
 *
 * The module is imported dynamically, so Team code stays out of the Solo build.
 * Returns how many modules received the reference registry.
 */
export async function fillPortalKnowledgeSeams(
  composer: IPortalSeamComposer,
  registries: {
    symbolRegistry: ISymbolExtractorRegistry;
    symbolReferenceRegistry: ISymbolReferenceExtractorRegistry;
  },
): Promise<number> {
  const { PortalExtractorsModule } = await import("@exaix-team/portal-extractors");
  composer.registerCapabilityModule(new PortalExtractorsModule());

  let referenceRegistrations = 0;
  for (const module of composer.getModules()) {
    module.registerSymbolExtractors?.(registries.symbolRegistry as ISeamRegistryPlaceholder);
    module.registerSymbolReferenceExtractors?.(
      registries.symbolReferenceRegistry as ISeamRegistryPlaceholder,
    );
    referenceRegistrations += 1;
  }
  return referenceRegistrations;
}

/** Creates the edition composer and bootstraps the Team providers. The Team
 * import is dynamic, so Team code stays out of a Solo build. */
export async function createEditionComposer(
  editionType: string,
): Promise<SoloComposer | TeamComposer> {
  if (editionType === EDITION_TEAM || editionType === EDITION_ENTERPRISE) {
    const { bootstrapTeamProviders, TeamComposer } = await Promise.resolve(
      import("@exaix-team/team-composer"),
    );
    bootstrapTeamProviders();
    return new TeamComposer();
  }
  return new SoloComposer();
}
