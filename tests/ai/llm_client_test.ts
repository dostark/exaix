/**
 * @module LlmClientTest
 * @path tests/ai/llm_client_test.ts
 * @description Unit tests for ReAct reasoning logic in LlmClient.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { LlmClient } from "../../src/ai/llm_client.ts";
import { IBlueprintFrontmatter } from "../../src/shared/schemas/blueprint.ts";
import { McpToolName, ToolName } from "../../src/shared/enums.ts";
import { ModelFactory } from "../../src/ai/providers.ts";
import { IModelProvider } from "../../src/ai/types.ts";

const mockIdentity: IBlueprintFrontmatter = {
  identity_id: "test",
  name: "Test Agent",
  model: "mock:test",
  description: "test description",
  created: new Date().toISOString(),
  created_by: "system",
  version: "1.0.0",
  capabilities: [],
};

const mockTools = [
  {
    name: "read_file",
    description: "Read a file",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
];

// Simple Mock Provider to control response
class TestProvider implements IModelProvider {
  public id = "test-provider";
  public lastPrompt = "";

  constructor(public mockResponse: string) {}

  async generate(prompt: string): Promise<string> {
    this.lastPrompt = prompt;
    await Promise.resolve();
    return this.mockResponse;
  }
}

// Intercept ModelFactory.create via a property descriptor (avoids cast violations)
const originalDescriptor = Object.getOwnPropertyDescriptor(ModelFactory, "create")!;
let currentProvider: TestProvider;

function injectMockProvider(response: string) {
  currentProvider = new TestProvider(response);
  Object.defineProperty(ModelFactory, "create", {
    value: async () => {
      await Promise.resolve();
      return currentProvider;
    },
    writable: true,
    configurable: true,
  });
}

function restoreMockProvider() {
  Object.defineProperty(ModelFactory, "create", originalDescriptor);
}

Deno.test("LlmClient - builds correct reasoning prompt and handles valid tool_call", async () => {
  injectMockProvider(JSON.stringify({
    reasoning: "I need to read the file",
    action: {
      type: "tool_call",
      tool: "read_file",
      args: { path: "src/main.ts" },
    },
  }));

  const client = new LlmClient();
  const result = await client.reasonNextAction({
    identity: mockIdentity,
    stepObjective: "Test Objective",
    accumulatedContext: "Context Data",
    availableTools: mockTools,
    iteration: 2,
    maxIterations: 10,
  });

  assertEquals(result.done, false);
  assertEquals(result.tool, McpToolName.READ_FILE);
  assertEquals(result.args, { path: "src/main.ts" });

  const prompt = currentProvider.lastPrompt;
  assertEquals(prompt.includes("Test Agent"), true);
  assertEquals(prompt.includes("test description"), true);
  assertEquals(prompt.includes("Test Objective"), true);
  assertEquals(prompt.includes("Context Data"), true);
  assertEquals(prompt.includes("Iteration: 2 of 10"), true);
  assertEquals(prompt.includes("read_file"), true);
  assertEquals(prompt.includes('"path":{"type":"string"}'), true);

  restoreMockProvider();
});

Deno.test("LlmClient - handles complete action", async () => {
  injectMockProvider(JSON.stringify({
    reasoning: "I am done",
    action: {
      type: "complete",
      output: "Final answer",
    },
  }));

  const client = new LlmClient();
  const result = await client.reasonNextAction({
    identity: mockIdentity,
    stepObjective: "Test Objective",
    accumulatedContext: "",
    availableTools: [],
    iteration: 1,
    maxIterations: 10,
  });

  assertEquals(result.done, true);
  assertEquals(result.output, "Final answer");

  restoreMockProvider();
});

Deno.test("LlmClient - parses code blocks containing JSON", async () => {
  injectMockProvider(
    "```json\n" + JSON.stringify({
      reasoning: "code block",
      action: { type: "tool_call", tool: ToolName.LIST_DIRECTORY, args: {} },
    }) + "\n```",
  );

  const client = new LlmClient();
  const result = await client.reasonNextAction({
    identity: mockIdentity,
    stepObjective: "Test",
    accumulatedContext: "",
    availableTools: [
      { name: ToolName.LIST_DIRECTORY, description: "List dir", inputSchema: {} },
    ],
    iteration: 1,
    maxIterations: 10,
  });

  assertEquals(result.tool, McpToolName.LIST_DIRECTORY);

  restoreMockProvider();
});

Deno.test("LlmClient - handles invalid JSON", async () => {
  injectMockProvider("This is not JSON");

  const client = new LlmClient();
  await assertRejects(
    () =>
      client.reasonNextAction({
        identity: mockIdentity,
        stepObjective: "Test",
        accumulatedContext: "",
        availableTools: [],
        iteration: 1,
        maxIterations: 10,
      }),
    Error,
    "Failed to parse LLM response",
  );

  restoreMockProvider();
});
