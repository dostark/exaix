/**
 * @module ExecutionVerificationEventsTest
 * @path packages/core/tests/events/execution_verification_events_test.ts
 * @related-files ["packages/core/src/events/domain_event_types.ts"]
 * @architectural-layer Core
 * @description Pins the wire values of the six post-execution verification events.
 */

import { assertEquals } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";

Deno.test("execution verification event strings", () => {
  assertEquals(DomainEventType.ExecutionVerificationStarted, "execution.verification.started");
  assertEquals(DomainEventType.ExecutionVerificationPassed, "execution.verification.passed");
  assertEquals(DomainEventType.ExecutionVerificationFailed, "execution.verification.failed");
  assertEquals(DomainEventType.ExecutionRepairStarted, "execution.repair.started");
  assertEquals(DomainEventType.ExecutionRepairCompleted, "execution.repair.completed");
  assertEquals(DomainEventType.ExecutionVerificationExhausted, "execution.verification.exhausted");
});
