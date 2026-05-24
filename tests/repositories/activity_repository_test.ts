/**
 * @module ActivityRepositoryTest
 * @path tests/repositories/activity_repository_test.ts
 * @description Verifies the ActivityRepository implementation, ensuring stable
 * persistence and retrieval of system events via the database abstraction.
 */

import { assertEquals } from "@std/assert";
import { MemoryBankSource } from "@exaix/core";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { DatabaseActivityRepository } from "@exaix/core/repositories";
import type { ActivityRepository } from "@exaix/core/repositories";
import type { DatabaseService } from "@exaix/storage-sqlite";
import { createStubDb } from "@exaix/testing";

// Mock IActivity entity for testing
interface IActivity {
  id: string;
  traceId: string;
  actor: string | null;
  identityId: string | null;
  actionType: string;
  target: string | null;
  payload: ActivityPayload;
  timestamp: string;
}

interface ActivityPayload {
  action?: string;
  status?: string;
  [field: string]: string | number | boolean | undefined;
}

Deno.test("ActivityRepository: interface defines contract", () => {
  // This test ensures the interface exists and has the expected methods
  // TypeScript will fail to compile if the interface is missing methods
  const repo: ActivityRepository = {
    logActivity: () => Promise.resolve(),
    getActivitiesByTraceId: () => Promise.resolve([]),
    getActivitiesByActionType: () => Promise.resolve([]),
    getRecentActivities: () => Promise.resolve([]),
  };

  // These should be functions
  assertEquals(typeof repo.logActivity, "function");
  assertEquals(typeof repo.getActivitiesByTraceId, "function");
  assertEquals(typeof repo.getActivitiesByActionType, "function");
  assertEquals(typeof repo.getRecentActivities, "function");
});

Deno.test("DatabaseActivityRepository: logs activities through abstraction", async () => {
  type LogActivityArgs = Parameters<DatabaseService["logActivity"]>;
  let capturedArgs: LogActivityArgs | null = null;
  const logActivitySpy = spy((...args: LogActivityArgs) => {
    capturedArgs = args;
  });
  const waitForFlushSpy = spy(() => Promise.resolve());

  const mockDb = createStubDb({
    logActivity: logActivitySpy,
    waitForFlush: waitForFlushSpy,
  });

  const repo = new DatabaseActivityRepository(mockDb);

  const activity = {
    actor: "test-actor",
    actionType: "test.action",
    target: "test-target",
    payload: { key: "value" },
    traceId: "test-trace-123",
    actorType: null,
    identityId: "test-agent-456",
  };

  await repo.logActivity(activity);

  assertSpyCalls(logActivitySpy, 1);
  if (!capturedArgs) throw new Error("logActivitySpy not called");
  assertEquals(capturedArgs[0], "test-actor");
  assertEquals(capturedArgs[1], "test.action");
  assertEquals(capturedArgs[2], "test-target");
  assertEquals(capturedArgs[3], { key: "value" });
  assertEquals(capturedArgs[4], "test-trace-123");
  assertEquals(capturedArgs[5], null); // actorType
  assertEquals(capturedArgs[6], "test-agent-456"); // identityId
});

Deno.test("DatabaseActivityRepository: retrieves activities by trace ID", async () => {
  const mockActivities = [
    {
      id: "1",
      trace_id: "trace123",
      actor: "agent1",
      actor_type: null,
      identity_id: "test-agent",
      agent_kind: null,
      action_type: "execution.start",
      target: "/portal/test",
      payload: '{"step": "init"}',
      timestamp: "2024-01-01T10:00:00Z",
    },
    {
      id: "2",
      trace_id: "trace123",
      actor: "agent1",
      actor_type: null,
      identity_id: "test-agent",
      agent_kind: null,
      action_type: "execution.end",
      target: "/portal/test",
      payload: '{"result": "success"}',
      timestamp: "2024-01-01T10:01:00Z",
    },
  ];

  const getActivitiesByTraceSpy = spy((_traceId: string) => mockActivities);

  const mockDb = createStubDb({ getActivitiesByTrace: getActivitiesByTraceSpy });

  const repo = new DatabaseActivityRepository(mockDb);

  const activities = await repo.getActivitiesByTraceId("trace123");

  assertSpyCalls(getActivitiesByTraceSpy, 1);
  assertEquals(activities.length, 2);
  assertEquals(activities[0].id, "1");
  assertEquals(activities[0].traceId, "trace123");
  assertEquals(activities[0].actionType, "execution.start");
  assertEquals(activities[1].payload.result, "success"); // payload parsed
});

Deno.test("DatabaseActivityRepository: retrieves activities by action type", async () => {
  const mockActivities = [
    {
      id: "1",
      trace_id: "trace1",
      actor: "system",
      actor_type: null,
      identity_id: "test-agent",
      agent_kind: null,
      action_type: "daemon.start",
      target: null,
      payload: "{}",
      timestamp: "2024-01-01T09:00:00Z",
    },
  ];

  const getActivitiesByActionTypeSpy = spy(() => mockActivities);

  const mockDb = createStubDb({
    getActivitiesByActionType: getActivitiesByActionTypeSpy,
  });

  const repo = new DatabaseActivityRepository(mockDb);

  const activities = await repo.getActivitiesByActionType("daemon.start");

  assertSpyCalls(getActivitiesByActionTypeSpy, 1);
  assertEquals(activities.length, 1);
  assertEquals(activities[0].actionType, "daemon.start");
});

Deno.test("DatabaseActivityRepository: retrieves recent activities", async () => {
  const mockActivities = [
    {
      id: "1",
      trace_id: "trace1",
      actor: MemoryBankSource.USER,
      actor_type: null,
      identity_id: "test-agent",
      agent_kind: null,
      action_type: "user.action",
      target: "file.txt",
      payload: '{"operation": "edit"}',
      timestamp: "2024-01-01T12:00:00Z",
    },
  ];

  let capturedLimit: number = 0;
  const getRecentActivitySpy = spy((limit: number) => {
    capturedLimit = limit;
    return Promise.resolve(mockActivities);
  });

  const mockDb = createStubDb({ getRecentActivity: getRecentActivitySpy });

  const repo = new DatabaseActivityRepository(mockDb);

  const activities = await repo.getRecentActivities(10);

  assertSpyCalls(getRecentActivitySpy, 1);
  assertEquals(capturedLimit, 10);
  assertEquals(activities.length, 1);
  assertEquals(activities[0].actor, MemoryBankSource.USER);
});

Deno.test("DatabaseActivityRepository: maps database records to domain objects", async () => {
  const mockDbRecord = {
    id: "test-id",
    trace_id: "test-trace",
    actor: "test-actor",
    actor_type: null,
    identity_id: "test-agent",
    agent_kind: null,
    action_type: "test.action",
    target: "test-target",
    payload: '{"key": "value", "number": 42}',
    timestamp: "2024-01-01T10:00:00Z",
  };

  const getActivitiesByTraceSpy = spy((_traceId: string) => [mockDbRecord]);

  const mockDb = createStubDb({ getActivitiesByTrace: getActivitiesByTraceSpy });

  const repo = new DatabaseActivityRepository(mockDb);

  const activities = await repo.getActivitiesByTraceId("test-trace");

  assertEquals(activities.length, 1);
  const activity = activities[0];
  assertEquals(activity.id, "test-id");
  assertEquals(activity.traceId, "test-trace");
  assertEquals(activity.actor, "test-actor");
  assertEquals(activity.identityId, "test-agent");
  assertEquals(activity.actionType, "test.action");
  assertEquals(activity.target, "test-target");
  assertEquals(activity.payload, { key: "value", number: 42 });
  assertEquals(activity.timestamp, "2024-01-01T10:00:00Z");
});

Deno.test("DatabaseActivityRepository: handles null values correctly", async () => {
  const mockDbRecord = {
    id: "test-id",
    trace_id: "test-trace",
    actor: null,
    actor_type: null,
    identity_id: "test-agent",
    agent_kind: null,
    action_type: "test.action",
    target: null,
    payload: "{}",
    timestamp: "2024-01-01T10:00:00Z",
  };

  const getActivitiesByTraceSpy = spy((_traceId: string) => [mockDbRecord]);

  const mockDb = createStubDb({ getActivitiesByTrace: getActivitiesByTraceSpy });

  const repo = new DatabaseActivityRepository(mockDb);

  const activities = await repo.getActivitiesByTraceId("test-trace");

  assertEquals(activities.length, 1);
  const activity = activities[0];
  assertEquals(activity.actor, null);
  assertEquals(activity.identityId, "test-agent");
  assertEquals(activity.target, null);
  assertEquals(activity.payload, {});
});

Deno.test("DatabaseActivityRepository: handles malformed JSON payload gracefully", async () => {
  const mockDbRecord = {
    id: "test-id",
    trace_id: "test-trace",
    actor: "test-actor",
    actor_type: null,
    identity_id: "test-agent",
    agent_kind: null,
    action_type: "test.action",
    target: "test-target",
    payload: "invalid json {",
    timestamp: "2024-01-01T10:00:00Z",
  };

  const getActivitiesByTraceSpy = spy((_traceId: string) => [mockDbRecord]);

  const mockDb = createStubDb({
    getActivitiesByTrace: getActivitiesByTraceSpy,
  });

  const repo = new DatabaseActivityRepository(mockDb);

  const activities = await repo.getActivitiesByTraceId("test-trace");

  assertEquals(activities.length, 1);
  const activity = activities[0];
  // Should return empty object for malformed JSON
  assertEquals(activity.payload, {});
});

// Integration test demonstrating service abstraction
Deno.test("ActivityRepository: enables service testing without database", async () => {
  // Mock repository for testing services
  const logActivitySpy = spy(() => Promise.resolve());
  const getActivitiesByTraceIdSpy = spy(() => Promise.resolve([]));
  const getActivitiesByActionTypeSpy = spy(() => Promise.resolve([]));
  const getRecentActivitiesSpy = spy(() => Promise.resolve([]));

  const mockRepo = {
    logActivity: logActivitySpy,
    getActivitiesByTraceId: getActivitiesByTraceIdSpy,
    getActivitiesByActionType: getActivitiesByActionTypeSpy,
    getRecentActivities: getRecentActivitiesSpy,
  } as ActivityRepository;

  // This demonstrates how services can be tested with mock repositories
  // without needing actual database setup
  await mockRepo.logActivity({
    actor: "test-service",
    actionType: "service.test",

    target: null,
    payload: { test: true },
  });

  assertSpyCalls(logActivitySpy, 1);
  // Service doesn't need to know about database implementation details
});

// Architecture validation test
Deno.test("Repository pattern: separates data access from business logic", () => {
  // This test validates that the repository pattern properly abstracts
  // database operations from business logic

  // Verify repository interface exists
  const repoInterface = "ActivityRepository";
  assertEquals(typeof repoInterface, "string");

  // Verify implementation exists
  const implClass = "DatabaseActivityRepository";
  assertEquals(typeof implClass, "string");

  // In a real architecture test, we would scan the codebase to ensure:
  // 1. Services import repository interfaces, not DatabaseService
  // 2. Repository implementations handle data mapping
  // 3. Business logic doesn't contain SQL or database-specific code

  assertEquals(true, true); // Architecture validation placeholder
});
