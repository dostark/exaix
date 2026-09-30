/**
 * @module AgentRunnerWithProviderTest
 * @path packages/execution/tests/agent_runner_with_provider_test.ts
 * @description Checks per-step provider siblings preserve the original runner.
 */

import { assertEquals } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "@exaix/execution";

const blueprint: IBlueprint = { systemPrompt: "Answer the request." };
const request: IParsedRequest = { userPrompt: "Which provider?", context: {} };

Deno.test("withProvider routes a sibling runner to its bound provider without changing the original", async () => {
  const boot = new MockProvider("<thought>boot</thought><content>boot</content>");
  const bound = new MockProvider("<thought>bound</thought><content>bound</content>");
  let bootCalls = 0;
  let boundCalls = 0;
  const bootGenerate = boot.generate.bind(boot);
  const boundGenerate = bound.generate.bind(bound);
  boot.generate = async (prompt) => {
    bootCalls++;
    return await bootGenerate(prompt);
  };
  bound.generate = async (prompt) => {
    boundCalls++;
    return await boundGenerate(prompt);
  };
  const runner = new AgentRunner(boot);
  const sibling = runner.withProvider(bound, { provider: "mock", model: "bound-model" });
  assertEquals((await sibling.run(blueprint, request, undefined)).content, "bound");
  assertEquals((await runner.run(blueprint, request, undefined)).content, "boot");
  assertEquals(boundCalls, 1);
  assertEquals(bootCalls, 1);
});
