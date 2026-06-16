/**
 * @module FlowRunnerVotingTest
 * @path packages/flow/tests/flow_runner_voting_test.ts
 * @description Integration tests for FlowRunner with VotingStepHandler registered
 * via VotingCapabilityModule — routes voting_group steps, downstream consumption,
 * and no-handler UnknownFlowStepError.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { FlowInputSource, FlowOutputFormat, FlowStepType } from "@exaix/core";
import { FlowRunner, type IAgentExecutor, type IFlowEventLogger, type IFlowStepRequest } from "@exaix/flow";
import { VotingCapabilityModule, VotingConsensusService } from "@exaix-team/voting";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { JSONValue } from "@exaix/core/types";
import type { IExecutor } from "@exaix/core/types";
import { VotingModelSlot, VotingStrategy } from "@exaix/core/types";
import { createMockLogger } from "@exaix/testing";
import type { FlowStepHandlerRegistry } from "@exaix/flow";
import type { ISeamRegistryPlaceholder } from "@exaix/core/composer";

// Narrowing helper: FlowStepHandlerRegistry → ISeamRegistryPlaceholder
function toSeamPlaceholder(registry: FlowStepHandlerRegistry): ISeamRegistryPlaceholder {
  return registry;
}

// ============================================================
// Test doubles
// ============================================================

class StubAgentExecutor implements IAgentExecutor {
  callCount = 0;

  run(_identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.callCount++;
    return Promise.resolve({ thought: "", content: `agent-step-${this.callCount}`, raw: "" });
  }
}

class TrackingEventLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>): void {
    this.events.push({ event, payload });
  }
}

class ScriptedExecutor implements IExecutor {
  callIndex = 0;
  readonly responses: string[];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  run(_blueprint: string, _prompt: string): Promise<{ content: string; confidence?: number }> {
    const idx = this.callIndex;
    this.callIndex++;
    return Promise.resolve({ content: this.responses[idx] ?? "default" });
  }
}

// ============================================================
// Flow factories
// ============================================================

function makeVotingFlow(): IFlow {
  const flow: IFlowInput = {
    id: "test-voting-flow",
    name: "Test Voting Flow",
    description: "Flow with voting_group step",
    steps: [
      {
        id: "vote-step",
        name: "Vote on Result",
        type: FlowStepType.VOTING_GROUP,
        identity: "voter",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
        retry: { maxAttempts: 1, backoffMs: 0 },
        voting: {
          runners: [
            { blueprint: "agent-a", model_slot: VotingModelSlot.DEFAULT },
            { blueprint: "agent-b", model_slot: VotingModelSlot.DEFAULT },
            { blueprint: "agent-c", model_slot: VotingModelSlot.DEFAULT },
          ],
          strategy: VotingStrategy.MAJORITY,
          halt_on_no_consensus: true,
          timeout_ms: 5000,
        },
      },
    ],
    output: { from: "vote-step", format: FlowOutputFormat.MARKDOWN },
  };
  return flow as IFlow;
}

function makeVotingAndDownstreamFlow(): IFlow {
  const flow: IFlowInput = {
    id: "test-voting-downstream-flow",
    name: "Test Voting Downstream Flow",
    description: "Flow with voting_group step followed by agent step",
    steps: [
      {
        id: "vote-step",
        name: "Vote on Result",
        type: FlowStepType.VOTING_GROUP,
        identity: "voter",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
        retry: { maxAttempts: 1, backoffMs: 0 },
        voting: {
          runners: [
            { blueprint: "agent-a", model_slot: VotingModelSlot.DEFAULT },
            { blueprint: "agent-b", model_slot: VotingModelSlot.DEFAULT },
            { blueprint: "agent-c", model_slot: VotingModelSlot.DEFAULT },
          ],
          strategy: VotingStrategy.MAJORITY,
          halt_on_no_consensus: true,
          timeout_ms: 5000,
        },
      },
      {
        id: "downstream-step",
        name: "Downstream Agent",
        type: FlowStepType.AGENT,
        identity: "writer-agent",
        dependsOn: ["vote-step"],
        input: { source: FlowInputSource.REQUEST },
        retry: { maxAttempts: 1, backoffMs: 0 },
      },
    ],
    output: { from: "downstream-step", format: FlowOutputFormat.MARKDOWN },
  };
  return flow as IFlow;
}

function makeAgentFlow(stepId = "step1"): IFlow {
  const flow: IFlowInput = {
    id: "test-agent-flow",
    name: "Test Agent Flow",
    description: "Agent flow for regression guard",
    steps: [
      {
        id: stepId,
        name: "Agent Step",
        type: FlowStepType.AGENT,
        identity: "writer-agent",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
        retry: { maxAttempts: 1, backoffMs: 0 },
      },
    ],
    output: { from: stepId, format: FlowOutputFormat.MARKDOWN },
  };
  return flow as IFlow;
}

// ============================================================
// Tests
// ============================================================

Deno.test("[FlowRunner] voting_group routes to VotingStepHandler via capability module", async () => {
  const agentExecutor = new StubAgentExecutor();
  const logger = new TrackingEventLogger();
  const votingLogger = createMockLogger();

  const votingExecutor: IExecutor = new ScriptedExecutor(["42", "42", "99"]);
  const votingService = new VotingConsensusService(votingExecutor, votingLogger);
  const votingModule = new VotingCapabilityModule(votingService, votingLogger);

  const runner = new FlowRunner({ agentExecutor, eventLogger: logger });

  votingModule.registerFlowStepHandlers(
    toSeamPlaceholder(runner.getStepHandlerRegistry()),
  );

  const flow = makeVotingFlow();
  const result = await runner.execute(flow, { userPrompt: "What is 6*7?" });

  assertEquals(result.success, true);
  assertEquals(agentExecutor.callCount, 0);
});

Deno.test("[FlowRunner] non-voting steps unchanged when voting handler registered", async () => {
  const agentExecutor = new StubAgentExecutor();
  const logger = new TrackingEventLogger();
  const votingLogger = createMockLogger();

  const votingExecutor: IExecutor = new ScriptedExecutor(["x"]);
  const votingService = new VotingConsensusService(votingExecutor, votingLogger);
  const votingModule = new VotingCapabilityModule(votingService, votingLogger);

  const runner = new FlowRunner({ agentExecutor, eventLogger: logger });

  votingModule.registerFlowStepHandlers(
    toSeamPlaceholder(runner.getStepHandlerRegistry()),
  );

  const flow = makeAgentFlow();
  const result = await runner.execute(flow, { userPrompt: "Do something" });

  assertEquals(result.success, true);
  assertEquals(agentExecutor.callCount, 1);
});

Deno.test("[FlowRunner] voting winner feeds downstream step", async () => {
  const agentExecutor = new StubAgentExecutor();
  const logger = new TrackingEventLogger();
  const votingLogger = createMockLogger();

  const votingExecutor: IExecutor = new ScriptedExecutor(["A", "A", "B"]);
  const votingService = new VotingConsensusService(votingExecutor, votingLogger);
  const votingModule = new VotingCapabilityModule(votingService, votingLogger);

  const runner = new FlowRunner({ agentExecutor, eventLogger: logger });

  votingModule.registerFlowStepHandlers(
    toSeamPlaceholder(runner.getStepHandlerRegistry()),
  );

  const flow = makeVotingAndDownstreamFlow();
  const result = await runner.execute(flow, { userPrompt: "Pick best" });

  assertEquals(result.success, true);
  assertEquals(agentExecutor.callCount, 1);
});

Deno.test("[FlowRunner] voting_group with no handler raises UnknownFlowStepError", async () => {
  const agentExecutor = new StubAgentExecutor();
  const logger = new TrackingEventLogger();

  const runner = new FlowRunner({ agentExecutor, eventLogger: logger });
  const flow = makeVotingFlow();

  await assertRejects(
    () => runner.execute(flow, { userPrompt: "test" }),
    Error,
    "Unknown flow step type",
  );
});
