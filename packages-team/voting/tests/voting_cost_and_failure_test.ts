/**
 * @module VotingCostAndFailureTest
 * @path packages-team/voting/tests/voting_cost_and_failure_test.ts
 * @description Tests for cost attribution and partial-failure fallback in VotingConsensusService.
 */

import { assertEquals } from "@std/assert";
import type { VotingGroupConfig } from "@exaix/schemas/voting.ts";
import { type ICostTracker, type IExecutor, VotingModelSlot, VotingStrategy } from "@exaix/core/types";
import { VotingConsensusService } from "../mod.ts";
import { createMockLogger } from "@exaix/testing";
import { DomainEventType } from "@exaix/core/events";
import type { IVotingEventPayload } from "@exaix/core/events";

Deno.test("[voting] all-runner-costs-recorded", async () => {
  const logger = createMockLogger();
  const costCalls: Array<{ provider: string; model: string; traceId?: string }> = [];
  const costTracker: ICostTracker = {
    trackGeneration: (
      provider: string,
      model: string,
      _usage: { promptTokens: number; completionTokens: number; totalTokens: number },
      traceId?: string,
    ) => {
      costCalls.push({ provider, model, traceId });
      return 0;
    },
    persistEntry: () => Promise.resolve(),
    queryByCriteria: () => Promise.resolve([]),
    getTotalCost: () => 0,
    getDailyCost: () => Promise.resolve(0),
    flush: () => Promise.resolve(),
    isWithinBudget: () => Promise.resolve(true),
  };

  const executor: IExecutor = {
    run: (blueprint: string) => Promise.resolve({ content: `${blueprint}-response` }),
  };

  const service = new VotingConsensusService(executor, logger, undefined, costTracker);
  const config: VotingGroupConfig = {
    runners: [
      { blueprint: "agent-a", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "agent-b", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "agent-c", model_slot: VotingModelSlot.DEFAULT },
    ],
    strategy: VotingStrategy.MAJORITY,
    halt_on_no_consensus: true,
    timeout_ms: 5000,
  };

  await service.run(config, "test", "trace-cost");
  assertEquals(costCalls.length, 3, "one cost record per runner");
  assertEquals(costCalls[0].provider, "agent-a");
  assertEquals(costCalls[1].provider, "agent-b");
  assertEquals(costCalls[2].provider, "agent-c");
  assertEquals(costCalls[0].traceId, "trace-cost");
});

Deno.test("[voting] event-payloads-typed", () => {
  // Verify every voting event payload shape conforms to IVotingEventPayload.
  // This is a compile-time + runtime assertion against the typed interface.
  const started: IVotingEventPayload = {
    step_id: "step-1",
    strategy: VotingStrategy.MAJORITY,
    candidate_count: 3,
    consensus_reached: false,
  };
  assertEquals(started.step_id, "step-1");

  const resolved: IVotingEventPayload = {
    step_id: "step-1",
    strategy: VotingStrategy.MAJORITY,
    candidate_count: 3,
    consensus_reached: true,
    winner_runner_id: "runner-a",
  };
  assertEquals(resolved.winner_runner_id, "runner-a");

  const noConsensus: IVotingEventPayload = {
    step_id: "step-1",
    strategy: VotingStrategy.MAJORITY,
    candidate_count: 3,
    consensus_reached: false,
    dissent_summary: "No consensus",
  };
  assertEquals(noConsensus.dissent_summary, "No consensus");

  const runnerFailed: IVotingEventPayload = {
    step_id: "step-1",
    strategy: VotingStrategy.MAJORITY,
    candidate_count: 3,
    consensus_reached: false,
    error: "runner crashed",
  };
  assertEquals(runnerFailed.error, "runner crashed");
});

Deno.test("[voting] all-runners-fail-returns-no-consensus", async () => {
  const logger = createMockLogger();
  const executor: IExecutor = {
    run: (_blueprint: string, _prompt: string) => {
      throw new Error("all runners crash");
    },
  };

  const service = new VotingConsensusService(executor, logger);
  const config: VotingGroupConfig = {
    runners: [
      { blueprint: "a", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "b", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "c", model_slot: VotingModelSlot.DEFAULT },
    ],
    strategy: VotingStrategy.MAJORITY,
    halt_on_no_consensus: true,
    timeout_ms: 5000,
  };

  const result = await service.run(config, "test", "trace-all-fail");
  assertEquals(result.consensus_reached, false, "no consensus when all runners fail");
  assertEquals(result.candidates.length, 0, "no candidates");
  assertEquals(result.dissent_summary, "All runners failed");
  assertEquals(
    logger.info.calls.filter((c) => c.args[0] === DomainEventType.VotingRunnerFailed).length,
    3,
  );
  assertEquals(
    logger.info.calls.filter((c) => c.args[0] === DomainEventType.VotingNoConsensus).length,
    1,
  );
});
