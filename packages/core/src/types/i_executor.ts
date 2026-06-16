/**
 * @module IExecutor
 * @path packages/core/src/types/i_executor.ts
 * @description Minimal executor interface for voting fan-out — runs a blueprint with a prompt and returns content + optional confidence.
 * @architectural-layer Core
 * @dependencies []
 * @related-files [packages-team/voting/src/voting_consensus_service.ts]
 */

export interface IExecutorResult {
  content: string;
  confidence?: number;
}

export interface IExecutor {
  run(blueprint: string, prompt: string): Promise<IExecutorResult>;
}
