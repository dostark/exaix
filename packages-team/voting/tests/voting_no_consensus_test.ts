/**
 * @module VotingNoConsensusTest
 * @path packages-team/voting/tests/voting_no_consensus_test.ts
 * @description Unit tests for no-consensus governance in VotingConsensusService:
 * halt_on_no_consensus triggers amendment gate, false returns best-confidence.
 */

import { assertEquals } from "@std/assert";
import type { VotingGroupConfig } from "@exaix/schemas/voting.ts";
import { VotingModelSlot, VotingStrategy } from "@exaix/core/types";
import type { IExecutor, IPlanAmendmentService } from "@exaix/core/types";
import type { IPlanAmendmentPatch, IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import { VotingConsensusService } from "../mod.ts";
import { createMockLogger } from "@exaix/testing";
import { DomainEventType } from "@exaix/core/events";

Deno.test("[voting] halt_on_no_consensus triggers amendment gate", async () => {
  const logger = createMockLogger();
  let amendmentCalled = false;
  let lastTrigger: IPlanAmendmentTrigger | undefined;

  const amendmentService: IPlanAmendmentService = {
    shouldAmend: (trigger: IPlanAmendmentTrigger) => {
      amendmentCalled = true;
      lastTrigger = trigger;
      return Promise.resolve(true);
    },
    proposeAmendment: () =>
      Promise.resolve({
        amendmentId: "",
        planId: "",
        affectedRemainingStepIds: [],
        summary: "",
        adds: [],
        updates: [],
        removes: [],
        createdAt: "",
      }),
    applyApprovedAmendment: (_content: string, _patch: IPlanAmendmentPatch) => "",
  };

  const executor: IExecutor = {
    run: (blueprint: string, _prompt: string) => {
      if (blueprint === "a") return Promise.resolve({ content: "Answer A" });
      return Promise.resolve({ content: "Answer B" });
    },
  };

  const service = new VotingConsensusService(
    executor,
    logger,
    amendmentService,
  );
  const config: VotingGroupConfig = {
    runners: [
      { blueprint: "a", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "b", model_slot: VotingModelSlot.DEFAULT },
    ],
    strategy: VotingStrategy.MAJORITY,
    halt_on_no_consensus: true,
    timeout_ms: 5000,
  };

  const result = await service.run(config, "test", "trace-halt");
  assertEquals(result.consensus_reached, false);
  assertEquals(amendmentCalled, true);
  assertEquals(lastTrigger?.source, "voting_no_consensus");
  assertEquals(
    logger.info.calls.filter((c) => c.args[0] === DomainEventType.VotingNoConsensus).length,
    1,
  );
});

Deno.test("[voting] no-consensus-continue-uses-best-confidence", async () => {
  const logger = createMockLogger();
  const executor: IExecutor = {
    run: (blueprint: string, _prompt: string) => {
      if (blueprint === "a") {
        return Promise.resolve({ content: "Answer A", confidence: 0.9 });
      }
      return Promise.resolve({ content: "Answer B", confidence: 0.5 });
    },
  };

  const service = new VotingConsensusService(executor, logger);
  const config: VotingGroupConfig = {
    runners: [
      { blueprint: "a", model_slot: VotingModelSlot.DEFAULT },
      { blueprint: "b", model_slot: VotingModelSlot.DEFAULT },
    ],
    strategy: VotingStrategy.MAJORITY,
    halt_on_no_consensus: false,
    timeout_ms: 5000,
  };

  const result = await service.run(config, "test", "trace-continue");
  assertEquals(result.consensus_reached, false);
  assertEquals(result.winner.runner_id, "a");
  assertEquals(result.winner.response, "Answer A");
  assertEquals(
    result.dissent_summary,
    "No consensus reached among 2 candidate(s)",
  );
});
