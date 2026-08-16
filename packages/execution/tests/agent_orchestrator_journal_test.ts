/**
 * @module AgentExecutorJournalTest
 * @path packages/execution/tests/agent_orchestrator_journal_test.ts
 * @description Verifies AgentOrchestrator journal calls use correct Actor/Agent/Identity field separation.
 */

import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { AgentOrchestrator } from "@exaix/execution";
import type { IEventLogger } from "@exaix/core/logger";
import type { ILogEvent } from "@exaix/core";
import type { JSONValue, LogMetadata } from "@exaix/core/types";
import { ActorType, AgentKind, LogLevel } from "@exaix/core";
import {
  AGENT_EVENT_EXECUTION_COMPLETED,
  AGENT_EVENT_EXECUTION_STARTED,
  AGENT_EVENT_OUTPUT,
  AGENT_EVENT_SECURITY_VIOLATION,
} from "@exaix/core";
import type { DatabaseService } from "@exaix/storage-sqlite";
import type { PathResolver, PortalPermissionsService } from "@exaix/portal";
import type { IChangesetResult } from "@exaix/schemas/agent_orchestrator.ts";
import { createMockConfig } from "@exaix/testing";

/**
 * Tests for Step 55.3: AgentOrchestrator journal field separation
 *
 * Success Criteria:
 * - Test 1: logExecutionStart writes agentId='agent-executor' and identityId=blueprintSlug
 * - Test 2: logExecutionComplete writes agentId='agent-executor' and identityId=blueprintSlug
 * - Test 3: logExecutionError writes agentId='agent-executor' and identityId=blueprintSlug
 * - Test 4: REGRESSION: agentId must never be set to an identity blueprint slug
 */

function createMockLogger(eventCapture: ILogEvent[]): IEventLogger {
  const log = (e: ILogEvent): Promise<void> => {
    eventCapture.push(e);
    return Promise.resolve();
  };
  const logAtLevel = (
    level: LogLevel,
    action: string,
    target: string | null,
    payload?: LogMetadata,
    traceId?: string,
  ): Promise<void> =>
    log({ level, action, target: target ?? "", payload: payload as Record<string, JSONValue>, traceId });

  return {
    log,
    info: (action, target, payload, traceId) => logAtLevel(LogLevel.INFO, action, target, payload, traceId),
    warn: (action, target, payload, traceId) => logAtLevel(LogLevel.WARN, action, target, payload, traceId),
    error: (action, target, payload, traceId) => logAtLevel(LogLevel.ERROR, action, target, payload, traceId),
    fatal: (action, target, payload, traceId) => logAtLevel(LogLevel.FATAL, action, target, payload, traceId),
    debug: (action, target, payload, traceId) => logAtLevel(LogLevel.DEBUG, action, target, payload, traceId),
    child: (_overrides: Partial<ILogEvent>): IEventLogger => createMockLogger(eventCapture),
  };
}

function createMockConfigForTest(): ReturnType<typeof createMockConfig> {
  return createMockConfig("/tmp/test");
}

function createExecutorHarness(): { executor: AgentOrchestrator; loggedEvents: ILogEvent[] } {
  const loggedEvents: ILogEvent[] = [];
  const executor = new AgentOrchestrator({
    config: createMockConfigForTest(),
    db: {} as Partial<DatabaseService> as DatabaseService,
    logger: createMockLogger(loggedEvents),
    pathResolver: {} as Partial<PathResolver> as PathResolver,
    permissions: {} as Partial<PortalPermissionsService> as PortalPermissionsService,
  });

  return { executor, loggedEvents };
}

Deno.test("AgentOrchestrator: logExecutionStart writes correct field separation", async () => {
  const { executor, loggedEvents } = createExecutorHarness();

  // Act
  await executor.logExecutionStart("trace-123", "senior-coder", "my-portal");

  // Assert
  assertEquals(loggedEvents.length, 1);
  const event = loggedEvents[0];
  assertEquals(event.action, AGENT_EVENT_EXECUTION_STARTED);
  assertEquals(event.agentId, "agent-executor"); // constant — the runtime agent
  assertEquals(event.agentKind, AgentKind.AGENT_EXECUTOR);
  assertEquals(event.identityId, "senior-coder"); // the blueprint slug
  assertEquals(event.actor, "system");
  assertEquals(event.actorType, ActorType.SERVICE);
  // KEY: agentId must differ from identityId
  assertNotEquals(event.agentId, event.identityId);

  executor.dispose();
});

Deno.test("AgentOrchestrator: logExecutionComplete writes correct field separation", async () => {
  const { executor, loggedEvents } = createExecutorHarness();

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
  assertEquals(event.action, AGENT_EVENT_EXECUTION_COMPLETED);
  assertEquals(event.agentId, "agent-executor");
  assertEquals(event.agentKind, AgentKind.AGENT_EXECUTOR);
  assertEquals(event.identityId, "code-reviewer");
  assertEquals(event.actor, "system");
  assertEquals(event.actorType, ActorType.SERVICE);
  assertNotEquals(event.agentId, event.identityId);
  assertExists(event.payload);
  type CompletionPayload = { usage?: { tokens?: number; cost_usd_estimate?: number } };
  const usage = (event.payload as CompletionPayload).usage;
  assertExists(usage);
  assertEquals(typeof usage.tokens, "number");
  assertEquals(typeof usage.cost_usd_estimate, "number");

  executor.dispose();
});

Deno.test("AgentOrchestrator: logExecutionError writes correct field separation", async () => {
  const { executor, loggedEvents } = createExecutorHarness();

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

Deno.test("AgentOrchestrator: REGRESSION - agentId must never be identity blueprint slug", async () => {
  const { executor, loggedEvents } = createExecutorHarness();

  // Act - log with identityId = "senior-coder"
  await executor.logExecutionStart("trace-999", "senior-coder", "test-portal");

  // Assert - most important regression guard
  const event = loggedEvents[0];
  assertNotEquals(event.agentId, "senior-coder");
  assertEquals(event.agentId, "agent-executor");
  assertEquals(event.identityId, "senior-coder");

  executor.dispose();
});

Deno.test("Agent event constants: exported values match the journal contract", () => {
  assertEquals(AGENT_EVENT_EXECUTION_STARTED, "agent.execution_started");
  assertEquals(AGENT_EVENT_EXECUTION_COMPLETED, "agent.execution_completed");
  assertEquals(AGENT_EVENT_OUTPUT, "agent.output");
  assertEquals(AGENT_EVENT_SECURITY_VIOLATION, "security.violation");
});
