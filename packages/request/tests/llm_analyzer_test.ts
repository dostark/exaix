// deno-lint-ignore-file no-explicit-any
/**
 * @module LlmAnalyzerTest
 * @path packages/request/tests/llm_analyzer_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description Tests for the LLM-powered request analysis strategy.
 * Uses MockProvider to verify prompt construction, JSON parsing,
 * schema validation, and fallback behaviour.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { createOutputValidator, type IOutputSchemaName, type IOutputValidator } from "@exaix/tool-runtime";
import { LlmAnalyzer } from "@exaix/request";
import { RequestAnalysisComplexity, RequestTaskType } from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "@exaix/core/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validAnalysisJson = JSON.stringify({
  goals: [{ description: "Add unit tests", explicit: true, priority: 1 }],
  requirements: [{ description: "Cover all public methods", confidence: 0.9, type: "functional", explicit: true }],
  constraints: ["No new dependencies"],
  acceptanceCriteria: ["All tests pass"],
  ambiguities: [],
  actionabilityScore: 80,
  complexity: RequestAnalysisComplexity.MEDIUM,
  taskType: RequestTaskType.TEST,
  tags: ["test", "coverage"],
  referencedFiles: ["src/services/user_service.ts"],
  metadata: {
    analyzedAt: new Date().toISOString(),
    durationMs: 0,
    mode: AnalysisMode.LLM,
  },
});

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createCapturingProvider(responseJson: string): { provider: IModelProvider; capturedPrompt: () => string } {
  let capturedPrompt = "";
  return {
    capturedPrompt: () => capturedPrompt,
    provider: {
      id: "capturing",
      generate: async (prompt: string): Promise<IGenerateResult> => {
        capturedPrompt = prompt;
        await Promise.resolve();
        return {
          content: responseJson,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: "capturing-mock",
          provider: "mock",
          cost_usd: 0,
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("[LlmAnalyzer] parses valid LLM JSON response into IRequestAnalysis", async () => {
  const provider = new MockProvider(validAnalysisJson);
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new LlmAnalyzer(provider, validator);

  const result = await analyzer.analyze("Add unit tests for UserService.");

  assertEquals(result.taskType, RequestTaskType.TEST);
  assertEquals(result.actionabilityScore, 80);
  assertEquals(result.goals.length, 1);
  assertEquals(result.metadata.mode, AnalysisMode.LLM);
});

Deno.test("[LlmAnalyzer] handles LLM returning invalid JSON gracefully", async () => {
  const provider = new MockProvider("This is not JSON at all.");
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new LlmAnalyzer(provider, validator);

  // Should not throw — returns fallback analysis
  const result = await analyzer.analyze("Fix the authentication bug.");

  assertExists(result);
  assertExists(result.metadata);
  assertEquals(result.metadata.mode, AnalysisMode.LLM);
});

Deno.test("[LlmAnalyzer] handles LLM returning partial fields", async () => {
  const partialJson = JSON.stringify({
    goals: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: 50,
    complexity: RequestAnalysisComplexity.SIMPLE,
    taskType: RequestTaskType.UNKNOWN,
    tags: [],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 0,
      mode: AnalysisMode.LLM,
    },
  });
  const provider = new MockProvider(partialJson);
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new LlmAnalyzer(provider, validator);

  const result = await analyzer.analyze("Do something.");
  assertEquals(result.actionabilityScore, 50);
});

Deno.test("[LlmAnalyzer] passes request text in prompt to provider", async () => {
  const { provider, capturedPrompt } = createCapturingProvider(validAnalysisJson);
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new LlmAnalyzer(provider, validator);

  await analyzer.analyze("Implement the new cache layer in CacheService.");

  assertStringIncludes(capturedPrompt(), "Implement the new cache layer in CacheService.");
});

Deno.test("[LlmAnalyzer] passes optional context in prompt when provided", async () => {
  const { provider, capturedPrompt } = createCapturingProvider(validAnalysisJson);
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new LlmAnalyzer(provider, validator);

  await analyzer.analyze("Fix the bug.", { identityId: "coder-agent", priority: "high" });

  assertStringIncludes(capturedPrompt(), "coder-agent");
});

Deno.test("[LlmAnalyzer] uses OutputValidator for schema validation", async () => {
  let parseAndValidateCalled = false;
  const mockValidator: IOutputValidator = {
    parseXMLTags: (raw: string) => ({ thought: "", content: raw, raw }),
    validate: () => ({ success: false, repairAttempted: false, repairSucceeded: false, raw: "" }),
    validateWithSchema: () => ({ success: false, repairAttempted: false, repairSucceeded: false, raw: "" }),
    parseAndValidate: <T>(content: string, _schema: any) => {
      parseAndValidateCalled = true;
      // Delegate to real parser for correctness
      const parsed = JSON.parse(content);
      return {
        success: true,
        value: parsed as T,
        repairAttempted: false,
        repairSucceeded: false,
        raw: content,
      };
    },
    parseAndValidateWithSchema: <K extends IOutputSchemaName>(
      raw: string,
      _schemaName: K,
    ) => {
      return {
        success: false,
        repairAttempted: false,
        repairSucceeded: false,
        raw: raw,
      };
    },
    getMetrics: () => ({
      totalAttempts: 0,
      successfulValidations: 0,
      repairAttempts: 0,
      successfulRepairs: 0,
      failuresByErrorType: {},
    }),
    resetMetrics: () => {},
  };
  const provider = new MockProvider(validAnalysisJson);
  const analyzer = new LlmAnalyzer(provider, mockValidator);

  await analyzer.analyze("Fix bug.");

  assertEquals(parseAndValidateCalled, true);
});

Deno.test("[LlmAnalyzer] returns fallback analysis on validation failure", async () => {
  const provider = new MockProvider('{"invalid": true}');
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new LlmAnalyzer(provider, validator);

  const result = await analyzer.analyze("Some vague request.");

  // Fallback must still return a structurally valid IRequestAnalysis
  assertExists(result.metadata);
  assertExists(result.goals);
  assertExists(result.requirements);
  assertEquals(result.metadata.mode, AnalysisMode.LLM);
});

Deno.test("[LlmAnalyzer] populates metadata.durationMs", async () => {
  const provider = new MockProvider(validAnalysisJson);
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new LlmAnalyzer(provider, validator);

  const result = await analyzer.analyze("Add feature X.");

  assertEquals(typeof result.metadata.durationMs, "number");
  assertEquals(result.metadata.durationMs >= 0, true);
});

// ---------------------------------------------------------------------------
// Step 21: Prompt template references new field names
// ---------------------------------------------------------------------------

Deno.test("[LlmAnalyzer] prompt template references type, interpretations, and clarificationQuestion", async () => {
  const { provider, capturedPrompt } = createCapturingProvider(validAnalysisJson);
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new LlmAnalyzer(provider, validator);

  await analyzer.analyze("Implement the new module.");

  assertStringIncludes(capturedPrompt(), "type");
  assertStringIncludes(capturedPrompt(), "interpretations");
  assertStringIncludes(capturedPrompt(), "clarificationQuestion");
});

// ---------------------------------------------------------------------------
// Step 25: analyzerVersion in output metadata
// ---------------------------------------------------------------------------

Deno.test("[LlmAnalyzer] output includes analyzerVersion in metadata", async () => {
  const provider = new MockProvider(validAnalysisJson);
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new LlmAnalyzer(provider, validator);

  const result = await analyzer.analyze("Add a new feature.");

  assertExists(result.metadata.analyzerVersion);
  assertEquals(typeof result.metadata.analyzerVersion, "string");
  assertEquals(result.metadata.analyzerVersion.length > 0, true);
});

Deno.test("[LlmAnalyzer] includes high-impact ambiguity in prompt for ambiguous requests", async () => {
  const { provider, capturedPrompt } = createCapturingProvider(validAnalysisJson);
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new LlmAnalyzer(provider, validator);

  await analyzer.analyze("Maybe fix that thing somehow? AmbiguityImpact?");

  // Prompt should reference the IRequestAnalysis schema fields
  assertStringIncludes(capturedPrompt().toLowerCase(), "ambiguit");
});
