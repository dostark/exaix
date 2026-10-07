/**
 * @module IVotingConsensusService
 * @path packages/core/src/types/i_voting_consensus_service.ts
 * @description Contract for the voting/consensus service: fans out N runners and resolves majority/weighted consensus.
 * @architectural-layer Core
 * @dependencies [packages/core/src/types/i_executor.ts]
 * @related-files [exaix-team/packages/voting/src/voting_consensus_service.ts]
 */

import type { VotingGroupConfig, VotingResult } from "@exaix/schemas/voting.ts";
import type { IExecutorContext } from "./i_executor.ts";
import type { Opt, Reason } from "./optional_marker.ts";

export interface IVotingConsensusService {
  /** Fan out all runners for one objective, then resolve consensus. */
  run(
    config: VotingGroupConfig,
    basePrompt: string,
    traceId: string,
    context?: Opt<IExecutorContext, Reason.OptionalContext>,
  ): Promise<VotingResult>;
}
