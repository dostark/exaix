/**
 * @module QualityHardeningE2ETest
 * @path tests/integration/35_quality_hardening_e2e_test.ts
 * @description End-to-end integration tests for Phase 49 quality pipeline
 * hardening — four gap scenarios:
 *   Gap 1: ReflexiveAgent enhanced critique with goals from analysis
 *   Gap 2: Memory context feeds into RequestAnalyzer via IRequestAnalysisContext
 *   Gap 3: Content-based complexity classification (heuristic + constants)
 *   Gap 4: Structured frontmatter criteria flow through pipeline
 * @architectural-layer Tests
 * @related-files [.copilot/planning/phase-49-quality-pipeline-hardening.md]
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { ANALYZER_VERSION, CritiqueQuality } from "@exaix/core";
import { RequestStatus } from "@exaix/core/status";
import { createReflexiveAgent } from "../../src/services/agent/reflexive_agent.ts";
import { RequestAnalyzer } from "../../src/services/request_analysis/request_analyzer.ts";
import { analyzeHeuristic } from "../../src/services/request_analysis/heuristic_analyzer.ts";
import { buildParsedRequest } from "../../src/services/request/request_common.ts";
import { createOutputValidator } from "../../src/services/tool/output_validator.ts";
import { RequestAnalysisComplexity, RequestTaskType } from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "@exaix/core/types";
import type { EnhancedRequest } from "../../src/services/memory/session_memory.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { IRequestFrontmatter } from "@exaix/core/request";
import {
  ANALYSIS_COMPLEX_BULLET_THRESHOLD,
  ANALYSIS_COMPLEX_CHAR_THRESHOLD,
  ANALYSIS_COMPLEX_FILE_THRESHOLD,
} from "@exaix/core";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TRACE_ID = "trace-e2e-001";
const REQUEST_ID = "req-e2e-001";

function makeAnalysis(
  override: Partial<IRequestAnalysis> = {},
): IRequestAnalysis {
  return {
    goals: [
      { description: "Implement new feature", explicit: true, priority: 1 },
      { description: "Add unit tests", explicit: true, priority: 2 },
    ],
    requirements: [
      {
        description: "Feature must be covered by tests",
        confidence: 0.9,
        type: "functional",
        explicit: true,
      },
    ],
    constraints: [],
    acceptanceCriteria: ["All tests pass", "No lint errors"],
    ambiguities: [],
    actionabilityScore: 85,
    complexity: RequestAnalysisComplexity.MEDIUM,
    taskType: RequestTaskType.FEATURE,
    tags: ["feature"],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 5,
      mode: AnalysisMode.LLM,
      analyzerVersion: ANALYZER_VERSION,
    },
    ...override,
  };
}

const VALID_CRITIQUE_JSON = JSON.stringify({
  feedback: "Good implementation with tests.",
  quality: CritiqueQuality.GOOD,
  issues: [],
  suggestions: [],
  confidence: 90,
  passed: true,
  reasoning: "The plan covers all requirements.",
  requirementsFulfillment: [
    { requirement: "Feature must be covered by tests", status: "MET" },
  ],
});

function makeMemories(memoryContext: string): EnhancedRequest {
  return {
    originalRequest: "Fix auth",
    memories: [],
    memoryContext,
    metadata: {
      memoriesRetrieved: 1,
      searchTime: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Gap 1: ReflexiveAgent enhanced critique with goals from analysis
// ---------------------------------------------------------------------------

Deno.test("[E2E] Gap 1: reflexive agent enhanced critique with goals", async () => {
  let capturedPrompt = "";
  const provider: IModelProvider = {
    id: "mock",
    generate: (prompt: string): Promise<IGenerateResult> => {
      capturedPrompt = prompt;
      return Promise.resolve({
        content: VALID_CRITIQUE_JSON,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };

  const analysis = makeAnalysis();
  const agent = createReflexiveAgent(provider);

  const mockParsedRequest = buildParsedRequest(
    "Implement feature X",
    {
      trace_id: TRACE_ID,
      created: new Date().toISOString(),
      status: RequestStatus.PENDING,
      priority: "medium",
      source: "manual",
      created_by: "user",
    },
    REQUEST_ID,
    TRACE_ID,
  );

  const mockExecutionResult = {
    thought: "Thinking...",
    content: "Here is the plan",
    raw: "Here is the plan",
  };

  const result = await agent.critique(mockParsedRequest, mockExecutionResult, analysis);

  // Verify analysis goals appear in the critique prompt
  assertStringIncludes(capturedPrompt, "Implement new feature");
  assertStringIncludes(capturedPrompt, "All tests pass");

  // Verify critique contains requirementsFulfillment when analysis is available
  assertExists(result.requirementsFulfillment);
  assertEquals(result.requirementsFulfillment?.length, 1);
  assertEquals(
    result.requirementsFulfillment?.[0].requirement,
    "Feature must be covered by tests",
  );
});

// ---------------------------------------------------------------------------
// Gap 2: Memory context feeds into RequestAnalyzer analysis
// ---------------------------------------------------------------------------

Deno.test("[E2E] Gap 2: memory context feeds into analysis", async () => {
  const MEMORY_SNIPPET = "Previously fixed auth bug in src/services/auth.ts";
  let capturedPrompt = "";

  const provider: IModelProvider = {
    id: "mock",
    generate: (prompt: string): Promise<IGenerateResult> => {
      capturedPrompt = prompt;
      return Promise.resolve({
        content: JSON.stringify({
          goals: [{ description: "Fix bug", explicit: true, priority: 1 }],
          requirements: [],
          constraints: [],
          acceptanceCriteria: [],
          ambiguities: [],
          actionabilityScore: 75,
          complexity: RequestAnalysisComplexity.SIMPLE,
          taskType: RequestTaskType.BUGFIX,
          tags: [],
          referencedFiles: [],
          metadata: {
            analyzedAt: new Date().toISOString(),
            durationMs: 0,
            mode: AnalysisMode.LLM,
          },
        }),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };

  const analyzer = new RequestAnalyzer(
    { mode: AnalysisMode.LLM },
    provider,
    createOutputValidator({ autoRepair: false }),
  );

  await analyzer.analyze("Fix the login bug.", {
    memories: makeMemories(MEMORY_SNIPPET),
  });

  // LLM prompt should include the memory context
  assertStringIncludes(capturedPrompt, MEMORY_SNIPPET);
});

// ---------------------------------------------------------------------------
// Gap 3: Content-based complexity classification
// ---------------------------------------------------------------------------

Deno.test("[E2E] Gap 3: short simple request → SIMPLE complexity", () => {
  const result = analyzeHeuristic("Fix typo in README");
  assertEquals(result.complexity, RequestAnalysisComplexity.SIMPLE);
});

Deno.test("[E2E] Gap 3: long body → COMPLEX complexity", () => {
  const longBody = "x".repeat(ANALYSIS_COMPLEX_CHAR_THRESHOLD + 1);
  const result = analyzeHeuristic(longBody);
  assertEquals(result.complexity, RequestAnalysisComplexity.COMPLEX);
});

Deno.test("[E2E] Gap 3: many bullets → COMPLEX complexity", () => {
  const bullets = Array.from(
    { length: ANALYSIS_COMPLEX_BULLET_THRESHOLD + 1 },
    (_, i) => `- task ${i + 1}`,
  ).join("\n");
  const result = analyzeHeuristic(
    `Please do the following:\n${bullets}`,
  );
  assertEquals(result.complexity, RequestAnalysisComplexity.COMPLEX);
});

Deno.test("[E2E] Gap 3: many file refs → COMPLEX complexity", () => {
  const fileRefs = Array.from(
    { length: ANALYSIS_COMPLEX_FILE_THRESHOLD + 1 },
    (_, i) => `src/services/service_${i}.ts`,
  ).join(", ");
  const result = analyzeHeuristic(`Update the following files: ${fileRefs}`);
  assertEquals(result.complexity, RequestAnalysisComplexity.COMPLEX);
});

// ---------------------------------------------------------------------------
// Gap 4: Structured frontmatter criteria flow through pipeline
// ---------------------------------------------------------------------------

Deno.test("[E2E] Gap 4: structured frontmatter criteria propagate through pipeline", () => {
  const frontmatter: IRequestFrontmatter = {
    trace_id: TRACE_ID,
    created: new Date().toISOString(),
    status: RequestStatus.PENDING,
    priority: "high",
    source: "manual",
    created_by: "user",
    identity: "senior-coder",
    acceptance_criteria: ["All tests pass", "No lint errors"],
    expected_outcomes: ["Feature is live", "Documentation updated"],
    scope: {
      include: ["src/services/"],
      exclude: ["tests/"],
    },
  };

  const parsed = buildParsedRequest(
    "Implement user authentication",
    frontmatter,
    REQUEST_ID,
    TRACE_ID,
  );

  // Acceptance criteria should be present in context
  assertExists(parsed.context.acceptance_criteria);
  assertEquals(parsed.context.acceptance_criteria, [
    "All tests pass",
    "No lint errors",
  ]);

  // Expected outcomes should be in context
  assertExists(parsed.context.expected_outcomes);
  assertEquals(parsed.context.expected_outcomes, [
    "Feature is live",
    "Documentation updated",
  ]);

  // Scope should be in context
  const scope = parsed.context.scope as { include?: string[]; exclude?: string[] };
  assertExists(scope);
  assertEquals(scope.include, ["src/services/"]);
  assertEquals(scope.exclude, ["tests/"]);

  // Verify core request fields are intact
  assertEquals(parsed.traceId, TRACE_ID);
  assertEquals(parsed.requestId, REQUEST_ID);
  assert(parsed.userPrompt.includes("user authentication"));
});

Deno.test("[E2E] Gap 4: buildParsedRequest works without optional frontmatter fields", () => {
  const frontmatter: IRequestFrontmatter = {
    trace_id: TRACE_ID,
    created: new Date().toISOString(),
    status: RequestStatus.PENDING,
    priority: "medium",
    source: "manual",
    created_by: "user",
    identity: "general",
  };

  const parsed = buildParsedRequest(
    "Simple fix",
    frontmatter,
    REQUEST_ID,
    TRACE_ID,
  );

  // Optional fields should be absent
  assertEquals(parsed.context.acceptance_criteria, undefined);
  assertEquals(parsed.context.expected_outcomes, undefined);
  assertEquals(parsed.context.scope, undefined);
});
