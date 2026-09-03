/**
 * @module AgentRunnerPromptEventTest
 * @path packages/execution/tests/agent_runner_prompt_event_test.ts
 * @description Phase 112 Step 1 — verifies AgentRunner.run's planning-producer prompt
 *   event now routes through the registered DomainEventType.AgentPromptAssembled member
 *   (rather than the raw AGENT_EVENT_PROMPT_ASSEMBLED string constant), preserves every
 *   pre-existing legacy field, and adds the prompt_kind:"planning" discriminator.
 * @architectural-layer Test
 * @related-files ["packages/execution/src/agent_runner.ts", "packages/core/src/events/domain_event_types.ts"]
 */

import { assertEquals, assertExists } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core/types";

const sampleBlueprint: IBlueprint = {
  systemPrompt: "You are a helpful coding assistant.",
  agentRole: "senior-coder",
};

const sampleRequest: IParsedRequest = {
  userPrompt: "Create a simple hello world function in TypeScript",
  context: {},
};

const wellFormedResponse = `<thought>ok</thought>\n<content>done</content>`;

interface ICapturedEvent {
  action: string;
  target: string | null;
  payload?: LogMetadata;
}

function createCapturingLogger(captured: ICapturedEvent[]): IEventLogger {
  const record = (action: string, target: string | null, payload?: LogMetadata): Promise<void> => {
    captured.push({ action, target, payload });
    return Promise.resolve();
  };
  const logger: IEventLogger = {
    log: (event) => record(event.action ?? "", event.target ?? null, event.payload),
    info: record,
    warn: record,
    error: record,
    fatal: record,
    debug: record,
    child: () => logger,
  };
  return logger;
}

Deno.test("[AgentRunner] run() emits exactly one AgentPromptAssembled event via the registered taxonomy member", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const captured: ICapturedEvent[] = [];
  const runner = new AgentRunner(mockProvider, { logger: createCapturingLogger(captured) });

  const result = await runner.run(sampleBlueprint, sampleRequest, undefined);

  assertExists(result);
  const events = captured.filter((event) => event.action === DomainEventType.AgentPromptAssembled);
  assertEquals(events.length, 1);
});

Deno.test("[AgentRunner] the planning producer's payload preserves every legacy field and adds the discriminator", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const captured: ICapturedEvent[] = [];
  const runner = new AgentRunner(mockProvider, { logger: createCapturingLogger(captured) });

  await runner.run(sampleBlueprint, sampleRequest, undefined);

  const events = captured.filter((event) => event.action === DomainEventType.AgentPromptAssembled);
  const payload = events[0].payload;
  assertEquals(payload?.prompt_kind, "planning");
  assertEquals(payload?.agent_role, "senior-coder");
  assertEquals(typeof payload?.prompt_length, "number");
  assertEquals(Array.isArray(payload?.skillIdsUsed), true);
  assertEquals(typeof payload?.skillsCount, "number");
  assertEquals(typeof payload?.retrievalLatencyMs, "number");
});
