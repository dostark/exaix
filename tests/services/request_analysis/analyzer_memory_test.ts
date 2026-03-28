/**
 * @module AnalyzerMemoryTest
 * @path tests/services/request_analysis/analyzer_memory_test.ts
 * @description Tests for Step 6: memory context passed to RequestAnalyzer
 * and injected into LLM prompt / heuristic signals.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { analyzeHeuristic } from "../../../src/services/request_analysis/heuristic_analyzer.ts";
import { RequestAnalysisComplexity, RequestTaskType } from "../../../src/shared/schemas/request_analysis.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";
import type { EnhancedRequest } from "../../../src/services/session_memory.ts";
import {
  createMockProvider,
  makeValidAnalysisJson as makeValidJson,
  setupTestAnalyzer,
  setupTestLlmAnalyzer,
} from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MEMORY_CONTEXT_TEXT =
  "RELEVANT MEMORIES:\n- Fixed auth service bug in src/services/auth.ts\n- Added JWT validation";

function makeEnhancedRequest(memoryContext = MEMORY_CONTEXT_TEXT): EnhancedRequest {
  return {
    originalRequest: "Fix login bug",
    memories: [],
    memoryContext,
    metadata: {
      memoriesRetrieved: 1,
      searchTime: 0,
    },
  };
}

const VALID_JSON = makeValidJson({ taskType: RequestTaskType.BUGFIX });

// ---------------------------------------------------------------------------
// LlmAnalyzer — prompt injection
// ---------------------------------------------------------------------------

Deno.test("[LlmAnalyzer] includes memory context in LLM prompt when memories provided", async () => {
  let capturedPrompt = "";
  const provider = createMockProvider((prompt: string) => {
    capturedPrompt = prompt;
    return VALID_JSON;
  });
  const { analyzer } = setupTestLlmAnalyzer(provider);

  await analyzer.analyze("Fix the login bug.", {
    memories: makeEnhancedRequest(),
  });

  assertStringIncludes(capturedPrompt, MEMORY_CONTEXT_TEXT);
});

Deno.test("[LlmAnalyzer] omits memory section from prompt when no memories provided", async () => {
  let capturedPrompt = "";
  const provider = createMockProvider((prompt: string) => {
    capturedPrompt = prompt;
    return VALID_JSON;
  });
  const { analyzer } = setupTestLlmAnalyzer(provider);

  await analyzer.analyze("Fix the login bug.");

  assertEquals(capturedPrompt.includes("RELEVANT MEMORIES"), false);
});

// ---------------------------------------------------------------------------
// HeuristicAnalyzer — memory keyword signals
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAnalyzer] includes file refs from memory context when provided", () => {
  const result = analyzeHeuristic("Fix the login bug.", {
    memories: makeEnhancedRequest(
      "Previously touched src/services/auth.ts and fixed JWT logic",
    ),
  });

  // File reference from the memory context should appear in referencedFiles
  assertEquals(result.referencedFiles?.includes("src/services/auth.ts"), true);
});

Deno.test("[HeuristicAnalyzer] works correctly without memory context", () => {
  // No context param → same as before
  const result = analyzeHeuristic("Fix the login bug.");
  assertEquals(Array.isArray(result.referencedFiles), true);
});

// ---------------------------------------------------------------------------
// RequestAnalyzer (integration) — wires memories through to LLM
// ---------------------------------------------------------------------------

Deno.test("[RequestAnalyzer] uses memory context in LLM analysis when provided", async () => {
  let capturedPrompt = "";
  const provider = createMockProvider((prompt: string) => {
    capturedPrompt = prompt;
    return VALID_JSON;
  });
  const { analyzer } = setupTestAnalyzer(AnalysisMode.LLM, provider);

  await analyzer.analyze("Fix the login bug.", {
    memories: makeEnhancedRequest(),
  });

  assertStringIncludes(capturedPrompt, MEMORY_CONTEXT_TEXT);
});

Deno.test("[RequestAnalyzer] works without memory context", async () => {
  const provider = createMockProvider(VALID_JSON);
  const { analyzer } = setupTestAnalyzer(AnalysisMode.LLM, provider);

  // Should not throw
  const result = await analyzer.analyze("Fix the login bug.");
  assertEquals(result.taskType, RequestTaskType.BUGFIX);
});

Deno.test("[RequestAnalyzer] memory informs complexity classification via heuristic tags", () => {
  // In LLM mode with relevant file refs from memory, heuristic file refs merge
  // This is a unit check — verify the context field is accepted by analyzeQuick's
  // backing function (heuristic path)
  const result = analyzeHeuristic(
    "Simple fix.",
    {
      memories: makeEnhancedRequest(
        "Related files: src/a.ts, src/b.ts, src/c.ts, src/d.ts, src/e.ts, src/f.ts",
      ),
    },
  );
  // With 6 file refs from memories, complexity should escalate
  assertEquals(result.complexity, RequestAnalysisComplexity.COMPLEX);
});
