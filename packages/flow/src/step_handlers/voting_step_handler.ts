/**
 * @module VotingStepHandler
 * @path packages/flow/src/step_handlers/voting_step_handler.ts
 * @description IFlowStepHandler for VOTING_GROUP step type — fans out N runners via
 * IVotingConsensusService and returns the consensus winner as the step result.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/step_handlers/step_handler.ts, packages-team/voting/src/voting_consensus_service.ts]
 */

import type { IFlowStepHandler, IStepExecutionContext } from "./step_handler.ts";
import type { IVotingConsensusService } from "@exaix/core/types";
import type { VotingResult } from "@exaix/schemas/voting.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { FlowStepExecutionMode } from "@exaix/core";
import type { IAgentExecutionResult } from "@exaix/execution";

export interface IVotingStepHandlerDeps {
  votingService: IVotingConsensusService;
  eventLogger: IEventLogger;
}

/** @visible */
export class VotingStepHandler implements IFlowStepHandler {
  readonly stepType = "voting_group";

  readonly #votingService: IVotingConsensusService;
  readonly #eventLogger: IEventLogger;

  constructor(deps: IVotingStepHandlerDeps) {
    this.#votingService = deps.votingService;
    this.#eventLogger = deps.eventLogger;
  }

  async execute(ctx: IStepExecutionContext): Promise<IAgentExecutionResult> {
    const { step, request } = ctx;

    if (step.execution_mode === FlowStepExecutionMode.DYNAMIC) {
      throw new Error("VOTING_GROUP step does not support DYNAMIC execution mode");
    }

    if (!step.voting) {
      throw new Error("Voting step has no voting config");
    }

    const basePrompt = request.userPrompt;
    const traceId = request.traceId ?? crypto.randomUUID();

    const result: VotingResult = await this.#votingService.run(
      step.voting,
      basePrompt,
      traceId,
    );

    return {
      thought: result.consensus_reached
        ? `Consensus reached via ${result.strategy} strategy with ${result.candidates.length} candidates`
        : `No consensus reached among ${result.candidates.length} candidates — using best confidence`,
      content: result.winner.response,
      raw: JSON.stringify(result),
    };
  }
}
