/**
 * @module VotingConsensusTest
 * @path packages/voting/tests/voting_consensus_test.ts
 * @description Unit tests for VotingConsensusService: majority, weighted, and runner failure fallback.
 */

import { assertEquals } from "@std/assert";
import type { VotingGroupConfig } from "@exaix/schemas/voting.ts";
import { VotingModelSlot, VotingStrategy } from "@exaix/core/types";
import type { IExecutor } from "../mod.ts";
import { VotingConsensusService } from "../mod.ts";
import { createMockLogger } from "@exaix/testing";
import { DomainEventType } from "@exaix/core/events";

Deno.test("three-identical-responses-consensus", async () => {
  const logger = createMockLogger();
  const executor: IExecutor = {
    run: (_blueprint: string) => Promise.resolve({ content: "42" }),
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
  const result = await service.run(config, "What is 6*7?", "trace-1");
  assertEquals(result.consensus_reached, true);
  assertEquals(result.winner.response, "42");
  assertEquals(result.candidates.length, 3);
  assertEquals(result.strategy, VotingStrategy.MAJORITY);
  assertEquals(
    logger.info.calls.filter((c) => c.args[0] === DomainEventType.VotingStarted)
      .length,
    1,
  );
  assertEquals(
    logger.info.calls.filter((c) => c.args[0] === DomainEventType.VotingResolved).length,
    1,
  );
});

Deno.test("two-vs-one-majority", async () => {
  const logger = createMockLogger();
  const executor: IExecutor = {
    run: (blueprint: string) => {
      if (blueprint === "a") return Promise.resolve({ content: "Red" });
      if (blueprint === "b") return Promise.resolve({ content: "Blue" });
      return Promise.resolve({ content: "Red" });
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
  const result = await service.run(config, "Best color?", "trace-2");
  assertEquals(result.consensus_reached, true);
  assertEquals(result.winner.response, "Red");
});

Deno.test("weighted-selects-highest-confidence", async () => {
  const logger = createMockLogger();
  const executor: IExecutor = {
    run: (blueprint: string) => {
      if (blueprint === "high") {
        return Promise.resolve({ content: "Answer A", confidence: 0.95 });
      }
      if (blueprint === "mid") {
        return Promise.resolve({ content: "Answer B", confidence: 0.7 });
      }
      return Promise.resolve({ content: "Answer C", confidence: 0.3 });
    },
  };
  const service = new VotingConsensusService(executor, logger);
  const config: VotingGroupConfig = {
    runners: [
      { blueprint: "high", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "mid", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "low", model_slot: VotingModelSlot.DEFAULT },
    ],
    strategy: VotingStrategy.WEIGHTED,
    halt_on_no_consensus: true,
    timeout_ms: 5000,
  };
  const result = await service.run(config, "Pick best?", "trace-3");
  assertEquals(result.consensus_reached, true);
  assertEquals(result.winner.response, "Answer A");
});

Deno.test("runner-failure-journals-and-falls-back", async () => {
  const logger = createMockLogger();
  let callCount = 0;
  const executor: IExecutor = {
    run: (_blueprint: string) => {
      callCount++;
      if (callCount === 2) return Promise.reject(new Error("runner b crashed"));
      return Promise.resolve({ content: "Survivor" });
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
  const result = await service.run(config, "Who survives?", "trace-4");
  assertEquals(result.consensus_reached, true);
  assertEquals(result.winner.response, "Survivor");
  assertEquals(result.candidates.length, 2);
  assertEquals(
    logger.info.calls.filter((c) => c.args[0] === DomainEventType.VotingRunnerFailed).length,
    1,
  );
});
