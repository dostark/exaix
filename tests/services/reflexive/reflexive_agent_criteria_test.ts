/**
 * @module ReflexiveAgentCriteriaTest
 * @path tests/services/reflexive_agent_criteria_test.ts
 * @description Verifies that ReflexiveAgent injects structured requirements into
 * the critique prompt when IRequestAnalysis is available, and that CritiqueSchema
 * includes the requirementsFulfillment field.
 */

import { assertEquals, assertExists } from "@std/assert";
import { createReflexiveAgent, CritiqueSchema } from "../../../src/services/agent/reflexive_agent.ts";
import { ANALYZER_VERSION } from "../../../src/shared/constants.ts";
import {
  IRequestAnalysis,
  RequestAnalysisComplexity,
  RequestTaskType,
} from "../../../src/shared/schemas/request_analysis.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";
import {
  IAgentExecutionResult,
  IAgentRunner,
  IBlueprint,
  IParsedRequest,
} from "../../../src/services/agent/agent_runner.ts";
import { createMockProvider } from "../../helpers/mock_provider.ts";

const SAMPLE_ANALYSIS: IRequestAnalysis = {
  goals: [
    { description: "Implement user authentication", explicit: true, priority: 1 },
    { description: "Improve performance", explicit: false, priority: 2 },
  ],
  requirements: [],
  constraints: [],
  acceptanceCriteria: [
    "Login must respond in under 200ms",
    "Support OAuth2 authentication",
  ],
  ambiguities: [],
  actionabilityScore: 85,
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

function makeFakeAgentResult(content: string): IAgentExecutionResult {
  return {
    content,
    thought: "",
    raw: content,
  };
}

function makeCritiqueJSON(withFulfillment = false): string {
  const base = {
    quality: "good",
    confidence: 85,
    passed: true,
    issues: [],
    reasoning: "Test reasoning",
    improvements: [],
  };
  if (withFulfillment) {
    return JSON.stringify({
      ...base,
      requirementsFulfillment: [
        { requirement: "Implement user authentication", status: "MET" },
        { requirement: "Login must respond in under 200ms", status: "PARTIAL" },
      ],
    });
  }
  return JSON.stringify(base);
}

/** A capturing runner that records the last critiqueRequest's userPrompt */
class CapturingRunner implements IAgentRunner {
  capturedPrompts: string[] = [];
  private critiqueContent: string;

  constructor(critiqueContent: string) {
    this.critiqueContent = critiqueContent;
  }

  run(
    _blueprint: IBlueprint,
    request: IParsedRequest,
  ): Promise<IAgentExecutionResult> {
    this.capturedPrompts.push(request.userPrompt);
    return Promise.resolve(makeFakeAgentResult(this.critiqueContent));
  }
}

Deno.test("[ReflexiveAgent] accepts optional requestAnalysis as third parameter to run()", async () => {
  const mockProvider = createMockProvider([
    `<thought>thinking</thought><content>Here is the implementation</content>`,
    `<thought></thought><content>${makeCritiqueJSON()}</content>`,
  ]);
  const agent = createReflexiveAgent(mockProvider, { maxIterations: 1 });

  // This should compile and run without error (3rd param is new)
  const result = await agent.run(
    { systemPrompt: "Test", identityId: "test" },
    { userPrompt: "Build auth system", context: {} },
    SAMPLE_ANALYSIS,
  );

  assertExists(result);
  assertExists(result.final);
});

Deno.test("[ReflexiveAgent] includes goals in critique when analysis available", async () => {
  const capturingRunner = new CapturingRunner(makeCritiqueJSON());
  const mockProvider = createMockProvider([
    `<thought>thinking</thought><content>Auth implementation</content>`,
  ]);
  const agent = createReflexiveAgent(mockProvider, { maxIterations: 1 });
  // Override critiqueRunner to capture prompts
  agent.critiqueRunner = capturingRunner;

  await agent.run(
    { systemPrompt: "Test", identityId: "test" },
    { userPrompt: "Build auth system", context: {} },
    SAMPLE_ANALYSIS,
  );

  const capturedPrompt = capturingRunner.capturedPrompts[0];
  assertExists(capturedPrompt);
  // Goals should appear in the prompt
  const includesGoal = capturedPrompt.includes("Implement user authentication");
  assertEquals(includesGoal, true);
});

Deno.test("[ReflexiveAgent] includes acceptance criteria in critique prompt", async () => {
  const capturingRunner = new CapturingRunner(makeCritiqueJSON());
  const mockProvider = createMockProvider([
    `<thought>thinking</thought><content>Auth implementation</content>`,
  ]);
  const agent = createReflexiveAgent(mockProvider, { maxIterations: 1 });
  agent.critiqueRunner = capturingRunner;

  await agent.run(
    { systemPrompt: "Test", identityId: "test" },
    { userPrompt: "Build auth system", context: {} },
    SAMPLE_ANALYSIS,
  );

  const capturedPrompt = capturingRunner.capturedPrompts[0];
  assertExists(capturedPrompt);
  const includesAC = capturedPrompt.includes("Login must respond in under 200ms");
  assertEquals(includesAC, true);
});

Deno.test("[ReflexiveAgent] critique output includes requirementsFulfillment", async () => {
  const critiqueContent = makeCritiqueJSON(true);
  const capturingRunner = new CapturingRunner(critiqueContent);
  const mockProvider = createMockProvider([
    `<thought>thinking</thought><content>Auth implementation</content>`,
  ]);
  const agent = createReflexiveAgent(mockProvider, { maxIterations: 1 });
  agent.critiqueRunner = capturingRunner;

  const result = await agent.run(
    { systemPrompt: "Test", identityId: "test" },
    { userPrompt: "Build auth system", context: {} },
    SAMPLE_ANALYSIS,
  );

  // The critique in the final iteration should have requirementsFulfillment
  const lastIteration = result.iterations[result.iterations.length - 1];
  assertExists(lastIteration.critique!.requirementsFulfillment);
  assertEquals(lastIteration.critique!.requirementsFulfillment!.length, 2);
  assertEquals(lastIteration.critique!.requirementsFulfillment![0].status, "MET");
});

Deno.test("[ReflexiveAgent] generic critique works without analysis", async () => {
  const mockProvider = createMockProvider([
    `<thought>thinking</thought><content>Here is the implementation</content>`,
    `<thought></thought><content>${makeCritiqueJSON()}</content>`,
  ]);
  const agent = createReflexiveAgent(mockProvider, { maxIterations: 1 });

  // Old 2-argument call style (backward compatible)
  const result = await agent.run(
    { systemPrompt: "Test", identityId: "test" },
    { userPrompt: "Build auth system", context: {} },
  );

  assertExists(result.final);
});

Deno.test("[ReflexiveAgent] goals show explicit/inferred markers", async () => {
  const capturingRunner = new CapturingRunner(makeCritiqueJSON());
  const mockProvider = createMockProvider([
    `<thought>thinking</thought><content>Auth implementation</content>`,
  ]);
  const agent = createReflexiveAgent(mockProvider, { maxIterations: 1 });
  agent.critiqueRunner = capturingRunner;

  await agent.run(
    { systemPrompt: "Test", identityId: "test" },
    { userPrompt: "Build auth system", context: {} },
    SAMPLE_ANALYSIS,
  );

  const capturedPrompt = capturingRunner.capturedPrompts[0];
  assertExists(capturedPrompt);
  // Explicit goal marker [E] should appear
  const hasExplicitMarker = capturedPrompt.includes("[E]");
  assertEquals(hasExplicitMarker, true);
  // Inferred goal marker [I] should appear (for "Improve performance" which has explicit: false)
  const hasInferredMarker = capturedPrompt.includes("[I]");
  assertEquals(hasInferredMarker, true);
});

Deno.test("[ReflexiveAgent] CritiqueSchema accepts requirementsFulfillment", () => {
  const critiqueWithFulfillment = {
    quality: "good",
    confidence: 85,
    passed: true,
    issues: [],
    reasoning: "Good work",
    improvements: [],
    requirementsFulfillment: [
      { requirement: "Must authenticate users", status: "MET" },
      { requirement: "Must rate limit", status: "MISSING" },
    ],
  };

  const result = CritiqueSchema.safeParse(critiqueWithFulfillment);
  assertEquals(result.success, true);
  if (!result.success) return;
  assertExists(result.data?.requirementsFulfillment);
  assertEquals(result.data!.requirementsFulfillment!.length, 2);
});
