/**
 * @module LlmClientTest
 * @path packages/ai/tests/llm_client_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Unit tests for ReAct reasoning logic in LlmClient.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { LlmClient } from "../src/llm_client.ts";
import type { IBlueprintFrontmatter } from "@exaix/schemas";

import { McpToolName, ToolName } from "@exaix/core";
import type { IModelProvider } from "../src/types.ts";
import type { IGenerateResult } from "../src/providers/common.ts";

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

  async generate(prompt: string): Promise<IGenerateResult> {
    this.lastPrompt = prompt;
    await Promise.resolve();
    return {
      content: this.mockResponse,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "test-model",
      provider: "mock",
      cost_usd: 0,
    };
  }
}

function makeClient(response: string): LlmClient {
  return new LlmClient(undefined, new TestProvider(response));
}

Deno.test("LlmClient - builds correct reasoning prompt and handles valid tool_call", async () => {
  const mockResponse = JSON.stringify({
    reasoning: "I need to read the file",
    action: {
      type: "tool_call",
      tool: "read_file",
      args: { path: "src/main.ts" },
    },
  });

  const provider = new TestProvider(mockResponse);
  const client = new LlmClient(undefined, provider);
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

  const prompt = provider.lastPrompt;
  assertEquals(prompt.includes("Test Agent"), true);
  assertEquals(prompt.includes("test description"), true);
  assertEquals(prompt.includes("Test Objective"), true);
  assertEquals(prompt.includes("Context Data"), true);
  assertEquals(prompt.includes("Iteration: 2 of 10"), true);
  assertEquals(prompt.includes("read_file"), true);
  assertEquals(prompt.includes('"path":{"type":"string"}'), true);
});

Deno.test("LlmClient - handles complete action", async () => {
  const client = makeClient(JSON.stringify({
    reasoning: "I am done",
    action: {
      type: "complete",
      output: "Final answer",
    },
  }));

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
});

Deno.test("LlmClient - parses code blocks containing JSON", async () => {
  const client = makeClient(
    "```json\n" + JSON.stringify({
      reasoning: "code block",
      action: { type: "tool_call", tool: ToolName.LIST_DIRECTORY, args: {} },
    }) + "\n```",
  );

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
});

Deno.test("LlmClient - handles invalid JSON", async () => {
  const client = makeClient("This is not JSON");

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
});
