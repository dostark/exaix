/**
 * @module VotingCapabilityModuleTest
 * @path packages-team/voting/tests/voting_capability_module_test.ts
 * @description Unit tests for VotingCapabilityModule — registers VotingStepHandler.
 */

import { assertEquals } from "@std/assert";
import type { ISeamRegistryPlaceholder } from "@exaix/core/composer";
import type { IVotingConsensusService } from "@exaix/core/types";
import type { VotingGroupConfig, VotingResult } from "@exaix/schemas/voting.ts";
import { VotingStrategy } from "@exaix/core/types";
import { VotingCapabilityModule } from "../mod.ts";
import { createMockLogger } from "@exaix/testing";

// Narrowing helper: SpyRegistry → ISeamRegistryPlaceholder
function toSeamPlaceholder(registry: { register(h: { stepType: string }): void }): ISeamRegistryPlaceholder {
  return registry;
}

// Test doubles

class StubVotingService implements IVotingConsensusService {
  run(_config: VotingGroupConfig, _basePrompt: string, _traceId: string): Promise<VotingResult> {
    return Promise.resolve({
      trace_id: "trace-stub",
      strategy: VotingStrategy.MAJORITY,
      winner: { runner_id: "stub", response: "stub" },
      candidates: [{ runner_id: "stub", response: "stub" }],
      consensus_reached: true,
    });
  }
}

class SpyRegistry {
  readonly registrations: Array<{ stepType: string }> = [];

  register(handler: { stepType: string }): void {
    this.registrations.push({ stepType: handler.stepType });
  }

  registerWithKey(key: string, _handler: { stepType: string }): void {
    this.registrations.push({ stepType: key });
  }
}

// Tests

Deno.test("[voting] VotingCapabilityModule registers VotingStepHandler for voting_group", () => {
  const votingService = new StubVotingService();
  const logger = createMockLogger();
  const module = new VotingCapabilityModule(votingService, logger);

  const registry = new SpyRegistry();
  module.registerFlowStepHandlers(toSeamPlaceholder(registry));

  assertEquals(registry.registrations.length, 2);
  assertEquals(registry.registrations[0].stepType, "voting_group");
  assertEquals(registry.registrations[1].stepType, "consensus");
});
