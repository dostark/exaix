/**
 * @module EventLoggerIdentityFieldsTest
 * @path packages/core/tests/event/event_logger_identity_fields_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Verifies that EventLogger correctly forwards Actor/Agent/Identity separation fields to IActivityRepository.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { EventLogger } from "@exaix/core/logger";
import type { IActivityRepository, ILogActivityRequest } from "@exaix/core/repositories";
import { ActorType, RuntimeKind } from "@exaix/core";

Deno.test("EventLogger: passes all separation fields through to logActivity", async () => {
  // Arrange
  const capturedRequests: ILogActivityRequest[] = [];
  const mockRepo: IActivityRepository = {
    logActivity: (req) => {
      capturedRequests.push(req);
      return Promise.resolve();
    },
    getActivitiesByTraceId: () => Promise.resolve([]),
    getActivitiesByActionType: () => Promise.resolve([]),
    getRecentActivities: () => Promise.resolve([]),
  };
  const logger = new EventLogger({ activityRepo: mockRepo });

  // Act
  await logger.log({
    action: "test.event",
    target: "some-portal",
    actor: "user:test@example.com",
    actorType: ActorType.USER,
    agentKind: RuntimeKind.AGENT_EXECUTOR,
    agentRole: "senior-coder",
    traceId: "trace-abc-123",
  });

  // Assert
  assertEquals(capturedRequests.length, 1);
  const req = capturedRequests[0];
  assertEquals(req.actor, "user:test@example.com");
  assertEquals(req.actorType, ActorType.USER);
  assertEquals(req.agentKind, RuntimeKind.AGENT_EXECUTOR);
  assertEquals(req.agentRole, "senior-coder");
  assertEquals(req.traceId, "trace-abc-123");
});

Deno.test("EventLogger: passes null for optional fields when not provided", async () => {
  // Arrange
  const capturedRequests: ILogActivityRequest[] = [];
  const mockRepo: IActivityRepository = {
    logActivity: (req) => {
      capturedRequests.push(req);
      return Promise.resolve();
    },
    getActivitiesByTraceId: () => Promise.resolve([]),
    getActivitiesByActionType: () => Promise.resolve([]),
    getRecentActivities: () => Promise.resolve([]),
  };
  const logger = new EventLogger({ activityRepo: mockRepo });

  // Act - log without actorType, agentKind, agentRole
  await logger.log({
    action: "test.event",
    target: "some-portal",
    actor: "system",
  });

  // Assert
  assertEquals(capturedRequests.length, 1);
  const req = capturedRequests[0];
  assertEquals(req.actorType, null);
  assertEquals(req.agentKind, null);
  assertEquals(req.agentRole, null);
});

Deno.test("EventLogger: does NOT put blueprint slug into agentKind field", async () => {
  // Arrange
  const capturedRequests: ILogActivityRequest[] = [];
  const mockRepo: IActivityRepository = {
    logActivity: (req) => {
      capturedRequests.push(req);
      return Promise.resolve();
    },
    getActivitiesByTraceId: () => Promise.resolve([]),
    getActivitiesByActionType: () => Promise.resolve([]),
    getRecentActivities: () => Promise.resolve([]),
  };
  const logger = new EventLogger({ activityRepo: mockRepo });

  // Act - log with distinct agentRole and agentKind
  await logger.log({
    action: "test.event",
    target: "some-portal",
    actor: "system",
    agentKind: RuntimeKind.AGENT_EXECUTOR,
    agentRole: "senior-coder",
  });

  // Assert - key regression guard: agentKind must NOT equal agentRole
  const req = capturedRequests[0];
  assertNotEquals(req.agentKind, "senior-coder");
  assertNotEquals(req.agentKind, req.agentRole);
  assertEquals(req.agentRole, "senior-coder");
  assertEquals(req.agentKind, RuntimeKind.AGENT_EXECUTOR);
});
