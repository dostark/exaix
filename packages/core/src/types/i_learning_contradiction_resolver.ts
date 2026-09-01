/**
 * @module ILearningContradictionResolver
 * @path packages/core/src/types/i_learning_contradiction_resolver.ts
 * @description Contract for adjudicating a new approved learning against approved similarity candidates.
 * @architectural-layer Core
 * @related-files [packages/memory/src/contradiction/learning_contradiction_resolver.ts, packages/memory/src/bank/memory_bank.ts]
 */
import type { MemoryOperation } from "./enums.ts";
import type { ILearning } from "@exaix/schemas";

export interface ILearningContradictionDecision {
  operation: MemoryOperation;
  candidateId?: string;
  reason: string;
}

export interface ILearningContradictionResolver {
  resolve(incoming: ILearning, candidates: ILearning[]): Promise<ILearningContradictionDecision>;
}
