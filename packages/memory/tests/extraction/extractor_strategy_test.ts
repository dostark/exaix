/**
 * @module ExtractorStrategyTest
 * @path packages/memory/tests/extraction/extractor_strategy_test.ts
 * @description Verifies cost-gated extraction strategy selection and extraction events.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { IExtractionStrategy, IMemoryCostRouter } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { ConfidenceAssessmentLevel, LearningCategory, MemoryBankSource, MemoryScope } from "@exaix/core";
import type { LogMetadata } from "@exaix/core";
import { MemoryExtractorService } from "@exaix/memory";
import type { IProposalLearning } from "@exaix/schemas/memory_bank.ts";
import { castAny, createMinimalExecutionMemory } from "@exaix/testing";

function learning(title: string, qualityScore: number): IProposalLearning {
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    source: MemoryBankSource.EXECUTION,
    scope: MemoryScope.PROJECT,
    project: "test",
    title,
    description: `${title} description`,
    category: LearningCategory.INSIGHT,
    tags: [],
    confidence: ConfidenceAssessmentLevel.HIGH,
    quality_score: qualityScore,
  };
}

function strategy(value: IProposalLearning[], calls: string[], name: string): IExtractionStrategy {
  return {
    extract() {
      calls.push(name);
      return Promise.resolve(value);
    },
  };
}

Deno.test("MemoryExtractorService: selects LLM remotely and heuristic locally with typed Promise output", async () => {
  for (const remoteAllowed of [true, false]) {
    const calls: string[] = [];
    const events: Array<{ action: string; payload?: LogMetadata }> = [];
    const router = castAny<IMemoryCostRouter>({ isRemoteAllowed: () => Promise.resolve(remoteAllowed) });
    const logger = castAny<IEventLogger>({
      info(action: string, _target: string | null, payload?: LogMetadata) {
        events.push({ action, payload });
        return Promise.resolve();
      },
    });
    const service = new MemoryExtractorService(
      castAny({ system: { root: "/tmp" }, paths: { memory: "Memory" } }),
      castAny({}),
      castAny({}),
      logger,
      {
        costRouter: router,
        llmStrategy: strategy([learning("LLM", 0.88)], calls, "llm"),
        heuristicStrategy: strategy([learning("Heuristic", 0.5)], calls, "heuristic"),
      },
    );

    const resultPromise: Promise<IProposalLearning[]> = service.analyzeExecution(createMinimalExecutionMemory());
    const result = await resultPromise;

    assertEquals(calls, [remoteAllowed ? "llm" : "heuristic"]);
    assertEquals(result[0].title, remoteAllowed ? "LLM" : "Heuristic");
    assertEquals(events[0].action, DomainEventType.MemoryLearningExtracted);
    assertEquals(events[0].payload, {
      extraction_method: remoteAllowed ? "llm" : "heuristic",
      quality_score: remoteAllowed ? 0.88 : 0.5,
      learning_id: result[0].id,
    });
  }
});
