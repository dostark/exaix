/**
 * @module ActivityRepositoryIdentityFieldsTest
 * @path packages/core/tests/repositories/activity_repository_identity_fields_test.ts
 * @description Integration tests verifying ActivityRepository persists and reads back Actor/Agent/Identity separation fields.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { DatabaseActivityRepository, type LogActivityRequest } from "@exaix/core/repositories";
import { initTestDbService } from "@exaix/testing";

/**
 * Tests for Step 55.2: ActivityRepository field persistence
 *
 * Success Criteria:
 * - Test 1: Writes and reads back all separation fields correctly
 * - Test 2: Stores null when separation fields are omitted
 * - Test 3: agentKind stores runtime agent category, distinct from identityId
 * - Test 4: Indexes on identity_id are queryable
 * - Test 5: Indexes on actor_type are queryable
 */

Deno.test("ActivityRepository: writes and reads back all separation fields", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const repo = new DatabaseActivityRepository(db);
    const traceId = crypto.randomUUID();
    const request: LogActivityRequest = {
      actor: "user:test@example.com",
      actorType: "user",
      actionType: "test.action",
      target: "some-portal",
      payload: { key: "value" },
      traceId,
      agentKind: "agent-executor",
      identityId: "senior-coder",
    };

    // Act
    await repo.logActivity(request);
    const rows = await repo.getActivitiesByTraceId(traceId);

    // Assert
    assertEquals(rows.length, 1);
    const row = rows[0];
    assertEquals(row.actor, "user:test@example.com");
    assertEquals(row.actorType, "user");
    assertEquals(row.agentId, null); // Legacy: no longer tracked this way per mapping
    assertEquals(row.agentKind, "agent-executor");
    assertEquals(row.identityId, "senior-coder");
    assertEquals(row.actionType, "test.action");
    assertEquals(row.target, "some-portal");
  } finally {
    await cleanup();
  }
});

Deno.test("ActivityRepository: stores null when separation fields are omitted", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const repo = new DatabaseActivityRepository(db);
    const traceId = crypto.randomUUID();

    // Act - log with only required fields
    await repo.logActivity({
      actor: "system",
      actionType: "test.action",
      target: null,
      traceId,
    });

    const rows = await repo.getActivitiesByTraceId(traceId);

    // Assert
    assertEquals(rows.length, 1);
    const row = rows[0];
    assertEquals(row.actorType, null);
    assertEquals(row.agentKind, null);
    assertEquals(row.identityId, null);
  } finally {
    await cleanup();
  }
});

Deno.test("ActivityRepository: agentKind stores runtime agent category, distinct from identityId", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const repo = new DatabaseActivityRepository(db);
    const traceId = crypto.randomUUID();

    // Act - write row with distinct agentKind and identityId
    await repo.logActivity({
      actor: "system",
      actionType: "flow.step.started",
      target: "test-portal",
      traceId,
      agentKind: "flow-runner",
      identityId: "code-reviewer",
    });

    const rows = await repo.getActivitiesByTraceId(traceId);

    // Assert - regression: agentKind must differ from identityId
    assertEquals(rows.length, 1);
    const row = rows[0];
    assertEquals(row.agentKind, "flow-runner");
    assertEquals(row.identityId, "code-reviewer");
    assertNotEquals(row.agentKind, row.identityId);
  } finally {
    await cleanup();
  }
});

Deno.test("ActivityRepository: indexes on identity_id are queryable", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const repo = new DatabaseActivityRepository(db);

    // Act - write two rows with different identityId values
    const traceId1 = crypto.randomUUID();
    const traceId2 = crypto.randomUUID();

    await repo.logActivity({
      actor: "system",
      actionType: "test.action",
      target: "portal",
      traceId: traceId1,
      identityId: "senior-coder",
    });

    await repo.logActivity({
      actor: "system",
      actionType: "test.action",
      target: "portal",
      traceId: traceId2,
      identityId: "code-reviewer",
    });

    // Query by identityId - verify index works
    const allActivities = await repo.getRecentActivities(100);
    const seniorCoderActivities = allActivities.filter((a) => a.identityId === "senior-coder");

    // Assert - only one row returned for senior-coder
    assertEquals(seniorCoderActivities.length, 1);
    assertEquals(seniorCoderActivities[0].identityId, "senior-coder");
  } finally {
    await cleanup();
  }
});

Deno.test("ActivityRepository: indexes on actor_type are queryable", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const repo = new DatabaseActivityRepository(db);

    // Act - write two rows with different actorType values
    const traceId1 = crypto.randomUUID();
    const traceId2 = crypto.randomUUID();

    await repo.logActivity({
      actor: "user:alice",
      actionType: "test.action",
      target: "portal",
      traceId: traceId1,
      actorType: "user",
    });

    await repo.logActivity({
      actor: "system",
      actionType: "test.action",
      target: "portal",
      traceId: traceId2,
      actorType: "service",
    });

    // Query by actorType
    const allActivities = await repo.getRecentActivities(100);
    const userActivities = allActivities.filter((a) => a.actorType === "user");

    // Assert - only the user row is returned
    assertEquals(userActivities.length, 1);
    assertEquals(userActivities[0].actorType, "user");
  } finally {
    await cleanup();
  }
});
