/**
 * @module TriggerAdaptersTest
 * @path packages/triggers/tests/adapters_test.ts
 * @description Tests for built-in trigger adapters: CLI and internal-event.
 * @architectural-layer Triggers
 * @related-files [packages/triggers/adapters/cli_adapter.ts, packages/triggers/adapters/internal_event_adapter.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { CliAdapter } from "../adapters/cli_adapter.ts";
import { InternalEventAdapter } from "../adapters/internal_event_adapter.ts";

Deno.test("[CliAdapter] source is cli", () => {
  const adapter = new CliAdapter();
  assertEquals(adapter.source, "cli");
});

Deno.test("[CliAdapter] parses valid CLI invocation", async () => {
  const adapter = new CliAdapter();
  const envelope = await adapter.parse({
    args: ["run", "test-suite"],
    cwd: "/home/user/project",
  });
  assertEquals(envelope.source, "cli");
  assertEquals(envelope.action, "start_flow");
  assertExists(envelope.triggerId);
  assertExists(envelope.idempotencyKey);
  assertEquals(envelope.subject, "run test-suite");
});

Deno.test("[InternalEventAdapter] source is internal_event", () => {
  const adapter = new InternalEventAdapter();
  assertEquals(adapter.source, "internal_event");
});

Deno.test("[InternalEventAdapter] parses valid internal event", async () => {
  const adapter = new InternalEventAdapter();
  const envelope = await adapter.parse({
    eventType: "flow.step.completed",
    flowId: "flow-123",
    stepId: "step-1",
  });
  assertEquals(envelope.source, "internal_event");
  assertEquals(envelope.action, "append_signal");
  assertExists(envelope.triggerId);
  assertExists(envelope.idempotencyKey);
  assertEquals(envelope.subject, "flow.step.completed");
  assertEquals(envelope.payload?.eventType, "flow.step.completed");
  assertEquals(envelope.payload?.flowId, "flow-123");
});
