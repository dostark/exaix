/**
 * @module EventRegistryTest
 * @path packages/core/tests/event/event_registry_test.ts
 * @related-files ["packages/core/src/events/domain_event_types.ts", "packages/core/src/events/event_registry.ts"]
 * @architectural-layer Tests
 * @description Verifies DomainEventType enum values and EventRegistry publisher validation.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { DomainEventType, EventRegistry, type IEventRegistry, type TDomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core";

// ============================================================================
// DomainEventType values
// ============================================================================

Deno.test("[EventRegistry] DomainEventType has correct values", () => {
  assertEquals(DomainEventType.FlowStepExecuted, "flow.step.executed");
  assertEquals(DomainEventType.FlowStepReplayed, "flow.step.replayed");
  assertEquals(DomainEventType.FlowStepInvalidated, "flow.step.invalidated");
  assertEquals(DomainEventType.ExecutionContextCompacted, "execution.context.compacted");
  assertEquals(DomainEventType.WaitStateCreated, "wait_state.created");
  assertEquals(DomainEventType.WaitStateResolved, "wait_state.resolved");
  assertEquals(DomainEventType.ChildRunSpawned, "child_run.spawned");
  assertEquals(DomainEventType.ChildRunCompleted, "child_run.completed");
  assertEquals(DomainEventType.ResourceLockAcquired, "resource_lock.acquired");
  assertEquals(DomainEventType.ResourceLockBlocked, "resource_lock.blocked");
  assertEquals(DomainEventType.ResourceLockReleased, "resource_lock.released");
});

Deno.test("[EventRegistry] TDomainEventType resolves from all enum values", () => {
  const values: TDomainEventType[] = Object.values(DomainEventType);
  assertEquals(values.length, 11);
  for (const v of values) {
    assertEquals(typeof v, "string");
  }
});

// ============================================================================
// EventRegistry — construction
// ============================================================================

function createMockLogger(): {
  logger: IEventLogger;
  calls: Array<{ action: string; target: string | null; payload?: LogMetadata }>;
} {
  const calls: Array<{ action: string; target: string | null; payload?: LogMetadata }> = [];
  const logger: IEventLogger = {
    log: () => Promise.resolve(),
    info: (action: string, target: string | null, payload?: LogMetadata) => {
      calls.push({ action, target, payload });
      return Promise.resolve();
    },
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: () => logger,
  };
  return { logger, calls };
}

function createRegistry(): {
  registry: IEventRegistry;
  logger: IEventLogger;
  calls: Array<{ action: string; target: string | null; payload?: LogMetadata }>;
} {
  const { logger, calls } = createMockLogger();
  const registry = new EventRegistry(logger);
  return { registry, logger, calls };
}

Deno.test("[EventRegistry] constructor accepts an IEventLogger", () => {
  const { registry } = createRegistry();
  assertEquals(registry instanceof EventRegistry, true);
});

Deno.test("[EventRegistry] registerPublisher stores sourceId and event types", () => {
  const { registry } = createRegistry();
  registry.registerPublisher("test_source", [
    DomainEventType.FlowStepExecuted,
    DomainEventType.WaitStateCreated,
  ]);
  const publishers = registry.registeredPublishers();
  assertEquals(publishers.has("test_source"), true);
  assertEquals(publishers.get("test_source")?.has(DomainEventType.FlowStepExecuted), true);
  assertEquals(publishers.get("test_source")?.has(DomainEventType.WaitStateCreated), true);
  assertEquals(publishers.get("test_source")?.has(DomainEventType.ChildRunSpawned), false);
});

// ============================================================================
// EventRegistry — emit validation
// ============================================================================

Deno.test("[EventRegistry] emit with unregistered sourceId throws", async () => {
  const { registry } = createRegistry();
  await assertRejects(
    () => registry.emit("unknown_source", DomainEventType.FlowStepExecuted),
    Error,
    "not registered",
  );
});

Deno.test("[EventRegistry] emit with disallowed event type throws", async () => {
  const { registry } = createRegistry();
  registry.registerPublisher("test_source", [DomainEventType.FlowStepExecuted]);
  await assertRejects(
    () => registry.emit("test_source", DomainEventType.WaitStateCreated),
    Error,
    "not registered",
  );
});

Deno.test("[EventRegistry] emit with allowed event type delegates to EventLogger", async () => {
  const { registry, calls } = createRegistry();
  registry.registerPublisher("test_source", [DomainEventType.FlowStepExecuted]);
  await registry.emit("test_source", DomainEventType.FlowStepExecuted, { stepId: "s1" });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].action, "flow.step.executed");
  assertEquals(calls[0].target, "test_source");
  assertEquals(calls[0].payload?.stepId, "s1");
});

Deno.test("[EventRegistry] emit without payload works", async () => {
  const { registry, calls } = createRegistry();
  registry.registerPublisher("test_source", [DomainEventType.FlowStepReplayed]);
  await registry.emit("test_source", DomainEventType.FlowStepReplayed);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].action, "flow.step.replayed");
  assertEquals(calls[0].target, "test_source");
  assertEquals(calls[0].payload, undefined);
});

Deno.test("[EventRegistry] multiple publishers work independently", async () => {
  const { registry, calls } = createRegistry();
  registry.registerPublisher("source_a", [DomainEventType.FlowStepExecuted]);
  registry.registerPublisher("source_b", [DomainEventType.WaitStateCreated]);
  await registry.emit("source_a", DomainEventType.FlowStepExecuted);
  await registry.emit("source_b", DomainEventType.WaitStateCreated);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].target, "source_a");
  assertEquals(calls[1].target, "source_b");
});
