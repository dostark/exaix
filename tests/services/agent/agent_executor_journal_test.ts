/**
 * @module AgentExecutorJournalTest
 * @path tests/services/agent/agent_executor_journal_test.ts
 * @description Verifies AgentExecutor journal calls use correct Actor/Agent/Identity field separation.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { AgentExecutor } from "../../../src/services/agent/agent_executor.ts";
import type { EventLogger } from "../../../src/services/core/event_logger.ts";
import type { ILogEvent } from "../../../src/services/common/types.ts";
import { ActorType, AgentKind } from "../../../src/shared/enums.ts";
import type { DatabaseService } from "../../../src/services/core/db.ts";
import type { PathResolver } from "../../../src/services/portal/path_resolver.ts";
import type { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import type { IChangesetResult } from "../../../src/shared/schemas/agent_executor.ts";
import { createMockConfig } from "../../helpers/config.ts";

/**
 * Tests for Step 55.3: AgentExecutor journal field separation
 *
 * Success Criteria:
 * - Test 1: logExecutionStart writes agentId='agent-executor' and identityId=blueprintSlug
 * - Test 2: logExecutionComplete writes agentId='agent-executor' and identityId=blueprintSlug
 * - Test 3: logExecutionError writes agentId='agent-executor' and identityId=blueprintSlug
 * - Test 4: REGRESSION: agentId must never be set to an identity blueprint slug
 */

function createMockLogger(eventCapture: ILogEvent[]): Partial<EventLogger> {
  return {
    log: function (e: ILogEvent): Promise<void> {
      eventCapture.push(e);
      return Promise.resolve();
    },
  } as Partial<EventLogger>;
}

function createMockConfigForTest(): ReturnType<typeof createMockConfig> {
  return createMockConfig("/tmp/test");
}

Deno.test("AgentExecutor: logExecutionStart writes correct field separation", async () => {
  // Arrange
  const loggedEvents: ILogEvent[] = [];
  const mockLogger = createMockLogger(loggedEvents);
  const mockConfig = createMockConfigForTest();
  const mockDb = {} as Partial<DatabaseService>;
  const mockPathResolver = {} as Partial<PathResolver>;
  const mockPermissions = {} as Partial<PortalPermissionsService>;

  const executor = new AgentExecutor(
    mockConfig,
    mockDb as DatabaseService,
    mockLogger as EventLogger,
    mockPathResolver as PathResolver,
    mockPermissions as PortalPermissionsService,
  );

  // Act
  await executor.logExecutionStart("trace-123", "senior-coder", "my-portal");

  // Assert
  assertEquals(loggedEvents.length, 1);
  const event = loggedEvents[0];
  assertEquals(event.agentId, "agent-executor"); // constant — the runtime agent
  assertEquals(event.agentKind, AgentKind.AGENT_EXECUTOR);
  assertEquals(event.identityId, "senior-coder"); // the blueprint slug
  assertEquals(event.actor, "system");
  assertEquals(event.actorType, ActorType.SERVICE);
  // KEY: agentId must differ from identityId
  assertNotEquals(event.agentId, event.identityId);

  executor.dispose();
});

Deno.test("AgentExecutor: logExecutionComplete writes correct field separation", async () => {
  // Arrange
  const loggedEvents: ILogEvent[] = [];
  const mockLogger = createMockLogger(loggedEvents);
  const mockConfig = createMockConfigForTest();
  const mockDb = {} as Partial<DatabaseService>;
  const mockPathResolver = {} as Partial<PathResolver>;
  const mockPermissions = {} as Partial<PortalPermissionsService>;

  const executor = new AgentExecutor(
    mockConfig,
    mockDb as DatabaseService,
    mockLogger as EventLogger,
    mockPathResolver as PathResolver,
    mockPermissions as PortalPermissionsService,
  );

  const mockResult: IChangesetResult = {
    branch: "feature/test",
    commit_sha: "abc123def456",
    files_changed: ["file1.ts"],
    description: "Test changes",
    tool_calls: 5,
    execution_time_ms: 1000,
  };

  // Act
  await executor.logExecutionComplete("trace-456", "code-reviewer", mockResult);

  // Assert
  assertEquals(loggedEvents.length, 1);
  const event = loggedEvents[0];
  assertEquals(event.agentId, "agent-executor");
  assertEquals(event.agentKind, AgentKind.AGENT_EXECUTOR);
  assertEquals(event.identityId, "code-reviewer");
  assertEquals(event.actor, "system");
  assertEquals(event.actorType, ActorType.SERVICE);
  assertNotEquals(event.agentId, event.identityId);

  executor.dispose();
});

Deno.test("AgentExecutor: logExecutionError writes correct field separation", async () => {
  // Arrange
  const loggedEvents: ILogEvent[] = [];
  const mockLogger = createMockLogger(loggedEvents);
  const mockConfig = createMockConfigForTest();
  const mockDb = {} as Partial<DatabaseService>;
  const mockPathResolver = {} as Partial<PathResolver>;
  const mockPermissions = {} as Partial<PortalPermissionsService>;

  const executor = new AgentExecutor(
    mockConfig,
    mockDb as DatabaseService,
    mockLogger as EventLogger,
    mockPathResolver as PathResolver,
    mockPermissions as PortalPermissionsService,
  );

  const errorPayload = {
    type: "execution_error",
    message: "Test error message",
  };

  // Act
  await executor.logExecutionError("trace-789", "test-agent", errorPayload);

  // Assert
  assertEquals(loggedEvents.length, 1);
  const event = loggedEvents[0];
  assertEquals(event.agentId, "agent-executor");
  assertEquals(event.agentKind, AgentKind.AGENT_EXECUTOR);
  assertEquals(event.identityId, "test-agent");
  assertEquals(event.actor, "system");
  assertEquals(event.actorType, ActorType.SERVICE);
  // target should be the identity that failed
  assertEquals(event.target, "test-agent");
  assertNotEquals(event.agentId, event.identityId);

  executor.dispose();
});

Deno.test("AgentExecutor: REGRESSION - agentId must never be identity blueprint slug", async () => {
  // Arrange
  const loggedEvents: ILogEvent[] = [];
  const mockLogger = createMockLogger(loggedEvents);
  const mockConfig = createMockConfigForTest();
  const mockDb = {} as Partial<DatabaseService>;
  const mockPathResolver = {} as Partial<PathResolver>;
  const mockPermissions = {} as Partial<PortalPermissionsService>;

  const executor = new AgentExecutor(
    mockConfig,
    mockDb as DatabaseService,
    mockLogger as EventLogger,
    mockPathResolver as PathResolver,
    mockPermissions as PortalPermissionsService,
  );

  // Act - log with identityId = "senior-coder"
  await executor.logExecutionStart("trace-999", "senior-coder", "test-portal");

  // Assert - most important regression guard
  const event = loggedEvents[0];
  assertNotEquals(event.agentId, "senior-coder");
  assertEquals(event.agentId, "agent-executor");
  assertEquals(event.identityId, "senior-coder");

  executor.dispose();
});
