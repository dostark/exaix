/**
 * @module AgentRunnerSignatureCharacterizationTest
 * @path packages/execution/tests/agent_runner_signature_characterization_test.ts
 * @description Pins the prompt text and the attempt behavior of AgentRunner.run before and after the private run steps take named parameter groups: the prompt sent to the provider, the journal events of a run, and the retry and failure behavior of an attempt.
 * @architectural-layer Test
 * @related-files [packages/execution/src/agent_runner.ts, packages/execution/tests/agent_runner_prompt_event_test.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import { ModelProviderError } from "@exaix/ai/providers";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import { createCapturingLogger, type ICapturedEvent } from "@exaix/testing";

const blueprint: IBlueprint = { systemPrompt: "You are a careful reviewer.", agentRole: "qa-engineer" };
const request: IParsedRequest = {
  userPrompt: "Review the change.",
  context: {},
  requestId: "req-1",
  traceId: "trace-1",
};
const RESPONSE = "<thought>ok</thought>\n<content>done</content>";
const FAST_RETRY = { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 2, backoffMultiplier: 1, jitterFactor: 0 };

/** A provider that records every prompt that reaches it. */
function recordingProvider(prompts: string[]): MockProvider {
  const provider = new MockProvider(RESPONSE);
  const original = provider.generate.bind(provider);
  provider.generate = (prompt, ...rest) => {
    prompts.push(prompt);
    return original(prompt, ...rest);
  };
  return provider;
}

Deno.test("agent-runner-prompt-characterization: the provider receives the system prompt and the user prompt in one text", async () => {
  const prompts: string[] = [];
  const events: ICapturedEvent[] = [];
  const runner = new AgentRunner(recordingProvider(prompts), {
    logger: createCapturingLogger(events),
    disableSkills: true,
  });
  await runner.run(blueprint, request, undefined);
  assertEquals(prompts.length, 1);
  assertStringIncludes(prompts[0], "You are a careful reviewer.");
  assertStringIncludes(prompts[0], "Review the change.");
  const assembled = events.find((event) => event.action === "agent.prompt_assembled");
  assertEquals(assembled?.payload?.prompt_length, prompts[0].length);
  assertEquals(assembled?.payload?.agent_role, "qa-engineer");
});

Deno.test("agent-runner-attempt-characterization: a successful attempt returns the parsed result and journals the run", async () => {
  const events: ICapturedEvent[] = [];
  const runner = new AgentRunner(new MockProvider(RESPONSE), {
    logger: createCapturingLogger(events),
    disableSkills: true,
  });
  const result = await runner.run(blueprint, request, undefined);
  assertEquals(result.content, "done");
  assertEquals(events.map((event) => event.action), [
    "agent.execution_started",
    "agent.prompt_assembled",
    "agent.prompt_debug_dump",
    "agent.effort_resolved",
    "agent.llm_response_received",
    "agent.execution_completed",
  ]);
});

Deno.test("agent-runner-attempt-characterization: a provider failure rejects after one call and journals the failure", async () => {
  const events: ICapturedEvent[] = [];
  let calls = 0;
  const provider = new MockProvider("unused");
  provider.generate = () => {
    calls++;
    return Promise.reject(new ModelProviderError("HTTP 400 invalid request", "mock"));
  };
  const runner = new AgentRunner(provider, {
    logger: createCapturingLogger(events),
    retryPolicy: FAST_RETRY,
    disableSkills: true,
  });
  await assertRejects(() => runner.run(blueprint, request, undefined), ModelProviderError);
  assertEquals(calls, 1);
  assertEquals(events.map((event) => event.action), [
    "agent.execution_started",
    "agent.prompt_assembled",
    "agent.prompt_debug_dump",
    "agent.effort_resolved",
    "agent.execution_failed",
  ]);
});

Deno.test("agent-runner-attempt-characterization: a plain error rejects after the attempts the policy allows", async () => {
  let calls = 0;
  const provider = new MockProvider("unused");
  provider.generate = () => {
    calls++;
    return Promise.reject(new Error("transient"));
  };
  const runner = new AgentRunner(provider, { retryPolicy: FAST_RETRY, disableSkills: true });
  await assertRejects(() => runner.run(blueprint, request, undefined));
  assertEquals(calls, 1);
});
