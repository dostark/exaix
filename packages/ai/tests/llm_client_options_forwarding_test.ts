/**
 * @module LlmClientOptionsForwardingTest
 * @path packages/ai/tests/llm_client_options_forwarding_test.ts
 * @description Phase 132.5 — verifies reasonNextAction forwards per-call options to provider.generate().
 * @architectural-layer AI
 * @related-files [packages/ai/src/llm_client.ts]
 */
import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { EffortResolver } from "../src/effort_resolver.ts";
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
  generate(_prompt: string, _options?: Opt<ICaptureOptions, Reason.OptionalInput>): Promise<IGenerateResult> {
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

for (const supportsThinking of [true, false]) {
  Deno.test(`LlmClient uses per-model thinking ${supportsThinking} for the selected model`, async () => {
    const models: string[] = [];
    const observed: boolean[] = [];
    using _metadata = stub(ProviderRegistry, "getMetadataForInstance", () => ({
      name: "openrouter",
      description: "fixture",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      supportsThinking: !supportsThinking,
      modelInfo: (model: string) => {
        models.push(model);
        return Promise.resolve({ supportsThinking });
      },
    }));
    const resolve = EffortResolver.prototype.resolve;
    using _resolve = stub(EffortResolver.prototype, "resolve", function (declarations, signals) {
      observed.push(signals.providerSupportsThinking);
      return resolve.call(this, declarations, signals);
    });
    const client = new LlmClient(undefined, capturingProvider);
    await client.reasonNextAction({
      agent_role: { ...mockAgentRole, model: "openrouter:vendor/catalog-model", thinking: "auto" },
      stepObjective: "test",
      accumulatedContext: "",
      availableTools: mockTools as never,
      iteration: 1,
      maxIterations: 3,
    });
    assertEquals(observed, [supportsThinking]);
    assertEquals(models, ["vendor/catalog-model"]);
  });
}
