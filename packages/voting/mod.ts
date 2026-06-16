/**
 * @module VotingPackage
 * @path packages/voting/mod.ts
 * @ungrounded
 * @description Barrel export for the @exaix/voting package.
 * @architectural-layer Voting
 * @related-files [packages/voting/src/*.ts]
 */

export { VotingConsensusService } from "./src/voting_consensus_service.ts";
export type { IVotingConsensusService } from "./src/i_voting_consensus_service.ts";
export type { IExecutor, IExecutorResult } from "./src/i_executor.ts";
