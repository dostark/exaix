/**
 * @module VotingStepHandlerInputTest
 * @path packages/flow/tests/step_handlers/voting_step_handler_input_test.ts
 * @description Traces prepared evidence and request metadata through actual Team voters into the ADR.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { FlowRunner } from "@exaix/flow";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import { VotingCapabilityModule, VotingConsensusService } from "@exaix-team/voting";
import type { IExecutor, IExecutorContext } from "@exaix/core/types";
import type { IBindingRunSnapshot } from "@exaix/schemas";
import { createMockLogger } from "@exaix/testing";
import { DomainEventType } from "@exaix/core/events";
import { BranchTestAgent } from "../helpers/branch_controls.ts";
import { GateTestLogger } from "../helpers/gate_controls.ts";

Deno.test("[voting input] three Team voters receive prepared evidence and original references; ADR consumes majority", async () => {
  const flow = FlowSchema.parse({
    id: "architecture-decision",
    name: "Architecture decision",
    description: "Context, vote, ADR",
    requires_capabilities: ["voting"],
    settings: { maxParallelism: 1 },
    namespace: { enabled: false },
    steps: [
      { id: "context", name: "Context", agent_role: "code-analyst" },
      {
        id: "vote",
        name: "Vote",
        type: "voting_group",
        agent_role: "software-architect",
        dependsOn: ["context"],
        input: { source: "step", stepId: "context" },
        voting: {
          runners: Array.from({ length: 3 }, () => ({ blueprint: "software-architect" })),
          strategy: "majority",
        },
      },
      {
        id: "adr",
        name: "ADR",
        agent_role: "technical-writer",
        dependsOn: ["vote"],
        input: { source: "step", stepId: "vote" },
      },
    ],
    output: { from: "adr" },
  });
  const snapshot: IBindingRunSnapshot = {
    traceId: "voting-trace",
    flowId: flow.id,
    layers: {
      entries: [],
      catalog: { models: {}, services: {}, preferences: {} },
      overlaySha256: [],
      operatorLayersPresent: false,
    },
    bindings: new Map(),
    issues: [],
    envIgnored: false,
  };
  const calls: { role: string; prompt: string; context: IExecutorContext | undefined }[] = [];
  const executor: IExecutor = {
    run: (role, prompt, context) => {
      calls.push({ role, prompt, context });
      return Promise.resolve({ content: calls.length < 3 ? "Choose SQLite" : "Choose PostgreSQL" });
    },
  };
  const agent = new BranchTestAgent();
  const logger = createMockLogger();
  const runner = new FlowRunner({
    agentExecutor: agent,
    eventLogger: new GateTestLogger(),
    edition: "team",
    installedCapabilities: new Set(["voting"]),
  });
  new VotingCapabilityModule(new VotingConsensusService(executor, logger), logger)
    .registerFlowStepHandlers(runner.getStepHandlerRegistry());
  const result = await runner.execute(flow, {
    userPrompt: "Original objective",
    traceId: "voting-trace",
    requestId: "voting-request",
    scenarioId: "voting-scenario",
    stepId: "submit",
    bindingSnapshot: snapshot,
    recordingLanes: true,
  });
  assertEquals(result.success, true);
  assertEquals(calls.length, 3);
  assertEquals(calls.map((call) => call.context?.runnerIndex).sort(), [0, 1, 2]);
  const recording = calls[0].context?.recording;
  assertEquals(recording?.lane("vote--voter-0").current().scenarioId, "voting-scenario");
  for (const call of calls) assertEquals(call.context?.recording, recording, "voters share the run allocator");
  for (const call of calls) {
    assertEquals(call.role, "software-architect");
    assertStringIncludes(call.prompt, "Output context");
    assertEquals(call.context?.traceId, "voting-trace");
    assertEquals(call.context?.requestId, "voting-request");
    assertEquals(call.context?.flowId, flow.id);
    assertEquals(call.context?.flowStepId, "vote");
    assertEquals(call.context?.scenarioId, "voting-scenario");
    assertEquals(call.context?.stepId, "submit");
    assertEquals(call.context?.bindingSnapshot, snapshot);
  }
  assertEquals(agent.requests.map((request) => request.flowStepId), ["context", "adr"]);
  assertStringIncludes(agent.requests[1].userPrompt, "Choose SQLite");
  assertEquals(agent.requests[1].userPrompt.includes("Choose PostgreSQL"), false);
  for (const event of [DomainEventType.VotingStarted, DomainEventType.VotingResolved]) {
    const emitted = logger.info.calls.find((call) => call.args[0] === event)!;
    assertEquals(emitted.args[3], "voting-trace");
  }
});
