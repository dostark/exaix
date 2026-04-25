/**
 * @module EventLoggerIdentityFieldsTest
 * @path tests/services/event/event_logger_identity_fields_test.ts
 * @description Verifies that EventLogger correctly forwards Actor/Agent/Identity separation fields to ActivityRepository.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import type { ActivityRepository, LogActivityRequest } from "../../../src/repositories/activity_repository.ts";
import { ActorType, AgentKind } from "@exaix/core";

/**
 * Tests for Step 55.1: EventLogger field forwarding
 *
 * Success Criteria:
 * - Test 1: EventLogger passes actorType, agentKind, identityId through to logActivity
 * - Test 2: EventLogger passes null for optional fields when not provided
 * - Test 3: EventLogger does NOT put blueprint slug (identity) into agentKind field
 */

Deno.test("EventLogger: passes all separation fields through to logActivity", async () => {
  // Arrange
  const capturedRequests: LogActivityRequest[] = [];
  const mockRepo: ActivityRepository = {
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
    agentKind: AgentKind.AGENT_EXECUTOR,
    identityId: "senior-coder",
    traceId: "trace-abc-123",
  });

  // Assert
  assertEquals(capturedRequests.length, 1);
  const req = capturedRequests[0];
  assertEquals(req.actor, "user:test@example.com");
  assertEquals(req.actorType, ActorType.USER);
  assertEquals(req.agentKind, AgentKind.AGENT_EXECUTOR);
  assertEquals(req.identityId, "senior-coder");
  assertEquals(req.traceId, "trace-abc-123");
});

Deno.test("EventLogger: passes null for optional fields when not provided", async () => {
  // Arrange
  const capturedRequests: LogActivityRequest[] = [];
  const mockRepo: ActivityRepository = {
    logActivity: (req) => {
      capturedRequests.push(req);
      return Promise.resolve();
    },
    getActivitiesByTraceId: () => Promise.resolve([]),
    getActivitiesByActionType: () => Promise.resolve([]),
    getRecentActivities: () => Promise.resolve([]),
  };
  const logger = new EventLogger({ activityRepo: mockRepo });

  // Act - log without actorType, agentKind, identityId
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
  assertEquals(req.identityId, null);
});

Deno.test("EventLogger: does NOT put blueprint slug into agentKind field", async () => {
  // Arrange
  const capturedRequests: LogActivityRequest[] = [];
  const mockRepo: ActivityRepository = {
    logActivity: (req) => {
      capturedRequests.push(req);
      return Promise.resolve();
    },
    getActivitiesByTraceId: () => Promise.resolve([]),
    getActivitiesByActionType: () => Promise.resolve([]),
    getRecentActivities: () => Promise.resolve([]),
  };
  const logger = new EventLogger({ activityRepo: mockRepo });

  // Act - log with distinct identityId and agentKind
  await logger.log({
    action: "test.event",
    target: "some-portal",
    actor: "system",
    agentKind: AgentKind.AGENT_EXECUTOR,
    identityId: "senior-coder",
  });

  // Assert - key regression guard: agentKind must NOT equal identityId
  const req = capturedRequests[0];
  assertNotEquals(req.agentKind, "senior-coder");
  assertNotEquals(req.agentKind, req.identityId);
  assertEquals(req.identityId, "senior-coder");
  assertEquals(req.agentKind, AgentKind.AGENT_EXECUTOR);
});
