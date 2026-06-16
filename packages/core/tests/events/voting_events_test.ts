/**
 * @module VotingEventsTest
 * @path packages/core/tests/events/voting_events_test.ts
 * @description Unit tests for voting domain events and event payload (Phase 113 Step 1).
 */

import { assertEquals } from "@std/assert";
import { DomainEventType } from "../../src/events/mod.ts";

Deno.test("voting-domain-event-strings", () => {
  assertEquals(DomainEventType.VotingStarted, "voting.started");
  assertEquals(DomainEventType.VotingResolved, "voting.resolved");
  assertEquals(DomainEventType.VotingNoConsensus, "voting.no_consensus");
  assertEquals(DomainEventType.VotingRunnerFailed, "voting.runner_failed");
});
