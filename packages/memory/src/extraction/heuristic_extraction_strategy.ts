/**
 * @module HeuristicExtractionStrategy
 * @path packages/memory/src/extraction/heuristic_extraction_strategy.ts
 * @description Async strategy wrapper for the existing deterministic learning extractor.
 * @architectural-layer Services
 * @related-files [packages/memory/src/extraction/learning_extractor.ts, packages/core/src/types/i_extraction_strategy.ts]
 */
import type { IExecutionMemoryStore, IExtractionStrategy, Opt, Reason } from "@exaix/core/types";
import type { IExecutionMemory, IProposalLearning } from "@exaix/schemas/memory_bank.ts";
import { LearningExtractor } from "./learning_extractor.ts";

const HEURISTIC_QUALITY_SCORE = 0.5;

export class HeuristicExtractionStrategy implements IExtractionStrategy {
  constructor(private executionMemoryStore?: Opt<IExecutionMemoryStore, Reason.OptionalDependency>) {}

  async extract(execution: IExecutionMemory): Promise<IProposalLearning[]> {
    const scratchpadEntries = this.executionMemoryStore
      ? await this.executionMemoryStore.readNotes(execution.trace_id)
      : [];
    return LearningExtractor.extract(execution, scratchpadEntries).map((learning) => ({
      ...learning,
      quality_score: HEURISTIC_QUALITY_SCORE,
    }));
  }
}
