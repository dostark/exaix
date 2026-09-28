/**
 * @module LlmClientNativeToolsTest
 * @path packages/ai/tests/llm_client_native_tools_test.ts
 * @description Verifies native tool decisions and immutable dynamic conversation prompts.
 * @architectural-layer AI
 * @related-files [packages/ai/src/llm_client.ts, packages/ai/src/types.ts]
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { McpToolName } from "@exaix/core";
import type { IBlueprintFrontmatter } from "@exaix/schemas";
import { LlmClient } from "../src/llm_client.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";
import type { IModelOptions, IModelProvider } from "../src/types.ts";
import type { IGenerateResult, IProviderToolCall } from "@exaix/ai/providers";
import { ContextBudgetExceededError } from "@exaix/core/errors";
import type { PromptBudgetAllocator } from "@exaix/core";

const role: IBlueprintFrontmatter = {
  agent_role: "reader",
  name: "Reader",
  description: "Read-only investigator",
  model: "test:model",
  created: "2026-01-01",
  created_by: "test",
  version: "1.0.0",
  capabilities: [],
};

class NativeProvider implements IModelProvider {
  id = "openai-compatible-test-model-v1";
  calls: Array<{ prompt: string; options?: IModelOptions }> = [];
  toolCalls?: IProviderToolCall[];
  content = "";
  costStatus?: "estimated" | "tracked" | "unknown";

  generate(prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    this.calls.push({ prompt, options });
    return Promise.resolve({
      content: this.content,
      toolCalls: this.toolCalls,
      usage: { promptTokens: 8, completionTokens: 3, totalTokens: 11 },
      model: "test-model",
      provider: "openai-compatible-test",
      costStatus: this.costStatus,
    });
  }
}

ProviderRegistry.registerWithMetadata("openai-compatible-test", {} as never, {
  supportsNativeTools: true,
  supportsNativeConversation: true,
} as never);

Deno.test("LlmClient native conversation preserves initial context and returns one effective tool call", async () => {
  const provider = new NativeProvider();
  provider.toolCalls = [{ id: "call-17", name: McpToolName.READ_FILE, input: { path: "src/a.ts" } }];
  provider.costStatus = "unknown";
  const client = new LlmClient(undefined, provider);
  const tools = [{ name: McpToolName.READ_FILE, description: "Read one file", inputSchema: { type: "object" } }];
  const nativeConversation = await client.createNativeConversation({
    agentRole: role,
    stepObjective: "Inspect the source",
    originalInput: "Start with src/a.ts",
    availableTools: tools,
  });

  const result = await client.reasonNextAction({
    agent_role: role,
    stepObjective: "Inspect the source",
    accumulatedContext: "Start with src/a.ts",
    availableTools: tools,
    iteration: 1,
    maxIterations: 4,
    nativeToolsEnabled: true,
    traceId: "trace-dynamic-1",
    nativeConversation,
  });

  assertEquals(result.done, false);
  assertEquals(result.tool, McpToolName.READ_FILE);
  assertEquals(result.args, { path: "src/a.ts" });
  assertEquals(result.nativeToolCall?.id, "call-17");
  assertEquals(result.costStatus, "unknown");
  assertEquals(result.cost_usd, undefined);
  assertEquals(provider.calls[0].options?.traceId, "trace-dynamic-1");
  assertEquals(provider.calls[0].options?.toolChoice, { type: "auto", disable_parallel_tool_use: true });
  assertEquals(provider.calls[0].options?.tools?.map((tool) => tool.name), [McpToolName.READ_FILE]);
  assertEquals(nativeConversation.measurement !== undefined && nativeConversation.measurement.totalTokens > 0, true);
  assertEquals(provider.calls[0].options?.effort, undefined);
  assertStringIncludes(provider.calls[0].prompt, "Start with src/a.ts");
  assertStringIncludes(provider.calls[0].options?.nativeConversation?.roundInstruction ?? "", "Iteration: 1 of 4");
  assertEquals(provider.calls[0].prompt.includes('"action"'), false);

  provider.toolCalls = undefined;
  provider.content = "The file is clean.";
  const secondSnapshot = {
    ...nativeConversation,
    turns: [{
      toolUseId: "call-17",
      toolName: McpToolName.READ_FILE,
      toolInput: { path: "src/a.ts" },
      toolResultContent: "source text",
      toolResultIsError: false,
    }],
  };
  const final = await client.reasonNextAction({
    agent_role: role,
    stepObjective: "Inspect the source",
    accumulatedContext: "This is not repeated in a native snapshot.",
    availableTools: tools,
    iteration: 2,
    maxIterations: 4,
    nativeToolsEnabled: true,
    traceId: "trace-dynamic-1",
    nativeConversation: secondSnapshot,
    flowStepEffort: "high",
  });
  assertEquals(final.done, true);
  assertEquals(provider.calls[1].prompt, provider.calls[0].prompt);
  assertEquals(provider.calls[1].options?.nativeConversation?.turns.length, 1);
  assertEquals(provider.calls[1].options?.effort, "high");
  assertStringIncludes(provider.calls[1].options?.nativeConversation?.roundInstruction ?? "", "Iteration: 2 of 4");
  assertEquals(provider.calls[1].options?.traceId, "trace-dynamic-1");
});

Deno.test("LlmClient rejects multiple or unknown native calls before returning a decision", async () => {
  const tools = [{ name: McpToolName.READ_FILE, description: "Read", inputSchema: {} }];
  const decide = async (toolCalls: IProviderToolCall[]) => {
    const provider = new NativeProvider();
    provider.toolCalls = toolCalls;
    const client = new LlmClient(undefined, provider);
    const nativeConversation = await client.createNativeConversation({
      agentRole: role,
      stepObjective: "Inspect",
      originalInput: "Inspect src/a.ts",
      availableTools: tools,
    });
    return await client.reasonNextAction({
      agent_role: role,
      stepObjective: "Inspect",
      accumulatedContext: "Inspect src/a.ts",
      availableTools: tools,
      iteration: 1,
      maxIterations: 2,
      nativeToolsEnabled: true,
      nativeConversation,
    });
  };
  await assertRejects(() =>
    decide([
      { id: "1", name: McpToolName.READ_FILE, input: {} },
      { id: "2", name: McpToolName.READ_FILE, input: {} },
    ]), Error);
  await assertRejects(() => decide([{ id: "1", name: "write_file", input: {} }]), Error);
});

Deno.test("LlmClient keeps the JSON envelope when native tools are absent", async () => {
  const provider = new NativeProvider();
  provider.content = JSON.stringify({ reasoning: "complete", action: { type: "complete", output: "done" } });
  const client = new LlmClient(undefined, provider);
  const result = await client.reasonNextAction({
    agent_role: role,
    stepObjective: "Inspect",
    accumulatedContext: "Original input and prior observations",
    availableTools: [{ name: McpToolName.READ_FILE, description: "Read", inputSchema: {} }],
    iteration: 1,
    maxIterations: 3,
  });
  assertEquals(result.done, true);
  assertEquals(provider.calls[0].options, undefined);
  assertStringIncludes(provider.calls[0].prompt, '"action"');
  assertStringIncludes(provider.calls[0].prompt, "Original input and prior observations");
});

Deno.test("LlmClient projects auto flow declarations and preserves explicit caller effort", async () => {
  const provider = new NativeProvider();
  provider.content = JSON.stringify({ reasoning: "complete", action: { type: "complete", output: "done" } });
  const client = new LlmClient(undefined, provider);
  const common = {
    stepObjective: "Inspect",
    accumulatedContext: "",
    availableTools: [],
    iteration: 1,
    maxIterations: 2,
  };
  await client.reasonNextAction({
    ...common,
    agent_role: { ...role, effort: "low" },
    flowStepEffort: "auto",
  });
  assertEquals(provider.calls[0].options?.effort, "medium");

  await client.reasonNextAction({
    ...common,
    agent_role: { ...role, effort: "low" },
    flowStepEffort: "low",
    options: { effort: "high" },
  });
  assertEquals(provider.calls[1].options?.effort, "high");
});

Deno.test("LlmClient rejects an over-budget native snapshot before provider generation", async () => {
  const provider = new NativeProvider();
  const allocator = {
    allocate: () =>
      Promise.resolve({
        model: "test-model",
        totalBudgetTokens: 1,
        safetyBufferTokens: 0,
        sections: { system: 1, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
      }),
  } as Pick<PromptBudgetAllocator, "allocate">;
  const tokenizer = {
    countTokens: (text: string) => Promise.resolve(text.length),
    countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((text) => text.length)),
  };
  const client = new LlmClient(undefined, provider, undefined, undefined, undefined, tokenizer, allocator);
  const tools = [{ name: McpToolName.READ_FILE, description: "Read", inputSchema: {} }];
  const snapshot = await client.createNativeConversation({
    agentRole: role,
    stepObjective: "Inspect",
    originalInput: "A long input that exceeds the tiny budget",
    availableTools: tools,
  });
  await assertRejects(() =>
    client.reasonNextAction({
      agent_role: role,
      stepObjective: "Inspect",
      accumulatedContext: "A long input that exceeds the tiny budget",
      availableTools: tools,
      iteration: 1,
      maxIterations: 2,
      nativeToolsEnabled: true,
      nativeConversation: snapshot,
    }), ContextBudgetExceededError);
  assertEquals(provider.calls.length, 0);
});
