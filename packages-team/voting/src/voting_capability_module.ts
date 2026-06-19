/**
 * @module VotingCapabilityModule
 * @path packages-team/voting/src/voting_capability_module.ts
 * @ungrounded
 * @description ICapabilityModule implementation for voting/consensus — registers
 * VotingStepHandler into the FlowRunner's step-handler registry.
 * First concrete consumer of the Phase 115 ICapabilityModule seam.
 * @architectural-layer Voting
 * @related-files [packages/flow/src/step_handlers/voting_step_handler.ts, packages/core/src/composer/edition_composer.ts]
 */

import { FlowStepType } from "@exaix/core";
import type { ICapabilityModule, ISeamRegistryPlaceholder } from "@exaix/core/composer";
import type { IVotingConsensusService } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { type FlowStepHandlerRegistry, VotingStepHandler } from "@exaix/flow";

export class VotingCapabilityModule implements ICapabilityModule {
  readonly #votingService: IVotingConsensusService;
  readonly #eventLogger: IEventLogger;

  constructor(votingService: IVotingConsensusService, eventLogger: IEventLogger) {
    this.#votingService = votingService;
    this.#eventLogger = eventLogger;
  }

  registerFlowStepHandlers(registry: ISeamRegistryPlaceholder): void {
    const handler = new VotingStepHandler({
      votingService: this.#votingService,
      eventLogger: this.#eventLogger,
    });

    const r = registry as FlowStepHandlerRegistry;
    r.register(handler);
    // Phase 121 Step 4: alias CONSENSUS to the same VotingStepHandler
    r.registerWithKey(FlowStepType.CONSENSUS, handler);
  }
}
