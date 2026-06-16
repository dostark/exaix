/**
 * @module VotingPackage
 * @path packages-team/voting/mod.ts
 * @ungrounded
 * @description Barrel export for the @exaix-team/voting package.
 * @architectural-layer Voting
 * @related-files [packages-team/voting/src/voting_consensus_service.ts, packages-team/voting/src/voting_capability_module.ts]
 */

export { VotingConsensusService } from "./src/voting_consensus_service.ts";
export { VotingCapabilityModule } from "./src/voting_capability_module.ts";
export type { IExecutor, IExecutorResult, IVotingConsensusService } from "@exaix/core/types";
