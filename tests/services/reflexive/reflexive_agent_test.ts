/**
 * @module ReflexiveAgentSchemaTest
 * @path tests/services/reflexive_agent_test.ts
 * @description Validates the data schema for reflexive agent critiques, ensuring robust enforcement
 * of quality metrics, confidence levels, and technical debt reporting.
 */

import { assert, assertEquals, assertExists, assertGreater } from "@std/assert";
import { CritiqueQuality, CritiqueSeverity } from "../../../src/shared/enums.ts";
import { IModelProvider } from "../../../src/ai/types.ts";
import {
  createCodeReviewReflexiveAgent,
  createHighQualityReflexiveAgent,
  createReflexiveAgent,
  CritiqueSchema,
} from "../../../src/services/agent/reflexive_agent.ts";
import { createMockProvider } from "../../helpers/mock_provider.ts";

function makeXMLResponse(thought: string, content: string): string {
  return `<thought>${thought}</thought><content>${content}</content>`;
}

function makeCritiqueJSON(options: {
  quality?: string;
  confidence?: number;
  passed?: boolean;
  issues?: Array<{ type: string; severity: string; description: string }>;
}): string {
  return JSON.stringify({
    quality: options.quality ?? "good",
    confidence: options.confidence ?? 85,
    passed: options.passed ?? true,
    issues: options.issues ?? [],
    reasoning: "Test critique reasoning",
    improvements: [],
  });
}

// Helper for running agent tests
async function runAgentTest(
  mockResponses: string[],
  options: any = {},
  assertions: (result: any, identity: any) => void | Promise<void>,
) {
  const agent = createReflexiveAgent(createMockProvider(mockResponses), options);
  const result = await agent.run(
    { systemPrompt: "Test", identityId: "test" },
    { userPrompt: "Help", context: {} },
  );
  await assertions(result, agent);
}

// ============================================================================
// CritiqueSchema Tests
// ============================================================================

Deno.test("[CritiqueSchema] validates correct critique", () => {
  const validCritique = {
    quality: CritiqueQuality.GOOD,
    confidence: 85,
    passed: true,
    issues: [
      {
        type: "clarity",
        severity: CritiqueSeverity.MINOR,
        description: "Could be clearer",
        suggestion: "Add more examples",
      },
    ],
    reasoning: "Overall good response",
    improvements: ["Add examples"],
  };

  const result = CritiqueSchema.safeParse(validCritique);
  assert(result.success);
});

Deno.test("[CritiqueSchema] rejects invalid quality", () => {
  const invalid = {
    quality: "awesome", // Invalid enum value
    confidence: 85,
    passed: true,
    issues: [],
    reasoning: "Test",
  };

  const result = CritiqueSchema.safeParse(invalid);
  assert(!result.success);
});

Deno.test("[CritiqueSchema] rejects confidence out of range", () => {
  const invalid = {
    quality: CritiqueQuality.GOOD,
    confidence: 150, // Out of range
    passed: true,
    issues: [],
    reasoning: "Test",
  };

  const result = CritiqueSchema.safeParse(invalid);
  assert(!result.success);
});

// ============================================================================
// ReflexiveAgent Basic Tests
// ============================================================================

Deno.test("[ReflexiveAgent] accepts excellent response on first iteration", async () => {
  const mockResponses = [
    // Initial response
    makeXMLResponse("Thinking", "This is a great response"),
    // Critique (excellent, should accept)
    makeCritiqueJSON({ quality: CritiqueQuality.EXCELLENT, confidence: 95, passed: true }),
  ];

  await runAgentTest(mockResponses, {}, (result) => {
    assertEquals(result.totalIterations, 1);
    assert(result.earlyExit);
    assertEquals(result.final.content, "This is a great response");
    assertEquals(result.finalCritique?.quality, CritiqueQuality.EXCELLENT);
  });
});

Deno.test("[ReflexiveAgent] refines response when quality is poor", async () => {
  const mockResponses = [
    makeXMLResponse("First attempt", "Initial poor response"),
    makeCritiqueJSON({
      quality: CritiqueQuality.POOR,
      confidence: 30,
      passed: false,
      issues: [{ type: "accuracy", severity: CritiqueSeverity.CRITICAL, description: "Inaccurate" }],
    }),
    makeXMLResponse("Second attempt", "Improved response"),
    makeCritiqueJSON({ quality: CritiqueQuality.GOOD, confidence: 85, passed: true }),
  ];

  await runAgentTest(mockResponses, { maxIterations: 3 }, (result) => {
    assertEquals(result.totalIterations, 2);
    assertEquals(result.final.content, "Improved response");
    assertGreater(result.iterations.length, 1);
  });
});

Deno.test("[ReflexiveAgent] stops at maxIterations", async () => {
  const mockResponses = [
    makeXMLResponse("Attempt 1", "Response 1"),
    makeCritiqueJSON({ quality: CritiqueQuality.POOR, confidence: 20, passed: false }),
    makeXMLResponse("Attempt 2", "Response 2"),
    makeCritiqueJSON({ quality: CritiqueQuality.POOR, confidence: 25, passed: false }),
    makeXMLResponse("Attempt 3", "Response 3"),
    makeCritiqueJSON({ quality: CritiqueQuality.POOR, confidence: 30, passed: false }),
  ];

  await runAgentTest(mockResponses, {
    maxIterations: 3,
    confidenceThreshold: 90,
    minQuality: CritiqueQuality.EXCELLENT,
  }, (result) => {
    assertEquals(result.totalIterations, 3);
    assert(!result.earlyExit);
  });
});

Deno.test("[ReflexiveAgent] tracks iterations correctly", async () => {
  const mockResponses = [
    makeXMLResponse("First", "Content 1"),
    makeCritiqueJSON({ quality: CritiqueQuality.NEEDS_IMPROVEMENT, confidence: 50, passed: false }),
    makeXMLResponse("Second", "Content 2"),
    makeCritiqueJSON({ quality: CritiqueQuality.GOOD, confidence: 80, passed: true }),
  ];

  await runAgentTest(mockResponses, { maxIterations: 5 }, (result) => {
    assertEquals(result.iterations.length, 2);
    assertEquals(result.iterations[0].iteration, 1);
    assertEquals(result.iterations[1].iteration, 2);
    assertExists(result.iterations[0].critique);
    assertExists(result.iterations[1].critique);
  });
});

// ============================================================================
// Acceptance Logic Tests
// ============================================================================

Deno.test("[ReflexiveAgent] accepts based on confidence threshold", async () => {
  const mockResponses = [
    makeXMLResponse("Test", "Response"),
    makeCritiqueJSON({
      quality: CritiqueQuality.ACCEPTABLE,
      confidence: 75, // Above default threshold of 70
      passed: true,
    }),
  ];

  await runAgentTest(mockResponses, { confidenceThreshold: 70 }, (result) => {
    assertEquals(result.totalIterations, 1);
    assert(result.earlyExit);
  });
});

Deno.test("[ReflexiveAgent] accepts based on quality level", async () => {
  const mockResponses = [
    makeXMLResponse("Test", "Response"),
    makeCritiqueJSON({
      quality: CritiqueQuality.GOOD, // Above minQuality of "acceptable"
      confidence: 60, // Below threshold, but quality passes
      passed: true,
    }),
  ];

  await runAgentTest(mockResponses, {
    minQuality: CritiqueQuality.ACCEPTABLE,
    confidenceThreshold: 90,
  }, (result) => {
    assertEquals(result.totalIterations, 1);
  });
});

Deno.test("[ReflexiveAgent] rejects with critical issues", async () => {
  const mockResponses = [
    makeXMLResponse("Test", "Bad response"),
    makeCritiqueJSON({
      quality: CritiqueQuality.ACCEPTABLE,
      confidence: 75,
      passed: false, // Not passed due to critical issue
      issues: [{ type: "accuracy", severity: CritiqueSeverity.CRITICAL, description: "Wrong info" }],
    }),
    makeXMLResponse("Fixed", "Fixed response"),
    makeCritiqueJSON({ quality: CritiqueQuality.GOOD, confidence: 85, passed: true }),
  ];

  await runAgentTest(mockResponses, { maxIterations: 3 }, (result) => {
    assertEquals(result.totalIterations, 2);
  });
});

// ============================================================================
// Metrics Tests
// ============================================================================

Deno.test("[ReflexiveAgent] tracks metrics correctly", async () => {
  const mockResponses = [
    makeXMLResponse("Test", "Response"),
    makeCritiqueJSON({ quality: CritiqueQuality.GOOD, confidence: 85, passed: true }),
  ];

  await runAgentTest(mockResponses, {}, (_result, agent) => {
    const metrics = agent.getMetrics();
    assertEquals(metrics.totalExecutions, 1);
    assertEquals(metrics.totalIterations, 1);
    assertEquals(metrics.qualityDistribution.good, 1);
  });
});

Deno.test("[ReflexiveAgent] accumulates metrics across executions", async () => {
  let callCount = 0;
  const provider: IModelProvider = {
    id: "mock-provider",
    generate: (): Promise<string> => {
      callCount++;
      if (callCount % 2 === 1) {
        return Promise.resolve(makeXMLResponse("Test", "Response"));
      } else {
        return Promise.resolve(makeCritiqueJSON({ quality: CritiqueQuality.GOOD, confidence: 85, passed: true }));
      }
    },
  };

  const agent = createReflexiveAgent(provider);

  await agent.run(
    { systemPrompt: "Test", identityId: "test" },
    { userPrompt: "Help 1", context: {} },
  );
  await agent.run(
    { systemPrompt: "Test", identityId: "test" },
    { userPrompt: "Help 2", context: {} },
  );

  const metrics = agent.getMetrics();

  assertEquals(metrics.totalExecutions, 2);
  assertEquals(metrics.totalIterations, 2);
});

Deno.test("[ReflexiveAgent] resets metrics", async () => {
  const mockResponses = [
    makeXMLResponse("Test", "Response"),
    makeCritiqueJSON({ quality: CritiqueQuality.GOOD, confidence: 85, passed: true }),
  ];

  await runAgentTest(mockResponses, {}, (_result, agent) => {
    agent.resetMetrics();
    const metrics = agent.getMetrics();
    assertEquals(metrics.totalExecutions, 0);
    assertEquals(metrics.totalIterations, 0);
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

Deno.test("[createReflexiveAgent] creates agent with defaults", () => {
  const provider = createMockProvider([]);
  const agent = createReflexiveAgent(provider);
  assertExists(agent);
});

Deno.test("[createCodeReviewReflexiveAgent] creates code review optimized agent", async () => {
  const mockResponses = [
    makeXMLResponse("Review", "Code looks good"),
    makeCritiqueJSON({ quality: CritiqueQuality.GOOD, confidence: 80, passed: true }),
  ];

  const agent = createCodeReviewReflexiveAgent(createMockProvider(mockResponses));

  const result = await agent.run(
    { systemPrompt: "Review code", identityId: "code-reviewer" },
    { userPrompt: "Review this function", context: {} },
  );

  // Should accept good quality quickly (optimized for code review)
  assertEquals(result.totalIterations, 1);
});

Deno.test("[createHighQualityReflexiveAgent] creates high quality agent", () => {
  const provider = createMockProvider([]);
  const agent = createHighQualityReflexiveAgent(provider);
  assertExists(agent);
  // High quality agent should exist with stricter settings
});

// ============================================================================
// Edge Cases
// ============================================================================

Deno.test("[ReflexiveAgent] handles critique parse failure gracefully", async () => {
  const mockResponses = [
    makeXMLResponse("Test", "Response"),
    // Invalid JSON that won't parse
    "This is not valid JSON at all",
  ];

  await runAgentTest(mockResponses, {}, (result) => {
    // Should still complete with fallback critique
    assertExists(result.final);
    assertEquals(result.totalIterations, 1);
  });
});

Deno.test("[ReflexiveAgent] calculates average confidence", async () => {
  const mockResponses = [
    makeXMLResponse("First", "Response 1"),
    makeCritiqueJSON({ quality: CritiqueQuality.NEEDS_IMPROVEMENT, confidence: 60, passed: false }),
    makeXMLResponse("Second", "Response 2"),
    makeCritiqueJSON({ quality: CritiqueQuality.GOOD, confidence: 80, passed: true }),
  ];

  await runAgentTest(mockResponses, {}, (result) => {
    // Average of 60 and 80
    assertEquals(result.averageConfidence, 70);
  });
});

Deno.test("[ReflexiveAgent] tracks total duration", async () => {
  const mockResponses = [
    makeXMLResponse("Test", "Response"),
    makeCritiqueJSON({ quality: CritiqueQuality.EXCELLENT, confidence: 95, passed: true }),
  ];

  await runAgentTest(mockResponses, {}, (result) => {
    assertGreater(result.totalDurationMs, 0);
  });
});

Deno.test("[ReflexiveAgent] tracks issue type distribution", async () => {
  const mockResponses = [
    makeXMLResponse("Test", "Response"),
    makeCritiqueJSON({
      quality: CritiqueQuality.NEEDS_IMPROVEMENT,
      confidence: 50,
      passed: false,
      issues: [
        { type: "accuracy", severity: CritiqueSeverity.MAJOR, description: "Wrong" },
        { type: "clarity", severity: CritiqueSeverity.MINOR, description: "Unclear" },
      ],
    }),
    makeXMLResponse("Fixed", "Better response"),
    makeCritiqueJSON({ quality: CritiqueQuality.GOOD, confidence: 85, passed: true }),
  ];

  await runAgentTest(mockResponses, {}, (_result, agent) => {
    const metrics = agent.getMetrics();
    assertEquals(metrics.issueTypeDistribution["accuracy"], 1);
    assertEquals(metrics.issueTypeDistribution["clarity"], 1);
  });
});
