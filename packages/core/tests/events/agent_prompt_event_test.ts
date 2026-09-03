/**
 * @module AgentPromptEventTest
 * @path packages/core/tests/events/agent_prompt_event_test.ts
 * @description Phase 112 Step 1 — registers a typed, discriminated
 *   agent.prompt_assembled event in the DomainEventType taxonomy. The value was
 *   previously carried by an untyped raw string constant (AGENT_EVENT_PROMPT_ASSEMBLED,
 *   removed by this same phase). Guards the taxonomy value and both discriminated
 *   payload variants (planning producer: AgentRunner; ReAct producer:
 *   ReActLoopAdapter, wired in Step 3).
 * @architectural-layer Test
 * @related-files ["packages/core/src/events/domain_event_types.ts", "packages/execution/src/agent_runner.ts"]
 */

import { assertEquals } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import type { IAgentPromptAssembledPayload } from "@exaix/core/events";

Deno.test("[DomainEventType] AgentPromptAssembled is registered with the pre-existing string value", () => {
  assertEquals(DomainEventType.AgentPromptAssembled, "agent.prompt_assembled");
});

Deno.test("[IAgentPromptAssembledPayload] the planning variant preserves every legacy field", () => {
  const payload: IAgentPromptAssembledPayload = {
    prompt_kind: "planning",
    agent_role: "senior-coder",
    prompt_length: 1234,
    skillIdsUsed: ["tdd-workflow"],
    skillsCount: 1,
    retrievalLatencyMs: 5,
  };
  assertEquals(payload.prompt_kind, "planning");
  assertEquals(payload.agent_role, "senior-coder");
  assertEquals(payload.prompt_length, 1234);
  assertEquals(payload.skillIdsUsed, ["tdd-workflow"]);
  assertEquals(payload.skillsCount, 1);
  assertEquals(payload.retrievalLatencyMs, 5);
});

Deno.test("[IAgentPromptAssembledPayload] the react variant carries iteration and fragment fields", () => {
  const payload: IAgentPromptAssembledPayload = {
    prompt_kind: "react",
    iteration: 0,
    toolIds: ["read_file"],
    fragmentCount: 1,
    fragmentChars: 512,
    budgetChars: 12000,
    truncated: false,
  };
  assertEquals(payload.prompt_kind, "react");
  assertEquals(payload.iteration, 0);
  assertEquals(payload.toolIds, ["read_file"]);
  assertEquals(payload.fragmentCount, 1);
  assertEquals(payload.fragmentChars, 512);
  assertEquals(payload.budgetChars, 12000);
  assertEquals(payload.truncated, false);
});
