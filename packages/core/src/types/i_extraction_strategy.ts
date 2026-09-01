/**
 * @module IExtractionStrategy
 * @path packages/core/src/types/i_extraction_strategy.ts
 * @description Strategy contract for extracting proposed learnings from execution memory.
 * @architectural-layer Core
 * @related-files [packages/memory/src/extraction/llm_learning_extractor.ts, packages/memory/src/extraction/heuristic_extraction_strategy.ts]
 */
import type { IExecutionMemory, IProposalLearning } from "@exaix/schemas";

export interface IExtractionStrategy {
  extract(execution: IExecutionMemory): Promise<IProposalLearning[]>;
}
