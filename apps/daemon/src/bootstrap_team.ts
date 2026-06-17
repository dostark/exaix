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
import type { IExecutor, IHitlPolicyEvaluator } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import type { AgentExecutorAdapter, FlowRunner } from "@exaix/flow";
import type { TeamComposer } from "@exaix-team/team-composer";
import { CAP_VOTING, CAPABILITY_EDITION } from "@exaix/core/composer";
import { EDITION_TEAM } from "@exaix/core";

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
  hitlPolicyEvaluator?: IHitlPolicyEvaluator,
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

  const registry = flowRunner.getStepHandlerRegistry();
  for (const module of composer.getModules()) {
    module.registerFlowStepHandlers?.(registry);
  }
}
