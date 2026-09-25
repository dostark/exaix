/**
 * @module AgentRunnerEffortResolutionTest
 * @path packages/execution/tests/agent_runner_effort_resolution_test.ts
 * @description Integration test (GAP-1) proving the plan-generation slice: a real
 *   AgentRunner resolves a blueprint's declaration-time effort/thinking "auto" through
 *   EffortResolver before building IGenerationHints, and the concrete value reaches the
 *   provider's generate() options. The provider identity is normalized from a compound
 *   selectedModel id via resolveProviderType, so a claude-cli planning provider resolves
 *   effort heuristically (COMPLEX -> high) and an Anthropic adaptive model defers thinking
 *   natively (field omitted).
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_runner.ts, packages/ai/src/effort_resolver.ts]
 */

import { assertEquals } from "@std/assert";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { AgentRunner } from "@exaix/execution";
import type { IBlueprint, IParsedRequest } from "@exaix/execution";
import { TaskComplexity } from "@exaix/core";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";

function makeCapturingProvider(): {
  provider: IModelProvider;
  options: IModelOptions[];
} {
  const options: IModelOptions[] = [];
  const provider: IModelProvider = {
    id: "capturing-mock",
    generate(_prompt: string, opts?: IModelOptions): Promise<IGenerateResult> {
      options.push(opts ?? {});
      return Promise.resolve({
        content: WELL_FORMED_RESPONSE,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "capturing-mock",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  return { provider, options };
}

async function runResolved(
  blueprint: Partial<IBlueprint>,
  request: Partial<IParsedRequest>,
  selectedModel?: { provider: string; model: string },
): Promise<IModelOptions[]> {
  const { provider, options } = makeCapturingProvider();
  const runner = new AgentRunner(provider, {
    selectedModel,
    disableRetry: true,
  });
  await runner.run(
    { systemPrompt: "You are a test agent.", ...blueprint },
    { userPrompt: "Do the thing.", context: {}, ...request },
    undefined,
  );
  return options;
}

Deno.test("[AgentRunner] effort: auto + COMPLEX + claude-cli planning provider resolves to high at generate()", async () => {
  const options = await runResolved(
    { effort: "auto" },
    { taskComplexity: TaskComplexity.COMPLEX, taskComplexitySource: "analysis" },
    { provider: "claude-cli-sonnet", model: "sonnet" },
  );
  assertEquals(options.length, 1);
  assertEquals(options[0].effort, "high");
});

Deno.test("[AgentRunner] effort: auto + SIMPLE + claude-cli planning provider resolves to low at generate()", async () => {
  const options = await runResolved(
    { effort: "auto" },
    { taskComplexity: TaskComplexity.SIMPLE, taskComplexitySource: "analysis" },
    { provider: "claude-cli-sonnet", model: "sonnet" },
  );
  assertEquals(options[0].effort, "low");
});

Deno.test("[AgentRunner] thinking: auto + anthropic-claude-sonnet-5 omits the thinking field at generate()", async () => {
  const options = await runResolved(
    { thinking: "auto" },
    { taskComplexity: TaskComplexity.COMPLEX, taskComplexitySource: "analysis" },
    { provider: "anthropic-claude-sonnet-5", model: "claude-sonnet-5" },
  );
  assertEquals(options.length, 1);
  assertEquals("thinking" in options[0], false, "native-adaptive auto must omit the thinking field");
});

Deno.test("[AgentRunner] a concrete blueprint effort passes through unchanged (basis declared)", async () => {
  const options = await runResolved(
    { effort: "low" },
    { taskComplexity: TaskComplexity.COMPLEX, taskComplexitySource: "analysis" },
    { provider: "claude-cli-sonnet", model: "sonnet" },
  );
  assertEquals(options[0].effort, "low");
});
