/**
 * @module DomainEventTypes
 * @path packages/core/src/events/domain_event_types.ts
 * @architectural-layer Core
 * @dependencies []
 * @related-files ["packages/core/src/events/event_registry.ts", "packages/core/src/types/constants.ts"]
 * @description Canonical event type definitions for all Exaix domains. Every event
 * type in the system is defined here as a const object to prevent silent event-type
 * typos and establish a single source of truth for the event taxonomy.
 */

export const DomainEventType = {
  // Flow step events
  FlowStepExecuted: "flow.step.executed",
  FlowStepReplayed: "flow.step.replayed",
  FlowStepInvalidated: "flow.step.invalidated",

  // Execution context events
  ExecutionContextCompacted: "execution.context.compacted",

  // Wait state events
  WaitStateCreated: "wait_state.created",
  WaitStateResolved: "wait_state.resolved",

  // Cost tracking events
  LlmUsageRecorded: "llm.usage",

  // Reserved for future use (Phase 85 — postponed)
  ChildRunSpawned: "child_run.spawned",
  ChildRunCompleted: "child_run.completed",

  // Reserved for future use (Phase 86 — cancelled)
  ResourceLockAcquired: "resource_lock.acquired",
  ResourceLockBlocked: "resource_lock.blocked",
  ResourceLockReleased: "resource_lock.released",
} as const;

export type TDomainEventType = typeof DomainEventType[keyof typeof DomainEventType];
