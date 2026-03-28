/**
 * @module AgentExecutorJournalTest
 * @path tests/services/agent_executor_journal_test.ts
 * @description Verifies AgentExecutor journal calls use correct Actor/Agent/Identity field separation.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { AgentExecutor } from "../../../src/services/agent_executor.ts";
import type { EventLogger } from "../../../src/services/event_logger.ts";
import type { ILogEvent } from "../../../src/services/common/types.ts";
import { ActorType, AgentKind } from "../../../src/shared/enums.ts";
import type { Config } from "../../../src/shared/schemas/config.ts";
import type { DatabaseService } from "../../../src/services/db.ts";
import type { PathResolver } from "../../../src/services/path_resolver.ts";
import type { PortalPermissionsService } from "../../../src/services/portal_permissions.ts";
import type { IChangesetResult } from "../../../src/shared/schemas/agent_executor.ts";

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

function createMockConfig(): Config {
  return {
    system: { root: "/tmp/test", version: "1.0.0", log_level: "info", schema_version: "1.0.0" },
    paths: {
      memory: "./Memory",
      blueprints: "./Blueprints",
      runtime: "./.exa",
      workspace: "./Workspace",
      portals: "./Portals",
      active: "Active",
      archive: "Archive",
      plans: "Plans",
      requests: "Requests",
      rejected: "Rejected",
      identities: "Identities",
      flows: "Flows",
      memoryProjects: "Projects",
      memoryExecution: "Execution",
      memoryIndex: "Index",
      memorySkills: "Skills",
      memoryPending: "Pending",
      memoryTasks: "Tasks",
      memoryGlobal: "Global",
    },
    database: { sqlite: { journal_mode: "WAL", foreign_keys: true, busy_timeout_ms: 5000 } },
    agents: { default_model: "default", timeout_sec: 60, max_iterations: 10 },
    models: { default: { provider: "mock", model: "gpt-5.2-pro", timeout_ms: 30000 } },
    mock: { delay_ms: 0, input_tokens: 0, output_tokens: 0 },
    mcp: { enabled: false, servers: [] },
    git: { author_name: "Test", author_email: "test@test.com" },
    tools: { enabled: [] },
    health: { enabled: false },
    skills: { enabled: false },
    memory: { enabled: false },
    notifications: { enabled: false },
    reviews: { enabled: false },
    artifacts: { enabled: false },
    plans_config: { enabled: false },
    requests_config: { enabled: false },
    identities_config: { enabled: false },
    flows_config: { enabled: false },
    portals_config: { enabled: false },
    ai: { providers: [] },
    security: { mode: "sandboxed" },
    request_analysis: { enabled: false },
    quality_gates: { enabled: false },
  } as Config;
}

Deno.test("AgentExecutor: logExecutionStart writes correct field separation", async () => {
  // Arrange
  const loggedEvents: ILogEvent[] = [];
  const mockLogger = createMockLogger(loggedEvents);
  const mockConfig = createMockConfig();
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
});

Deno.test("AgentExecutor: logExecutionComplete writes correct field separation", async () => {
  // Arrange
  const loggedEvents: ILogEvent[] = [];
  const mockLogger = createMockLogger(loggedEvents);
  const mockConfig = createMockConfig();
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
});

Deno.test("AgentExecutor: logExecutionError writes correct field separation", async () => {
  // Arrange
  const loggedEvents: ILogEvent[] = [];
  const mockLogger = createMockLogger(loggedEvents);
  const mockConfig = createMockConfig();
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
});

Deno.test("AgentExecutor: REGRESSION - agentId must never be identity blueprint slug", async () => {
  // Arrange
  const loggedEvents: ILogEvent[] = [];
  const mockLogger = createMockLogger(loggedEvents);
  const mockConfig = createMockConfig();
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
});
