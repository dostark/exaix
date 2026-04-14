/**
 * @module AgentRunnerTest
 * @path tests/agents/agent_runner_test.ts
 * @description Verifies the AgentRunner service, ensuring correct initialization of
 * agent state, prompt assembly, and graceful handling of model provider errors.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { MockProvider } from "../../src/ai/providers.ts";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "../../src/services/agent/agent_runner.ts";
import { PORTAL_CONTEXT_KEY } from "../../src/shared/constants.ts";
import { buildPortalContextBlock } from "../../src/services/context/prompt_context.ts";
import type { ISkillsService } from "../../src/shared/interfaces/i_skills_service.ts";
import type { ISkillMatchRequest } from "../../src/shared/types/skill.ts";
import type { ISkill, ISkillMatch, SkillDefinition } from "../../src/shared/schemas/memory_bank.ts";
import { MemoryBankSource, MemoryScope, SkillStatus } from "../../src/shared/enums.ts";
import type { IGenerateResult } from "../../src/ai/types.ts";

// ============================================================================
// Test Fixtures
// ============================================================================

const sampleBlueprint: IBlueprint = {
  systemPrompt: `You are a helpful coding assistant.
Always structure your response using XML tags:
<thought>Your reasoning process</thought>
<content>Your user-facing response</content>`,
};

const sampleRequest: IParsedRequest = {
  userPrompt: "Create a simple hello world function in TypeScript",
  context: {},
};

const wellFormedResponse = `<thought>
The user wants a simple hello world function. I'll create a TypeScript function
that returns a greeting string. This is straightforward and doesn't require any
external dependencies.
</thought>
<content>
Here's a simple hello world function in TypeScript:

\`\`\`typescript
function helloWorld(): string {
  return "Hello, World!";
}
\`\`\`

You can call this function to get the greeting message.
</content>`;

// ============================================================================
// Test 1: AgentRunner combines System Prompt and User Request correctly
// ============================================================================

Deno.test("AgentRunner combines System Prompt and User Request correctly", async () => {
  let capturedPrompt = "";

  // Create a mock provider that captures the prompt it receives
  const mockProvider = new MockProvider(wellFormedResponse);

  // Wrap the generate method to capture the prompt
  const originalGenerate = mockProvider.generate.bind(mockProvider);
  mockProvider.generate = async (prompt: string): Promise<IGenerateResult> => {
    capturedPrompt = prompt;
    return await originalGenerate(prompt);
  };

  const runner = new AgentRunner(mockProvider);
  await runner.run(sampleBlueprint, sampleRequest);

  // Verify the prompt contains both system and user prompts
  assertStringIncludes(capturedPrompt, sampleBlueprint.systemPrompt);
  assertStringIncludes(capturedPrompt, sampleRequest.userPrompt);
});

Deno.test("AgentRunner formats combined prompt correctly", async () => {
  let capturedPrompt = "";

  const mockProvider = new MockProvider(wellFormedResponse);
  const originalGenerate = mockProvider.generate.bind(mockProvider);
  mockProvider.generate = async (prompt: string): Promise<IGenerateResult> => {
    capturedPrompt = prompt;
    return await originalGenerate(prompt);
  };

  const runner = new AgentRunner(mockProvider);
  await runner.run(sampleBlueprint, sampleRequest);

  // The prompt should have system prompt first, then user prompt
  const systemIndex = capturedPrompt.indexOf(sampleBlueprint.systemPrompt);
  const userIndex = capturedPrompt.indexOf(sampleRequest.userPrompt);

  assertEquals(systemIndex >= 0, true, "System prompt should be present");
  assertEquals(userIndex >= 0, true, "User prompt should be present");
  assertEquals(systemIndex < userIndex, true, "System prompt should come before user prompt");
});

Deno.test("AgentRunner injects portal context when provided", async () => {
  let capturedPrompt = "";

  const mockProvider = new MockProvider(wellFormedResponse);
  const originalGenerate = mockProvider.generate.bind(mockProvider);
  mockProvider.generate = async (prompt: string): Promise<IGenerateResult> => {
    capturedPrompt = prompt;
    return await originalGenerate(prompt);
  };

  const runner = new AgentRunner(mockProvider);
  const portalContext = buildPortalContextBlock({
    portalAlias: "portal-exaix",
    portalRoot: "/tmp/portal-exaix",
  });

  await runner.run(sampleBlueprint, {
    ...sampleRequest,
    context: {
      [PORTAL_CONTEXT_KEY]: portalContext,
    },
  });

  assertStringIncludes(capturedPrompt, portalContext);
});

// ============================================================================
// Test 2: AgentRunner calls modelProvider.generate with the combined prompt
// ============================================================================

Deno.test("AgentRunner calls modelProvider.generate", async () => {
  let generateCalled = false;

  const mockProvider = new MockProvider(wellFormedResponse);
  const originalGenerate = mockProvider.generate.bind(mockProvider);
  mockProvider.generate = async (prompt: string): Promise<IGenerateResult> => {
    generateCalled = true;
    return await originalGenerate(prompt);
  };

  const runner = new AgentRunner(mockProvider);
  await runner.run(sampleBlueprint, sampleRequest);

  assertEquals(generateCalled, true, "modelProvider.generate should be called");
});

Deno.test("AgentRunner passes complete prompt to modelProvider.generate", async () => {
  let receivedPrompt = "";

  const mockProvider = new MockProvider(wellFormedResponse);
  mockProvider.generate = async (prompt: string): Promise<IGenerateResult> => {
    receivedPrompt = prompt;
    return await Promise.resolve({
      content: wellFormedResponse,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "mock-model",
      provider: "mock",
      cost_usd: 0,
    });
  };

  const runner = new AgentRunner(mockProvider);
  await runner.run(sampleBlueprint, sampleRequest);

  assertExists(receivedPrompt);
  assertEquals(receivedPrompt.length > 0, true, "Prompt should not be empty");
});

// ============================================================================
// Test 3: AgentRunner parses a structured response into thought and content
// ============================================================================

Deno.test("AgentRunner parses well-formed XML response", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertExists(result.thought);
  assertExists(result.content);
  assertExists(result.raw);

  assertStringIncludes(result.thought, "The user wants a simple hello world function");
  assertStringIncludes(result.content, "function helloWorld()");
  assertEquals(result.raw, wellFormedResponse);
});

Deno.test("AgentRunner extracts thought tag correctly", async () => {
  const response = `<thought>This is my reasoning</thought>
<content>This is the output</content>`;

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertEquals(result.thought.trim(), "This is my reasoning");
});

Deno.test("AgentRunner extracts content tag correctly", async () => {
  const response = `<thought>Reasoning here</thought>
<content>User-facing content here</content>`;

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertEquals(result.content.trim(), "User-facing content here");
});

Deno.test("AgentRunner handles multiline thought and content", async () => {
  const response = `<thought>
Line 1 of thought
Line 2 of thought
Line 3 of thought
</thought>
<content>
Line 1 of content
Line 2 of content
</content>`;

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertStringIncludes(result.thought, "Line 1 of thought");
  assertStringIncludes(result.thought, "Line 2 of thought");
  assertStringIncludes(result.thought, "Line 3 of thought");
  assertStringIncludes(result.content, "Line 1 of content");
  assertStringIncludes(result.content, "Line 2 of content");
});

Deno.test("AgentRunner preserves raw response", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertEquals(result.raw, wellFormedResponse);
});

// ============================================================================
// Test 4: AgentRunner handles malformed responses
// ============================================================================

Deno.test("AgentRunner handles response with no XML tags (fallback)", async () => {
  const plainResponse = "This is just plain text with no XML tags";

  const mockProvider = new MockProvider(plainResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  // Should fallback to treating whole string as content
  assertEquals(result.thought, "");
  assertEquals(result.content, plainResponse);
  assertEquals(result.raw, plainResponse);
});

Deno.test("AgentRunner handles response with only thought tag", async () => {
  const response = "<thought>Only thought here</thought>";

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertStringIncludes(result.thought, "Only thought here");
  // Content should be empty or the raw response
  assertEquals(result.content, "");
});

Deno.test("AgentRunner handles response with only content tag", async () => {
  const response = "<content>Only content here</content>";

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertEquals(result.thought, "");
  assertStringIncludes(result.content, "Only content here");
});

Deno.test("AgentRunner handles response with unclosed tags", async () => {
  const response = "<thought>Unclosed thought\n<content>Some content</content>";

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  // Should handle gracefully - either extract what's possible or fallback
  assertExists(result.thought);
  assertExists(result.content);
  assertEquals(result.raw, response);
});

Deno.test("AgentRunner handles response with nested tags", async () => {
  const response = `<thought>
Analyzing the request which mentions <code>function</code>
</thought>
<content>
Here's the <strong>solution</strong>
</content>`;

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  // Should extract outer tags correctly
  assertStringIncludes(result.thought, "<code>function</code>");
  assertStringIncludes(result.content, "<strong>solution</strong>");
});

Deno.test("AgentRunner handles empty response", async () => {
  const mockProvider = new MockProvider("");
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertEquals(result.thought, "");
  assertEquals(result.content, "");
  assertEquals(result.raw, "");
});

// ============================================================================
// Test 5: Handles empty blueprints or requests gracefully
// ============================================================================

Deno.test("AgentRunner handles empty system prompt", async () => {
  const emptyBlueprint: IBlueprint = {
    systemPrompt: "",
  };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(emptyBlueprint, sampleRequest);

  assertExists(result);
  assertEquals(result.raw, wellFormedResponse);
});

Deno.test("AgentRunner handles empty user prompt", async () => {
  const emptyRequest: IParsedRequest = {
    userPrompt: "",
    context: {},
  };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, emptyRequest);

  assertExists(result);
  assertEquals(result.raw, wellFormedResponse);
});

Deno.test("AgentRunner handles both empty prompts", async () => {
  const emptyBlueprint: IBlueprint = { systemPrompt: "" };
  const emptyRequest: IParsedRequest = { userPrompt: "", context: {} };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(emptyBlueprint, emptyRequest);

  assertExists(result);
  assertEquals(result.raw, wellFormedResponse);
});

Deno.test("AgentRunner handles whitespace-only prompts", async () => {
  const whitespaceBlueprint: IBlueprint = { systemPrompt: "   \n\t  " };
  const whitespaceRequest: IParsedRequest = { userPrompt: "  \n  ", context: {} };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(whitespaceBlueprint, whitespaceRequest);

  assertExists(result);
});

// ============================================================================
// Additional Edge Cases
// ============================================================================

Deno.test("AgentRunner handles very long responses", async () => {
  const longThought = "a".repeat(10000);
  const longContent = "b".repeat(10000);
  const response = `<thought>${longThought}</thought>
<content>${longContent}</content>`;

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertEquals(result.thought.trim(), longThought);
  assertEquals(result.content.trim(), longContent);
});

Deno.test("AgentRunner handles special characters in response", async () => {
  const response = `<thought>
Special chars: <>&"'
Unicode: 你好 🎉
Newlines and tabs:\t\n
</thought>
<content>
More special: <>&"'
</content>`;

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertStringIncludes(result.thought, "Special chars: <>&\"'");
  assertStringIncludes(result.thought, "你好 🎉");
  assertStringIncludes(result.content, "More special: <>&\"'");
});

Deno.test("AgentRunner returns IAgentExecutionResult with correct structure", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  // Verify result has the correct structure
  assertExists(result.thought);
  assertExists(result.content);
  assertExists(result.raw);
  assertEquals(typeof result.thought, "string");
  assertEquals(typeof result.content, "string");
  assertEquals(typeof result.raw, "string");
});

Deno.test("AgentRunner can be reused for multiple runs", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  // Run multiple times
  const result1 = await runner.run(sampleBlueprint, sampleRequest);
  const result2 = await runner.run(sampleBlueprint, sampleRequest);
  const result3 = await runner.run(sampleBlueprint, sampleRequest);

  // All should succeed
  assertExists(result1);
  assertExists(result2);
  assertExists(result3);
});

// ============================================================================
// Error Recovery and Handling
// ============================================================================

Deno.test("AgentRunner handles provider errors gracefully", async () => {
  const errorProvider = new MockProvider(wellFormedResponse);
  errorProvider.generate = (): Promise<IGenerateResult> => {
    return Promise.reject(new Error("API Error: Rate limit exceeded"));
  };

  const runner = new AgentRunner(errorProvider);

  let errorCaught = false;
  let errorMessage = "";

  try {
    await runner.run(sampleBlueprint, sampleRequest);
  } catch (error) {
    errorCaught = true;
    errorMessage = (error as Error).message;
  }

  assertEquals(errorCaught, true);
  assertStringIncludes(errorMessage, "Rate limit exceeded");
});

Deno.test("AgentRunner handles network timeout errors", async () => {
  const timeoutProvider = new MockProvider(wellFormedResponse);
  timeoutProvider.generate = (): Promise<IGenerateResult> => {
    throw new Error("Network timeout");
  };

  const runner = new AgentRunner(timeoutProvider);

  let errorCaught = false;

  try {
    await runner.run(sampleBlueprint, sampleRequest);
  } catch (error) {
    errorCaught = true;
    assertEquals((error as Error).message, "Network timeout");
  }

  assertEquals(errorCaught, true);
});

Deno.test("AgentRunner handles JSON parse errors", async () => {
  const malformedProvider = new MockProvider(wellFormedResponse);
  malformedProvider.generate = (): Promise<IGenerateResult> => {
    throw new SyntaxError("Unexpected token in JSON");
  };

  const runner = new AgentRunner(malformedProvider);

  let errorCaught = false;

  try {
    await runner.run(sampleBlueprint, sampleRequest);
  } catch (error) {
    errorCaught = true;
    assertEquals(error instanceof SyntaxError, true);
  }

  assertEquals(errorCaught, true);
});

Deno.test("AgentRunner handles provider returning null", async () => {
  const nullProvider = new MockProvider(wellFormedResponse);
  nullProvider.generate = (): Promise<IGenerateResult> => {
    return Promise.resolve(null as never as IGenerateResult);
  };

  const runner = new AgentRunner(nullProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  // Should handle null gracefully (convert to empty string or fallback)
  assertExists(result);
});

Deno.test("AgentRunner handles provider returning undefined", async () => {
  const undefinedProvider = new MockProvider(wellFormedResponse);
  undefinedProvider.generate = (): Promise<IGenerateResult> => {
    return Promise.resolve(undefined as never as IGenerateResult);
  };

  const runner = new AgentRunner(undefinedProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  // Should handle undefined gracefully
  assertExists(result);
});

// ============================================================================
// Context Management
// ============================================================================

Deno.test("AgentRunner handles request with large context", async () => {
  const largeContext: IParsedRequest = {
    userPrompt: "Analyze these files",
    context: {
      file1: "x".repeat(100000),
      file2: "y".repeat(100000),
      file3: "z".repeat(100000),
    },
  };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, largeContext);

  assertExists(result);
  assertEquals(result.raw, wellFormedResponse);
});

Deno.test("AgentRunner handles request with nested context objects", async () => {
  const nestedContext: IParsedRequest = {
    userPrompt: "Process this data",
    context: {
      level1: {
        level2: {
          level3: {
            data: "deeply nested",
          },
        },
      },
    },
  };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, nestedContext);

  assertExists(result);
});

Deno.test("AgentRunner handles request with empty context", async () => {
  const emptyContext: IParsedRequest = {
    userPrompt: "Simple request",
    context: {},
  };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, emptyContext);

  assertExists(result);
});

Deno.test("AgentRunner handles request with many context keys", async () => {
  const manyKeysContext: IParsedRequest = {
    userPrompt: "Process all",
    context: Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [`key${i}`, `value${i}`]),
    ),
  };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, manyKeysContext);

  assertExists(result);
});

// ============================================================================
// Response Parsing Edge Cases
// ============================================================================

Deno.test("AgentRunner handles case-insensitive XML tags", async () => {
  const response = `<THOUGHT>Uppercase thought</THOUGHT>
<CONTENT>Uppercase content</CONTENT>`;

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  // Regex should be case-insensitive
  assertStringIncludes(result.thought, "Uppercase thought");
  assertStringIncludes(result.content, "Uppercase content");
});

Deno.test("AgentRunner handles mixed case XML tags", async () => {
  const response = `<Thought>Mixed case thought</Thought>
<Content>Mixed case content</Content>`;

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertStringIncludes(result.thought, "Mixed case thought");
  assertStringIncludes(result.content, "Mixed case content");
});

Deno.test("AgentRunner handles tags with extra whitespace", async () => {
  const response = `<thought>
  Thought with whitespace
  </thought>
  <content>
  Content with whitespace
  </content>`;

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  // trim() should handle whitespace
  assertStringIncludes(result.thought, "Thought with whitespace");
  assertStringIncludes(result.content, "Content with whitespace");
});

Deno.test("AgentRunner handles CDATA sections in tags", async () => {
  const response = `<thought><![CDATA[Thought with <special> chars]]></thought>
<content><![CDATA[Content with <tags>]]></content>`;

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  // Should extract CDATA content
  assertExists(result.thought);
  assertExists(result.content);
});

Deno.test("AgentRunner handles self-closing tags", async () => {
  const response = `<thought/>
<content>Only content here</content>`;

  const mockProvider = new MockProvider(response);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  // Self-closing tags should result in empty thought
  assertStringIncludes(result.content, "Only content here");
});

// ============================================================================
// IBlueprint and Request Variations
// ============================================================================

Deno.test("AgentRunner handles blueprint with identityId", async () => {
  const blueprintWithId: IBlueprint = {
    systemPrompt: "You are an assistant",
    identityId: "test-agent-001",
  };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(blueprintWithId, sampleRequest);

  assertExists(result);
});

Deno.test("AgentRunner handles request with traceId and requestId", async () => {
  const requestWithIds: IParsedRequest = {
    userPrompt: "Test prompt",
    context: {},
    traceId: "trace-123",
    requestId: "req-456",
  };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, requestWithIds);

  assertExists(result);
});

Deno.test("AgentRunner handles very long system prompt", async () => {
  const longBlueprint: IBlueprint = {
    systemPrompt: "You are an assistant. " + "Rules: ".repeat(10000),
  };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(longBlueprint, sampleRequest);

  assertExists(result);
});

Deno.test("AgentRunner handles very long user prompt", async () => {
  const longRequest: IParsedRequest = {
    userPrompt: "Please analyze this: " + "data ".repeat(50000),
    context: {},
  };

  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, longRequest);

  assertExists(result);
});

// ============================================================================
// Phase 17: Skills Integration Tests
// ============================================================================

/**
 * Mock SkillsService for testing
 */
class MockSkillsService implements ISkillsService {
  matchedSkills: ISkillMatch[] = [];
  skillContext = "";
  usageRecorded: string[] = [];
  matchCallCount = 0;
  contextBuiltForSkills: string[] = [];

  setMatchedSkills(skills: ISkillMatch[]) {
    this.matchedSkills = skills;
  }

  setSkillContext(context: string) {
    this.skillContext = context;
  }

  matchSkills(
    _request: ISkillMatchRequest,
  ): Promise<ISkillMatch[]> {
    this.matchCallCount++;
    return Promise.resolve(this.matchedSkills);
  }

  buildSkillContext(skillIds: string[]): Promise<string> {
    this.contextBuiltForSkills = skillIds;
    if (skillIds.length === 0) return Promise.resolve("");
    return Promise.resolve(this.skillContext);
  }

  recordSkillUsage(skillId: string): Promise<void> {
    this.usageRecorded.push(skillId);
    return Promise.resolve();
  }

  private createSkillRecord(skillDef: SkillDefinition, skillId: string): ISkill {
    return {
      ...skillDef,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      usage_count: 0,
      skill_id: skillId,
      source: MemoryBankSource.CORE,
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
    };
  }

  deriveSkillFromLearnings(
    _learningIds: string[],
    skillDef: SkillDefinition,
  ): Promise<ISkill> {
    return Promise.resolve(this.createSkillRecord(skillDef, "derived"));
  }

  rebuildIndex(): Promise<void> {
    return Promise.resolve();
  }

  listSkills(): Promise<ISkill[]> {
    return Promise.resolve([]);
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  createSkill(
    skillDef: SkillDefinition,
  ): Promise<ISkill> {
    return Promise.resolve(this.createSkillRecord(skillDef, "created"));
  }

  getSkill(_id: string): Promise<ISkill | null> {
    return Promise.resolve(null);
  }

  deleteSkill(_id: string): Promise<boolean> {
    return Promise.resolve(true);
  }
}

Deno.test("AgentRunner: matches skills when skillsService provided", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const mockSkills = new MockSkillsService();
  mockSkills.setMatchedSkills([
    { skillId: "tdd-methodology", confidence: 0.85, matchedTriggers: { keywords: ["create"] } },
  ]);
  mockSkills.setSkillContext("## Skill: TDD Methodology\n\nAlways write tests first.");

  const runner = new AgentRunner(mockProvider, {
    skillsService: mockSkills,
  });

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertExists(result);
  assertEquals(mockSkills.matchCallCount, 1);
  assertEquals(result.skillsApplied, ["tdd-methodology"]);
});

Deno.test("AgentRunner: injects skill context into prompt", async () => {
  let capturedPrompt = "";
  const mockProvider = new MockProvider(wellFormedResponse);
  const originalGenerate = mockProvider.generate.bind(mockProvider);
  mockProvider.generate = async (prompt: string) => {
    capturedPrompt = prompt;
    return await originalGenerate(prompt);
  };

  const mockSkills = new MockSkillsService();
  mockSkills.setMatchedSkills([
    { skillId: "security-first", confidence: 0.9, matchedTriggers: {} },
  ]);
  mockSkills.setSkillContext("## Skill: Security First\n\nAlways validate input.");

  const runner = new AgentRunner(mockProvider, {
    skillsService: mockSkills,
  });

  await runner.run(sampleBlueprint, sampleRequest);

  assertStringIncludes(capturedPrompt, "## Skill: Security First");
  assertStringIncludes(capturedPrompt, "Always validate input");
});

Deno.test("AgentRunner: records skill usage after execution", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const mockSkills = new MockSkillsService();
  mockSkills.setMatchedSkills([
    { skillId: "tdd-methodology", confidence: 0.8, matchedTriggers: {} },
    { skillId: "error-handling", confidence: 0.7, matchedTriggers: {} },
  ]);
  mockSkills.setSkillContext("Skills context");

  const runner = new AgentRunner(mockProvider, {
    skillsService: mockSkills,
  });

  await runner.run(sampleBlueprint, sampleRequest);

  assertEquals(mockSkills.usageRecorded.length, 2);
  assertEquals(mockSkills.usageRecorded.includes("tdd-methodology"), true);
  assertEquals(mockSkills.usageRecorded.includes("error-handling"), true);
});

Deno.test("AgentRunner: skips skill matching when disableSkills is true", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const mockSkills = new MockSkillsService();
  mockSkills.setMatchedSkills([
    { skillId: "tdd-methodology", confidence: 0.8, matchedTriggers: {} },
  ]);

  const runner = new AgentRunner(mockProvider, {
    skillsService: mockSkills,
    disableSkills: true,
  });

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertExists(result);
  assertEquals(mockSkills.matchCallCount, 0);
  assertEquals(result.skillsApplied, undefined);
});

Deno.test("AgentRunner: continues without skills when no skillsService", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(mockProvider);

  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertExists(result);
  assertEquals(result.skillsApplied, undefined);
});

Deno.test("AgentRunner: handles skill matching error gracefully", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);

  // Create a skill service that throws
  const errorSkills = {
    matchSkills() {
      throw new Error("Skill matching failed");
    },
  };

  const runner = new AgentRunner(mockProvider, {
    skillsService: errorSkills as Partial<ISkillsService> as ISkillsService,
  });

  // Should not throw, should continue without skills
  const result = await runner.run(sampleBlueprint, sampleRequest);

  assertExists(result);
  assertEquals(result.skillsApplied, undefined);
});

Deno.test("AgentRunner: uses blueprint defaultSkills when no trigger matches", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const mockSkills = new MockSkillsService();

  // No trigger matches - returns empty
  mockSkills.setMatchedSkills([]);
  mockSkills.setSkillContext("## IBlueprint Default Skill\nDefault instructions");

  const runner = new AgentRunner(mockProvider, {
    skillsService: mockSkills,
  });

  // IBlueprint with defaultSkills
  const blueprintWithDefaults: IBlueprint = {
    systemPrompt: "You are a helpful assistant.",
    identityId: "test-agent",
    defaultSkills: ["default-skill-1", "default-skill-2"],
  };

  const result = await runner.run(blueprintWithDefaults, sampleRequest);

  assertExists(result);
  // Should use blueprint default skills since no triggers matched
  assertEquals(result.skillsApplied, ["default-skill-1", "default-skill-2"]);
  // Verify buildSkillContext was called with the default skills
  assertEquals(mockSkills.contextBuiltForSkills, ["default-skill-1", "default-skill-2"]);
});

Deno.test("AgentRunner: trigger matches override blueprint defaultSkills", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const mockSkills = new MockSkillsService();

  // Trigger match found
  mockSkills.setMatchedSkills([
    { skillId: "matched-skill", confidence: 0.9, matchedTriggers: { keywords: ["test"] } },
  ]);
  mockSkills.setSkillContext("## Matched Skill\nMatched instructions");

  const runner = new AgentRunner(mockProvider, {
    skillsService: mockSkills,
  });

  // IBlueprint with defaultSkills
  const blueprintWithDefaults: IBlueprint = {
    systemPrompt: "You are a helpful assistant.",
    identityId: "test-agent",
    defaultSkills: ["default-skill-1"],
  };

  const result = await runner.run(blueprintWithDefaults, sampleRequest);

  assertExists(result);
  // Should use matched skill, NOT default
  assertEquals(result.skillsApplied, ["matched-skill"]);
});

Deno.test("AgentRunner: request-level skills override trigger matches", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const mockSkills = new MockSkillsService();

  // Trigger match would return these
  mockSkills.setMatchedSkills([
    { skillId: "matched-skill", confidence: 0.9, matchedTriggers: { keywords: ["test"] } },
  ]);
  mockSkills.setSkillContext("## Request Skill\nRequest instructions");

  const runner = new AgentRunner(mockProvider, {
    skillsService: mockSkills,
  });

  // Request with explicit skills
  const requestWithSkills: IParsedRequest = {
    userPrompt: "Do something",
    context: {},
    skills: ["explicit-skill-1", "explicit-skill-2"],
  };

  const result = await runner.run(sampleBlueprint, requestWithSkills);

  assertExists(result);
  // Should use request explicit skills, NOT trigger matches
  assertEquals(result.skillsApplied, ["explicit-skill-1", "explicit-skill-2"]);
  // matchSkills should not be called when explicit skills are provided
  assertEquals(mockSkills.matchCallCount, 0);
});

Deno.test("AgentRunner: skipSkills filters out matched skills", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const mockSkills = new MockSkillsService();

  // Trigger matches return multiple skills
  mockSkills.setMatchedSkills([
    { skillId: "skill-a", confidence: 0.9, matchedTriggers: { keywords: ["test"] } },
    { skillId: "skill-b", confidence: 0.8, matchedTriggers: { keywords: ["test"] } },
    { skillId: "skill-c", confidence: 0.7, matchedTriggers: { keywords: ["test"] } },
  ]);
  mockSkills.setSkillContext("## Filtered Skills\nSome instructions");

  const runner = new AgentRunner(mockProvider, {
    skillsService: mockSkills,
  });

  // Request that skips some skills
  const requestWithSkipSkills: IParsedRequest = {
    userPrompt: "Do something",
    context: {},
    skipSkills: ["skill-b"],
  };

  const result = await runner.run(sampleBlueprint, requestWithSkipSkills);

  assertExists(result);
  // skill-b should be filtered out
  assertEquals(result.skillsApplied, ["skill-a", "skill-c"]);
});

Deno.test("AgentRunner: skipSkills with explicit skills", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const mockSkills = new MockSkillsService();
  mockSkills.setSkillContext("## Skills\nInstructions");

  const runner = new AgentRunner(mockProvider, {
    skillsService: mockSkills,
  });

  // Request with both explicit skills and skip
  const requestWithBoth: IParsedRequest = {
    userPrompt: "Do something",
    context: {},
    skills: ["skill-x", "skill-y", "skill-z"],
    skipSkills: ["skill-y"],
  };

  const result = await runner.run(sampleBlueprint, requestWithBoth);

  assertExists(result);
  // skill-y should be filtered out from explicit list
  assertEquals(result.skillsApplied, ["skill-x", "skill-z"]);
});
