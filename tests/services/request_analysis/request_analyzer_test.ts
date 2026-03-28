/**
 * @module RequestAnalyzerTest
 * @path tests/services/request_analysis/request_analyzer_test.ts
 * @description Tests for the RequestAnalyzer orchestrator service.
 * Covers heuristic mode, LLM mode, hybrid mode logic, metadata timing,
 * activity logging, and graceful fallback on LLM failure.
 */

import { assertEquals, assertExists } from "@std/assert";
import { MockProvider } from "../../../src/ai/providers.ts";
import { createOutputValidator } from "../../../src/services/output_validator.ts";
import { RequestAnalyzer } from "../../../src/services/request_analysis/request_analyzer.ts";
import { RequestAnalysisComplexity, RequestTaskType } from "../../../src/shared/schemas/request_analysis.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";
import type { IDatabaseService } from "../../../src/shared/interfaces/i_database_service.ts";
import { makeValidAnalysisJson as makeValidJson } from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Heuristic mode
// ---------------------------------------------------------------------------

Deno.test("[RequestAnalyzer] analyzes in heuristic mode without provider", async () => {
  const analyzer = new RequestAnalyzer({ mode: AnalysisMode.HEURISTIC });

  const result = await analyzer.analyze("Fix the NullPointerException in OrderService.");

  assertExists(result);
  assertEquals(result.metadata.mode, AnalysisMode.HEURISTIC);
  assertEquals(result.taskType, RequestTaskType.BUGFIX);
});

Deno.test("[RequestAnalyzer] heuristic mode never calls provider", async () => {
  let generateCalled = false;
  const trackingProvider = {
    id: "tracking",
    generate: async (_p: string) => {
      generateCalled = true;
      await Promise.resolve();
      return makeValidJson();
    },
  };
  const analyzer = new RequestAnalyzer(
    { mode: AnalysisMode.HEURISTIC },
    trackingProvider,
  );

  await analyzer.analyze("Implement new feature.");

  assertEquals(generateCalled, false);
});

// ---------------------------------------------------------------------------
// LLM mode
// ---------------------------------------------------------------------------

Deno.test("[RequestAnalyzer] analyzes in LLM mode with mock provider", async () => {
  const provider = new MockProvider(makeValidJson());
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new RequestAnalyzer({ mode: AnalysisMode.LLM }, provider, validator);

  const result = await analyzer.analyze("Implement the new cache layer.");

  assertEquals(result.metadata.mode, AnalysisMode.LLM);
  assertEquals(result.taskType, RequestTaskType.FEATURE);
});

// ---------------------------------------------------------------------------
// Hybrid mode
// ---------------------------------------------------------------------------

Deno.test("[RequestAnalyzer] hybrid mode skips LLM for high-actionability requests", async () => {
  // Heuristic will classify a long well-specified request as high actionability ...
  // We simulate a scenario where heuristic score is above threshold by injecting a
  // provider that we verify is NOT called for a clear request.
  let llmCalled = false;
  const trackingProvider = {
    id: "tracking",
    generate: async (_p: string) => {
      llmCalled = true;
      await Promise.resolve();
      return makeValidJson({ score: 90 });
    },
  };
  const analyzer = new RequestAnalyzer(
    { mode: AnalysisMode.HYBRID, actionabilityThreshold: 20 }, // very low threshold → heuristic almost always wins
    trackingProvider,
  );

  await analyzer.analyze("Fix typo in README.");

  assertEquals(llmCalled, false);
});

Deno.test("[RequestAnalyzer] hybrid mode calls LLM for low-actionability requests", async () => {
  let llmCalled = false;
  const trackingProvider = {
    id: "tracking",
    generate: async (_p: string) => {
      llmCalled = true;
      await Promise.resolve();
      return makeValidJson({ score: 90 });
    },
  };
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new RequestAnalyzer(
    { mode: AnalysisMode.HYBRID, actionabilityThreshold: 100 }, // impossibly high threshold → always escalates
    trackingProvider,
    validator,
  );

  await analyzer.analyze("Maybe do something with the thing somehow?");

  assertEquals(llmCalled, true);
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

Deno.test("[RequestAnalyzer] records durationMs in metadata", async () => {
  const analyzer = new RequestAnalyzer({ mode: AnalysisMode.HEURISTIC });
  const result = await analyzer.analyze("Refactor the utils module.");
  assertEquals(typeof result.metadata.durationMs, "number");
  assertEquals(result.metadata.durationMs >= 0, true);
});

Deno.test("[RequestAnalyzer] populates analyzedAt timestamp", async () => {
  const analyzer = new RequestAnalyzer({ mode: AnalysisMode.HEURISTIC });
  const result = await analyzer.analyze("Add logging to AuthService.");
  assertExists(result.metadata.analyzedAt);
  // Must be parseable as a date
  assertEquals(isNaN(Date.parse(result.metadata.analyzedAt)), false);
});

// ---------------------------------------------------------------------------
// Activity logging
// ---------------------------------------------------------------------------

Deno.test("[RequestAnalyzer] logs activity to database when db provided", async () => {
  const logged: string[] = [];
  const mockDb = {
    logActivity: (actor: string, _actionType: string, _target: string | null, _payload: unknown) => {
      logged.push(actor);
    },
  };
  const analyzerWithDb = new RequestAnalyzer(
    { mode: AnalysisMode.HEURISTIC },
    undefined,
    undefined,
    mockDb as IDatabaseService,
  );

  await analyzerWithDb.analyze("Implement webhook notification system.");

  assertEquals(logged.length > 0, true);
});

Deno.test("[RequestAnalyzer] works without db (no logging, no error)", async () => {
  const analyzer = new RequestAnalyzer({ mode: AnalysisMode.HEURISTIC });
  // Should not throw even without a db
  const result = await analyzer.analyze("Update unit tests.");
  assertExists(result);
});

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

Deno.test("[RequestAnalyzer] merges heuristic file refs into LLM results", async () => {
  const llmJsonNoFiles = JSON.stringify({
    goals: [{ description: "goal", explicit: true, priority: 1 }],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: 80,
    complexity: RequestAnalysisComplexity.MEDIUM,
    taskType: RequestTaskType.FEATURE,
    tags: [],
    referencedFiles: [], // LLM missed the file refs
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 0,
      mode: AnalysisMode.LLM,
    },
  });
  const provider = new MockProvider(llmJsonNoFiles);
  const validator = createOutputValidator({ autoRepair: false });
  const analyzer = new RequestAnalyzer({ mode: AnalysisMode.LLM }, provider, validator);

  const text = "Implement feature X in src/services/cache_service.ts";
  const result = await analyzer.analyze(text);

  // File refs from heuristic should be merged in
  assertEquals(result.referencedFiles.some((f: string) => f.includes("src/services/cache_service.ts")), true);
});

// ---------------------------------------------------------------------------
// Graceful failure
// ---------------------------------------------------------------------------

Deno.test("[RequestAnalyzer] handles LLM failure gracefully in hybrid mode (falls back to heuristic)", async () => {
  const failingProvider = {
    id: "failing",
    generate: (_p: string): Promise<string> => Promise.reject(new Error("network error")),
  };
  const analyzer = new RequestAnalyzer(
    { mode: AnalysisMode.HYBRID, actionabilityThreshold: 100 }, // would normally escalate
    failingProvider,
  );

  const result = await analyzer.analyze("Add caching to UserService.");

  assertExists(result);
  // Should degrade to heuristic result, not throw
  assertEquals(result.metadata.mode, AnalysisMode.HYBRID);
});
