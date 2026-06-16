/**
 * @module IExecutor
 * @path packages/voting/src/i_executor.ts
 * @ungrounded
 * @description Minimal executor interface for voting fan-out — runs a blueprint with a prompt and returns content + optional confidence.
 * @architectural-layer Voting
 * @dependencies []
 * @related-files [packages/voting/src/voting_consensus_service.ts]
 */

export interface IExecutorResult {
  content: string;
  confidence?: number;
}

export interface IExecutor {
  run(blueprint: string, prompt: string): Promise<IExecutorResult>;
}
