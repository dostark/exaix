/**
 * @module LlmClientOptionsForwardingTest
 * @path packages/ai/tests/llm_client_options_forwarding_test.ts
 * @description Phase 132.5 — verifies reasonNextAction forwards per-call options to provider.generate().
 * @architectural-layer AI
 * @related-files [packages/ai/src/llm_client.ts]
 */
import { assertEquals } from "@std/assert";
import { LlmClient } from "../src/llm_client.ts";
import type { IBlueprintFrontmatter } from "@exaix/schemas";
import type { IModelProvider } from "../src/types.ts";
import type { IGenerateResult } from "../src/providers/common.ts";

interface ICaptureOptions {
  thinking?: boolean;
  effort?: string;
  max_tokens?: number;
}

const mockAgentRole: IBlueprintFrontmatter = {
  agent_role: "test",
  name: "Test Agent",
  model: "mock:test",
  description: "test description",
  created: new Date().toISOString(),
  created_by: "system",
  version: "1.0.0",
  capabilities: [],
};

const mockTools = [
  { name: "read_file", description: "Read a file", inputSchema: {} },
];

let lastGenerateOptions: ICaptureOptions | undefined;

const capturingProvider: IModelProvider = {
  id: "capture",
  generate(_prompt: string, _options?: ICaptureOptions): Promise<IGenerateResult> {
    lastGenerateOptions = _options;
    return Promise.resolve({
      content: '{"reasoning":"done","action":{"type":"complete","output":"ok"}}',
      model: "test",
      provider: "mock",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  },
};

Deno.test("[step132.5] reasonNextAction forwards thinking=true to provider.generate()", async () => {
  lastGenerateOptions = undefined;
  const client = new LlmClient(undefined, capturingProvider);
  await client.reasonNextAction({
    agent_role: mockAgentRole,
    stepObjective: "test",
    accumulatedContext: "",
    availableTools: mockTools as never,
    iteration: 1,
    maxIterations: 3,
    options: { thinking: true, effort: "high", max_tokens: 8192 },
  });
  assertEquals(lastGenerateOptions!.thinking, true);
  assertEquals(lastGenerateOptions!.effort, "high");
  assertEquals(lastGenerateOptions!.max_tokens, 8192);
});

Deno.test("[step132.5] reasonNextAction with undefined options is backward compat", async () => {
  lastGenerateOptions = undefined;
  const client = new LlmClient(undefined, capturingProvider);
  await client.reasonNextAction({
    agent_role: mockAgentRole,
    stepObjective: "test",
    accumulatedContext: "",
    availableTools: mockTools as never,
    iteration: 1,
    maxIterations: 3,
    options: undefined,
  });
  assertEquals(lastGenerateOptions, undefined);
});

Deno.test("[step132.5] reasonNextAction with no options field is backward compat", async () => {
  lastGenerateOptions = undefined;
  const client = new LlmClient(undefined, capturingProvider);
  await client.reasonNextAction({
    agent_role: mockAgentRole,
    stepObjective: "test",
    accumulatedContext: "",
    availableTools: mockTools as never,
    iteration: 1,
    maxIterations: 3,
  });
  assertEquals(lastGenerateOptions, undefined);
});
