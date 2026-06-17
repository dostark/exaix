/**
 * @module VotingLlmJudgeTest
 * @path packages-team/voting/tests/voting_llm_judge_test.ts
 * @description Unit tests for llm-judge consensus strategy in VotingConsensusService.
 */

import { assert, assertEquals } from "@std/assert";
import type { VotingGroupConfig } from "@exaix/schemas/voting.ts";
import { VotingModelSlot, VotingStrategy } from "@exaix/core/types";
import type { IExecutor } from "@exaix/core/types";
import { VotingConsensusService } from "../mod.ts";
import { createMockLogger } from "@exaix/testing";
import { DomainEventType } from "@exaix/core/events";

Deno.test("[voting] llm-judge invokes judge blueprint and selects winner", async () => {
  const logger = createMockLogger();
  let judgeCalled = false;
  let judgePrompt = "";

  const executor: IExecutor = {
    run: (blueprint: string, prompt: string) => {
      if (blueprint === "voting-judge") {
        judgeCalled = true;
        judgePrompt = prompt;
        return Promise.resolve({ content: "WINNER: runner-b" });
      }
      if (blueprint === "runner-a") {
        return Promise.resolve({ content: "Answer A" });
      }
      if (blueprint === "runner-b") {
        return Promise.resolve({ content: "Answer B" });
      }
      return Promise.resolve({ content: "Answer C" });
    },
  };

  const service = new VotingConsensusService(executor, logger);
  const config: VotingGroupConfig = {
    runners: [
      { blueprint: "runner-a", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "runner-b", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "runner-c", model_slot: VotingModelSlot.DEFAULT },
    ],
    strategy: VotingStrategy.LLM_JUDGE,
    judge_blueprint: "voting-judge",
    halt_on_no_consensus: true,
    timeout_ms: 5000,
  };

  const result = await service.run(config, "Best answer?", "trace-judge");
  assertEquals(result.consensus_reached, true);
  assertEquals(result.winner.runner_id, "runner-b");
  assertEquals(result.winner.response, "Answer B");
  assertEquals(judgeCalled, true);
  assert(
    judgePrompt.includes("runner-a"),
    "judge prompt should contain all candidates",
  );
  assert(
    judgePrompt.includes("runner-b"),
    "judge prompt should contain all candidates",
  );
  assert(
    judgePrompt.includes("runner-c"),
    "judge prompt should contain all candidates",
  );
});

Deno.test("[voting] llm-judge tie returns no consensus", async () => {
  const logger = createMockLogger();
  const executor: IExecutor = {
    run: (blueprint: string, _prompt: string) => {
      if (blueprint === "voting-judge") {
        return Promise.resolve({ content: "TIE" });
      }
      return Promise.resolve({ content: "Answer" });
    },
  };

  const service = new VotingConsensusService(executor, logger);
  const config: VotingGroupConfig = {
    runners: [
      { blueprint: "a", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "b", model_slot: VotingModelSlot.DEFAULT },
    ],
    strategy: VotingStrategy.LLM_JUDGE,
    judge_blueprint: "voting-judge",
    halt_on_no_consensus: false,
    timeout_ms: 5000,
  };

  const result = await service.run(config, "test", "trace-tie");
  assertEquals(result.consensus_reached, false);
  assertEquals(
    logger.info.calls.filter((c) => c.args[0] === DomainEventType.VotingNoConsensus).length,
    1,
  );
});

Deno.test("[voting] llm-judge invalid verdict returns no consensus", async () => {
  const logger = createMockLogger();
  const executor: IExecutor = {
    run: (blueprint: string, _prompt: string) => {
      if (blueprint === "voting-judge") {
        return Promise.resolve({ content: "I don't know" });
      }
      return Promise.resolve({ content: "Answer" });
    },
  };

  const service = new VotingConsensusService(executor, logger);
  const config: VotingGroupConfig = {
    runners: [
      { blueprint: "a", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "b", model_slot: VotingModelSlot.DEFAULT },
    ],
    strategy: VotingStrategy.LLM_JUDGE,
    judge_blueprint: "voting-judge",
    halt_on_no_consensus: false,
    timeout_ms: 5000,
  };

  const result = await service.run(config, "test", "trace-invalid");
  assertEquals(result.consensus_reached, false);
});
