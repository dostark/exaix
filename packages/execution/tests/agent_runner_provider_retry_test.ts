/**
 * @module AgentRunnerProviderRetryTest
 * @path packages/execution/tests/agent_runner_provider_retry_test.ts
 * @description The provider layer owns HTTP retries. AgentRunner's outer policy does not retry an error that the
 *   provider layer already classified, so a sustained 503 costs exactly the provider's maxRetries HTTP calls.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_runner.ts, packages/ai/src/providers/base_provider.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import { performProviderCall } from "@exaix/ai/provider_common_utils.ts";
import { BaseProvider, type IGenerateResult, ModelProviderError } from "@exaix/ai/providers";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "@exaix/execution";

const blueprint: IBlueprint = { systemPrompt: "Answer the request." };
const request: IParsedRequest = { userPrompt: "Say hi.", context: {} };
const PROVIDER_MAX_RETRIES = 3;
const FAST_RETRY = { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 2, backoffMultiplier: 1, jitterFactor: 0 };

/** A real BaseProvider that sends every call to the faked fetch through the shared provider call path. */
class HttpProvider extends BaseProvider {
  constructor() {
    super({ apiKey: "sk-test", model: "m", maxRetries: PROVIDER_MAX_RETRIES, retryDelayMs: 1 }, "http-test");
  }

  protected attemptGenerate(): Promise<IGenerateResult> {
    return performProviderCall<{ choices: Array<{ message: { content: string } }> }>(
      "https://provider.test/v1/chat",
      { method: "POST", body: "{}" },
      { id: this.id, maxAttempts: this.maxRetries, backoffBaseMs: this.retryDelayMs },
    );
  }
}

async function countFetches(status: number, run: () => Promise<unknown>): Promise<number> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(new Response("{}", { status }));
  }) as typeof fetch;
  try {
    await assertRejects(run);
    return calls;
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("a sustained 503 through AgentRunner makes exactly the provider's maxRetries HTTP calls", async () => {
  const runner = new AgentRunner(new HttpProvider(), { retryPolicy: FAST_RETRY, disableSkills: true });
  const calls = await countFetches(503, () => runner.run(blueprint, request, undefined));
  assertEquals(calls, PROVIDER_MAX_RETRIES);
});

Deno.test("a ModelProviderError whose message contains 500 is not retried by AgentRunner", async () => {
  let calls = 0;
  const provider = new MockProvider("unused");
  provider.generate = () => {
    calls++;
    return Promise.reject(new ModelProviderError("HTTP 400 invalid request, error 500 try again", "mock"));
  };
  const runner = new AgentRunner(provider, { retryPolicy: FAST_RETRY, disableSkills: true });
  await assertRejects(() => runner.run(blueprint, request, undefined), ModelProviderError);
  assertEquals(calls, 1);
});

Deno.test("a non-provider error from generate (a plain Error) is still retried by AgentRunner", async () => {
  let calls = 0;
  const provider = new MockProvider("<thought>t</thought><content>ok</content>");
  const generate = provider.generate.bind(provider);
  provider.generate = (prompt, options) => {
    calls++;
    return calls === 1 ? Promise.reject(new Error("network error")) : generate(prompt, options);
  };
  const runner = new AgentRunner(provider, { retryPolicy: FAST_RETRY, disableSkills: true });
  const result = await runner.run(blueprint, request, undefined);
  assertEquals(result.content, "ok");
  assertEquals(calls, 2);
});
