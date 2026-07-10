/**
 * @module BootstrapTeam
 * @path apps/daemon/src/bootstrap_team.ts
 * @description Team-edition bootstrap — wires Team-only capability modules
 * (voting, guardrail, etc.) through the edition-composer seam.
 * Called from main.ts when EXAIX_EDITION=team.
 * @architectural-layer Application
 * @related-files [apps/daemon/main.ts]
 */

import { VotingCapabilityModule, VotingConsensusService } from "@exaix-team/voting";
import { HitlCapabilityModule } from "@exaix-team/hitl";
import { PortalExtractorsModule } from "@exaix-team/portal-extractors";
import { ModelRegistryService } from "@exaix-team/model-registry-live";
import { DefaultModelRegistry } from "@exaix/model-registry";
import type { IDatabaseService, IExecutor, IHitlPolicyEvaluator, IModelRegistry } from "@exaix/core/types";
import type { IModelRegistryProvider, IModelRegistryProviderDeps } from "@exaix/core/composer";
import type { IProviderHealthChecker } from "@exaix/ai";
import type { Config } from "@exaix/schemas";
import type { IEventLogger } from "@exaix/core/logger";
import type { AgentExecutorAdapter, FlowRunner } from "@exaix/flow";
import type { TeamComposer } from "@exaix-team/team-composer";
import { CAP_VOTING, CAPABILITY_EDITION } from "@exaix/core/composer";
import type { ISeamRegistryPlaceholder } from "@exaix/core/composer";
import type { ISymbolExtractorRegistry } from "@exaix/portal/knowledge";
import { EDITION_TEAM } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/** Runtime dependencies the Team model-registry provider closes over (Phase 135, GAP-3). */
export interface ITeamModelRegistryDeps {
  db: IDatabaseService;
  config: Config;
  logger: IEventLogger;
}

/**
 * Register the Team live model-registry provider on the edition composer
 * (Phase 135 Step 1, GAP-2/GAP-3).
 *
 * MUST be called BEFORE main.ts selects the registry via
 * `getModelRegistryProvider()` — otherwise selection resolves to the Solo floor
 * and the Team catalog is never reached. The provider closes over db/config/logger
 * (which the seam's `createModelRegistry(deps)` does not carry) and builds the floor
 * from the seam-supplied `deps.healthChecker`, so the shared
 * `IModelRegistryProviderDeps` contract stays frozen.
 */
export function registerTeamModelRegistry(
  composer: TeamComposer,
  deps: ITeamModelRegistryDeps,
): void {
  const provider: IModelRegistryProvider = {
    createModelRegistry(seamDeps: IModelRegistryProviderDeps): IModelRegistry {
      const healthChecker = seamDeps.healthChecker as IProviderHealthChecker;
      const floor = new DefaultModelRegistry(healthChecker);
      return new ModelRegistryService(deps.db, deps.logger, deps.config, floor, healthChecker);
    },
  };
  composer.registerModelRegistryProvider(provider);
}

/**
 * Register all Team-edition capability modules and invoke their
 * seam-registration hooks against the FlowRunner.
 *
 * This is called from main.ts after FlowRunner construction, inside the
 * `if (editionType === EDITION_TEAM)` guard.
 */
export function registerTeamCapabilities(
  agentExecutorAdapter: AgentExecutorAdapter,
  logger: IEventLogger,
  flowRunner: FlowRunner,
  composer: TeamComposer,
  symbolRegistry: ISymbolExtractorRegistry,
  hitlPolicyEvaluator?: Opt<IHitlPolicyEvaluator, Reason.OptionalDependency>,
): void {
  // Assert the capability-to-edition mapping is consistent at wiring time
  if (CAPABILITY_EDITION[CAP_VOTING] !== EDITION_TEAM) {
    throw new Error(
      `CAP_VOTING maps to "${CAPABILITY_EDITION[CAP_VOTING]}" but is being wired in Team edition. ` +
        "Update CAPABILITY_EDITION or move this wiring to the correct bootstrap.",
    );
  }

  // Phase 118: Register HITL governance capability module (asserts edition mapping)
  if (hitlPolicyEvaluator) {
    const hitlModule = new HitlCapabilityModule();
    composer.registerCapabilityModule(hitlModule);
  }

  // Phase 113: Wire voting capability through the edition-composer seam
  const votingExecutor: IExecutor = {
    run: async (blueprint, prompt) => {
      const result = await agentExecutorAdapter.run(blueprint, {
        userPrompt: prompt,
        context: {},
      });
      return { content: result.content };
    },
  };
  const votingService = new VotingConsensusService(votingExecutor, logger);
  const votingModule = new VotingCapabilityModule(votingService, logger);
  composer.registerCapabilityModule(votingModule);

  // Phase 119: Register PortalExtractorsModule for extended-language symbol extraction
  const portalExtractorsModule = new PortalExtractorsModule();
  composer.registerCapabilityModule(portalExtractorsModule);

  const stepRegistry = flowRunner.getStepHandlerRegistry();
  for (const module of composer.getModules()) {
    module.registerFlowStepHandlers?.(stepRegistry);
    module.registerSymbolExtractors?.(symbolRegistry as ISeamRegistryPlaceholder);
  }
}
