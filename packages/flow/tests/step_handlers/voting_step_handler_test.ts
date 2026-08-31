/**
 * @module VotingStepHandlerTest
 * @path packages/flow/tests/step_handlers/voting_step_handler_test.ts
 * @description Unit tests for VotingStepHandler — invoked-service, maps-winner, rejects-dynamic.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import { FlowInputSource, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import type { IVotingConsensusService } from "@exaix/core/types";
import type { VotingGroupConfig, VotingResult } from "@exaix/schemas/voting.ts";
import { VotingModelSlot, VotingStrategy } from "@exaix/core/types";
import { VotingStepHandler } from "@exaix/flow";
import type { IFlowStep } from "@exaix/schemas/flow.ts";
import type { IStepExecutionContext } from "@exaix/flow";
import { createMockLogger, initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";

// Test doubles

class SpyVotingService implements IVotingConsensusService {
  lastConfig?: VotingGroupConfig;
  lastPrompt?: string;
  lastTraceId?: string;
  readonly #result: VotingResult;

  constructor(result?: Partial<VotingResult>) {
    this.#result = {
      trace_id: "trace-test",
      strategy: VotingStrategy.MAJORITY,
      winner: { runner_id: "runner-a", response: "Winner answer" },
      candidates: [
        { runner_id: "runner-a", response: "Winner answer" },
        { runner_id: "runner-b", response: "Loser answer" },
        { runner_id: "runner-c", response: "Winner answer" },
      ],
      consensus_reached: true,
      ...result,
    };
  }

  run(config: VotingGroupConfig, basePrompt: string, traceId: string): Promise<VotingResult> {
    this.lastConfig = config;
    this.lastPrompt = basePrompt;
    this.lastTraceId = traceId;
    return Promise.resolve(this.#result);
  }
}

function makeStep(overrides: Partial<IFlowStep> = {}): IFlowStep {
  return {
    id: "vote-1",
    name: "Vote Step",
    type: FlowStepType.VOTING_GROUP,
    identity: "voter",
    execution_mode: FlowStepExecutionMode.DECLARED,
    permitted_tools: undefined,
    dependsOn: [],
    input: { source: FlowInputSource.REQUEST },
    condition: undefined,
    timeout: undefined,
    retry: { maxAttempts: 1, backoffMs: 0 },
    onError: undefined,
    evaluate: undefined,
    loop: undefined,
    branches: undefined,
    default: undefined,
    consensus: undefined,
    voting: undefined,
    skills: undefined,
    tier: undefined,
    namespace: undefined,
    parallel: undefined,
    mergeFromGroups: undefined,
    mergeMode: undefined,
    ...overrides,
  } as IFlowStep;
}

function makeMinimalCtx(step: IFlowStep = makeStep()): IStepExecutionContext {
  return {
    stepType: step.type,
    step,
    flow: { id: "flow-1" },
    request: { userPrompt: "What is the answer?" },
    stepRequest: { userPrompt: "What is the answer?", context: {} },
    flowRunId: "run-1",
    startedAt: new Date(),
    flowLogBase: { flowId: "flow-1" },
  } as IStepExecutionContext;
}

// Tests

Deno.test("[flow] VotingStepHandler invokes voting service with step config", async () => {
  const votingService = new SpyVotingService();
  const logger = createMockLogger();
  const handler = new VotingStepHandler({ votingService, eventLogger: logger });
  const step = makeStep({
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
  });
  const ctx = makeMinimalCtx(step);

  const result = await handler.execute(ctx);

  assertEquals(result.content, "Winner answer");
  assertEquals(votingService.lastConfig, step.voting);
  assertEquals(votingService.lastPrompt, "What is the answer?");
});

Deno.test("[flow] VotingStepHandler maps winner to step result", async () => {
  const votingService = new SpyVotingService({
    winner: { runner_id: "runner-b", response: "Custom answer" },
    strategy: VotingStrategy.WEIGHTED,
  });
  const logger = createMockLogger();
  const handler = new VotingStepHandler({ votingService, eventLogger: logger });
  const step = makeStep({
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
  });
  const ctx = makeMinimalCtx(step);

  const result = await handler.execute(ctx);

  assertEquals(result.content, "Custom answer");
  assertEquals(result.thought, "Consensus reached via weighted strategy with 3 candidates");
  const parsed = JSON.parse(result.raw);
  assertEquals(parsed.strategy, "weighted");
  assertEquals(parsed.winner.runner_id, "runner-b");
});

Deno.test("[flow] VotingStepHandler rejects DYNAMIC execution mode", async () => {
  const votingService = new SpyVotingService();
  const logger = createMockLogger();
  const handler = new VotingStepHandler({ votingService, eventLogger: logger });
  const step = makeStep({
    execution_mode: FlowStepExecutionMode.DYNAMIC,
    voting: {
      runners: [
        { blueprint: "a", model_slot: VotingModelSlot.DEFAULT },
        { blueprint: "b", model_slot: VotingModelSlot.DEFAULT },
      ],
      strategy: VotingStrategy.MAJORITY,
      halt_on_no_consensus: true,
      timeout_ms: 5000,
    },
  });
  const ctx = makeMinimalCtx(step);

  await assertRejects(
    () => handler.execute(ctx),
    Error,
    "VOTING_GROUP step does not support DYNAMIC execution mode",
  );
});

Deno.test("[flow] VotingStepHandler throws when no voting config", async () => {
  const votingService = new SpyVotingService();
  const logger = createMockLogger();
  const handler = new VotingStepHandler({ votingService, eventLogger: logger });
  const step = makeStep({ voting: undefined });
  const ctx = makeMinimalCtx(step);

  await assertRejects(
    () => handler.execute(ctx),
    Error,
    "Voting step has no voting config",
  );
});

Deno.test("[flow] VotingStepHandler emits VotingStepConsensusResolved when consensus reached", async () => {
  const votingService = new SpyVotingService({ consensus_reached: true });
  const logger = createMockLogger();
  const handler = new VotingStepHandler({ votingService, eventLogger: logger });
  const step = makeStep({
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
  });
  const ctx = makeMinimalCtx(step);

  await handler.execute(ctx);

  assertEquals(logger.info.calls.length, 1);
  const [action, target, payload] = logger.info.calls[0].args;
  assertEquals(action, DomainEventType.VotingStepConsensusResolved);
  assertEquals(target, "vote-1");
  assertEquals(payload, {
    consensus_reached: true,
    strategy: VotingStrategy.MAJORITY,
    candidate_count: 3,
  });
});

Deno.test("[flow] VotingStepHandler emits VotingStepConsensusResolved when consensus not reached", async () => {
  const votingService = new SpyVotingService({
    consensus_reached: false,
    strategy: VotingStrategy.WEIGHTED,
    candidates: [
      { runner_id: "runner-a", response: "Answer A" },
      { runner_id: "runner-b", response: "Answer B" },
    ],
  });
  const logger = createMockLogger();
  const handler = new VotingStepHandler({ votingService, eventLogger: logger });
  const step = makeStep({
    voting: {
      runners: [
        { blueprint: "agent-a", model_slot: VotingModelSlot.DEFAULT },
        { blueprint: "agent-b", model_slot: VotingModelSlot.DEFAULT },
      ],
      strategy: VotingStrategy.WEIGHTED,
      halt_on_no_consensus: false,
      timeout_ms: 5000,
    },
  });
  const ctx = makeMinimalCtx(step);

  await handler.execute(ctx);

  assertEquals(logger.info.calls.length, 1);
  const [action, target, payload] = logger.info.calls[0].args;
  assertEquals(action, DomainEventType.VotingStepConsensusResolved);
  assertEquals(target, "vote-1");
  assertEquals(payload, {
    consensus_reached: false,
    strategy: VotingStrategy.WEIGHTED,
    candidate_count: 2,
  });
});

Deno.test("[flow] VotingStepHandler emits voting.step.consensus_resolved with a real, field-level payload (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const votingService = new SpyVotingService({ consensus_reached: true, strategy: VotingStrategy.MAJORITY });
    const logger = new EventLogger({ db });
    const handler = new VotingStepHandler({ votingService, eventLogger: logger });
    const step = makeStep({
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
    });
    const ctx = makeMinimalCtx(step);

    await handler.execute(ctx);
    await db.waitForFlush();

    const activities = db.getActivitiesByActionType(DomainEventType.VotingStepConsensusResolved);
    assertEquals(activities.length, 1, "voting.step.consensus_resolved must be logged exactly once");
    assertEquals(activities[0].target, "vote-1");
    const payload = JSON.parse(activities[0].payload ?? "{}");
    assertEquals(payload.consensus_reached, true);
    assertEquals(payload.strategy, VotingStrategy.MAJORITY);
    assertEquals(payload.candidate_count, 3);

    await db.close();
  } finally {
    await cleanup();
  }
});
