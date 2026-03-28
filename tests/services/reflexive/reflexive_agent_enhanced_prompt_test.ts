/**
 * @module ReflexiveAgentEnhancedPromptTest
 * @path tests/services/reflexive_agent_enhanced_prompt_test.ts
 * @description Tests for buildEnhancedCritiquePrompt() extraction and the
 * MAX_CRITIQUE_REQUIREMENTS cap (Phase 49, Step 2).
 * Tests complementary to reflexive_agent_criteria_test.ts — covers only
 * behaviors not already tested there (cap logic, no-goals analysis, etc.).
 * @architectural-layer Tests
 * @dependencies [src/services/reflexive_agent.ts, src/shared/constants.ts]
 * @related-files [.copilot/planning/phase-49-quality-pipeline-hardening.md]
 */
import { ANALYZER_VERSION } from "../../../src/shared/constants.ts";
import { assertEquals, assertExists } from "@std/assert";
import { createReflexiveAgent, ReflexiveAgent as _ReflexiveAgent } from "../../../src/services/reflexive_agent.ts";
import type { IRequestAnalysis } from "../../../src/shared/schemas/request_analysis.ts";
import { RequestAnalysisComplexity, RequestTaskType } from "../../../src/shared/schemas/request_analysis.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";
import type {
  IAgentExecutionResult,
  IAgentRunner,
  IBlueprint,
  IParsedRequest,
} from "../../../src/services/agent_runner.ts";
import { createMockProvider } from "../../helpers/mock_provider.ts";
import { MAX_CRITIQUE_REQUIREMENTS } from "../../../src/shared/constants.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeAgentResult(content: string): IAgentExecutionResult {
  return { content, thought: "", raw: content };
}

function makeCritiqueJSON(): string {
  return JSON.stringify({
    quality: "good",
    confidence: 85,
    passed: true,
    issues: [],
    reasoning: "Test reasoning",
    improvements: [],
  });
}

/** Capturing runner — records every prompt sent to the agent */
class CapturingRunner implements IAgentRunner {
  capturedPrompts: string[] = [];
  private readonly critiqueContent: string;
  constructor(critiqueContent: string) {
    this.critiqueContent = critiqueContent;
  }
  run(_blueprint: IBlueprint, request: IParsedRequest): Promise<IAgentExecutionResult> {
    this.capturedPrompts.push(request.userPrompt);
    return Promise.resolve(makeFakeAgentResult(this.critiqueContent));
  }
}

function makeAnalysisWithNGoals(n: number): IRequestAnalysis {
  return {
    goals: Array.from({ length: n }, (_, i) => ({
      description: `Goal ${i + 1}`,
      explicit: true,
      priority: i + 1,
    })),
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: 70,
    taskType: RequestTaskType.FEATURE,
    complexity: RequestAnalysisComplexity.MEDIUM,
    tags: [],
    referencedFiles: [],
    metadata: {
      analyzedAt: "2025-01-01T00:00:00.000Z",
      durationMs: 50,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
  };
}

function makeAnalysisWithGoalsAndACs(nGoals: number, nAcs: number): IRequestAnalysis {
  const base = makeAnalysisWithNGoals(nGoals);
  return {
    ...base,
    acceptanceCriteria: Array.from({ length: nAcs }, (_, i) => `AC ${i + 1}`),
  };
}

// ---------------------------------------------------------------------------
// Cap tests — RED until extract + cap are implemented
// ---------------------------------------------------------------------------

Deno.test(
  "[buildEnhancedCritiquePrompt] caps requirements at MAX_CRITIQUE_REQUIREMENTS",
  async () => {
    const capturingRunner = new CapturingRunner(makeCritiqueJSON());
    const mockProvider = createMockProvider([
      `<thought>thinking</thought><content>Response content</content>`,
    ]);
    const agent = createReflexiveAgent(mockProvider, { maxIterations: 1 });
    agent.critiqueRunner = capturingRunner;

    // Build analysis with more goals than the cap
    const analysis = makeAnalysisWithNGoals(MAX_CRITIQUE_REQUIREMENTS + 5);

    const request: IParsedRequest = {
      userPrompt: "Build something",
      context: {},
      traceId: "trace-cap-test",
    };
    const response: IAgentExecutionResult = { content: "Done", thought: "", raw: "Done" };

    await agent.critique(request, response, analysis);

    const prompt = capturingRunner.capturedPrompts[0];
    assertExists(prompt);

    // Count how many "Goal N" entries appear in the prompt — must not exceed cap
    const goalMatches = prompt.match(/Goal \d+/g) ?? [];
    assertEquals(
      goalMatches.length <= MAX_CRITIQUE_REQUIREMENTS,
      true,
      `Expected at most ${MAX_CRITIQUE_REQUIREMENTS} requirements in prompt, got ${goalMatches.length}`,
    );
  },
);

Deno.test(
  "[buildEnhancedCritiquePrompt] cap applies across goals + ACs combined",
  async () => {
    const capturingRunner = new CapturingRunner(makeCritiqueJSON());
    const mockProvider = createMockProvider([
      `<thought>thinking</thought><content>Response content</content>`,
    ]);
    const agent = createReflexiveAgent(mockProvider, { maxIterations: 1 });
    agent.critiqueRunner = capturingRunner;

    // 8 goals + 8 ACs = 16 total — only MAX_CRITIQUE_REQUIREMENTS should appear
    const analysis = makeAnalysisWithGoalsAndACs(8, 8);

    const request: IParsedRequest = {
      userPrompt: "Build something",
      context: {},
      traceId: "trace-cap-combined",
    };
    const response: IAgentExecutionResult = { content: "Done", thought: "", raw: "Done" };

    await agent.critique(request, response, analysis);

    const prompt = capturingRunner.capturedPrompts[0];
    assertExists(prompt);

    // Count Goal and AC entries combined
    const goalMatches = prompt.match(/Goal \d+/g) ?? [];
    const acMatches = prompt.match(/AC \d+/g) ?? [];
    const totalInjected = goalMatches.length + acMatches.length;

    assertEquals(
      totalInjected <= MAX_CRITIQUE_REQUIREMENTS,
      true,
      `Expected at most ${MAX_CRITIQUE_REQUIREMENTS} total requirements, got ${totalInjected}`,
    );
  },
);

Deno.test(
  "[buildEnhancedCritiquePrompt] handles analysis with no goals (only ACs)",
  async () => {
    const capturingRunner = new CapturingRunner(makeCritiqueJSON());
    const mockProvider = createMockProvider([
      `<thought>thinking</thought><content>Response content</content>`,
    ]);
    const agent = createReflexiveAgent(mockProvider, { maxIterations: 1 });
    agent.critiqueRunner = capturingRunner;

    const analysis = makeAnalysisWithGoalsAndACs(0, 3);

    const request: IParsedRequest = {
      userPrompt: "Build something",
      context: {},
      traceId: "trace-no-goals",
    };
    const response: IAgentExecutionResult = { content: "Done", thought: "", raw: "Done" };

    await agent.critique(request, response, analysis);

    const prompt = capturingRunner.capturedPrompts[0];
    assertExists(prompt);
    assertEquals(prompt.includes("AC 1"), true);
    assertEquals(prompt.includes("AC 2"), true);
    assertEquals(prompt.includes("AC 3"), true);
  },
);

Deno.test(
  "[buildEnhancedCritiquePrompt] below cap: all requirements included",
  async () => {
    const capturingRunner = new CapturingRunner(makeCritiqueJSON());
    const mockProvider = createMockProvider([
      `<thought>thinking</thought><content>Response content</content>`,
    ]);
    const agent = createReflexiveAgent(mockProvider, { maxIterations: 1 });
    agent.critiqueRunner = capturingRunner;

    // 3 goals, below MAX_CRITIQUE_REQUIREMENTS — all should appear
    const analysis = makeAnalysisWithNGoals(3);

    const request: IParsedRequest = {
      userPrompt: "Build something",
      context: {},
      traceId: "trace-below-cap",
    };
    const response: IAgentExecutionResult = { content: "Done", thought: "", raw: "Done" };

    await agent.critique(request, response, analysis);

    const prompt = capturingRunner.capturedPrompts[0];
    assertExists(prompt);
    assertEquals(prompt.includes("Goal 1"), true);
    assertEquals(prompt.includes("Goal 2"), true);
    assertEquals(prompt.includes("Goal 3"), true);
  },
);
