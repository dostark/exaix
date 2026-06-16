/**
 * @module IVotingConsensusService
 * @path packages/voting/src/i_voting_consensus_service.ts
 * @ungrounded
 * @description Contract for the voting/consensus service: fans out N runners and resolves majority/weighted consensus.
 * @architectural-layer Voting
 * @dependencies [packages/voting/src/i_executor.ts]
 * @related-files [packages/voting/src/voting_consensus_service.ts]
 */

import type { VotingGroupConfig, VotingResult } from "@exaix/schemas/voting.ts";

export interface IVotingConsensusService {
  /** Fan out all runners for one objective, then resolve consensus. */
  run(
    config: VotingGroupConfig,
    basePrompt: string,
    traceId: string,
  ): Promise<VotingResult>;
}
