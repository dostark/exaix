/**
 * @module GuardrailEventsTest
 * @path packages/core/tests/events/guardrail_events_test.ts
 * @description Unit tests for guardrail domain events and event payload (Phase 107 Step 1).
 */

import { assertEquals } from "@std/assert";
import { DomainEventType } from "../../src/events/mod.ts";

Deno.test("guardrail-domain-event-strings", () => {
  assertEquals(DomainEventType.GuardrailScreenPass, "guardrail.screen.pass");
  assertEquals(DomainEventType.GuardrailScreenViolation, "guardrail.screen.violation");
  assertEquals(DomainEventType.GuardrailScreenError, "guardrail.screen.error");
  assertEquals(DomainEventType.GuardrailWarn, "guardrail.warn");
  assertEquals(DomainEventType.GuardrailBlock, "guardrail.block");
});
