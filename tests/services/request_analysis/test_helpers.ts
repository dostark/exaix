/**
 * @module RequestAnalysisTestHelpers
 * @path tests/services/request_analysis/test_helpers.ts
 * @description Shared helper functions and constants for request analysis tests.
 */

import { RequestAnalysisComplexity, RequestTaskType } from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";
import type { IGenerateResult } from "../../../src/ai/providers/common.ts";
import type { IModelProvider } from "../../../src/ai/types.ts";
import { createOutputValidator } from "../../../src/services/tool/output_validator.ts";
import { RequestAnalyzer } from "../../../src/services/request_analysis/request_analyzer.ts";
import { LlmAnalyzer } from "../../../src/services/request_analysis/llm_analyzer.ts";
import type { IDatabaseService } from "../../../src/shared/interfaces/i_database_service.ts";

/**
 * Creates a valid JSON string for a RequestAnalysis object.
 */
export function makeValidAnalysisJson(
  opts: { score?: number; mode?: AnalysisMode; taskType?: RequestTaskType } = {},
): string {
  return JSON.stringify({
    goals: [{ description: "goal", explicit: true, priority: 1 }],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: opts.score ?? 80,
    complexity: RequestAnalysisComplexity.MEDIUM,
    taskType: opts.taskType ?? RequestTaskType.FEATURE,
    tags: ["feature"],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 0,
      mode: opts.mode ?? AnalysisMode.LLM,
    },
  });
}

/**
 * Creates a mock provider that returns the given JSON or calls a tracker.
 */
export function createMockProvider(
  logic: string | ((prompt: string) => Promise<string> | string),
): IModelProvider {
  return {
    id: "mock",
    generate: async (prompt: string): Promise<IGenerateResult> => {
      let content: string;
      if (typeof logic === "function") {
        content = await logic(prompt);
      } else {
        content = logic;
      }
      return {
        content,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      };
    },
  };
}

/**
 * Common setup for LLM-based analyzer tests.
 */
export function setupTestAnalyzer(
  modeOrConfig: AnalysisMode | { mode: AnalysisMode; actionabilityThreshold?: number },
  provider: IModelProvider,
  db?: IDatabaseService,
): { analyzer: RequestAnalyzer; validator: ReturnType<typeof createOutputValidator> } {
  const config = typeof modeOrConfig === "string" ? { mode: modeOrConfig } : modeOrConfig;
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new RequestAnalyzer(config, provider, validator, db);
  return { analyzer, validator };
}

/**
 * Common setup for LlmAnalyzer tests.
 */
export function setupTestLlmAnalyzer(
  provider: IModelProvider,
): { analyzer: LlmAnalyzer; validator: ReturnType<typeof createOutputValidator> } {
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new LlmAnalyzer(provider, validator);
  return { analyzer, validator };
}
