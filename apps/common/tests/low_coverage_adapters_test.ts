/**
 * @module LowCoverageAdaptersTest
 * @path apps/common/tests/low_coverage_adapters_test.ts
 * @description Focused unit tests for low-coverage service adapters.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";

import { RequestAdapter } from "../../../apps/common/adapters/request_adapter.ts";
import { DisplayAdapter } from "../../../apps/common/adapters/display_adapter.ts";
import { JournalServiceAdapter } from "../../../apps/common/adapters/journal_adapter.ts";
import { AgentServiceAdapter } from "../../../apps/common/adapters/agent_adapter.ts";
import { LogServiceAdapter } from "../../../apps/common/adapters/log_adapter.ts";
import { LogLevel, RequestPriority, RequestSource, TaskComplexity, TaskType } from "@exaix/core";
import { RequestStatus } from "@exaix/core/status";
import type { IDatabaseService } from "@exaix/core/types";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "@exaix/core/types";

import { EventLoggerStructuredOutput } from "@exaix/core/logger";
import type { EventLogger } from "@exaix/core/logger";
import type { IEventLoggerOutput } from "@exaix/core/logger";
import type { ILogEvent } from "@exaix/core/types";
import { createMockConfig } from "@exaix/testing";
import { createStubConfig, createStubContext, createStubDb } from "@exaix/testing";

const TEST_DESCRIPTION = "test request";
const TEST_TRACE_ID = "trace-1";
const TEST_AGENT_ROLE_ID = "agent-1";

const toPromise = <T>(value: T): Promise<T> => Promise.resolve(value);

function createRequestMetadata() {
  return {
    trace_id: TEST_TRACE_ID,
    filename: "request.md",
    path: "Workspace/Requests/request.md",
    status: RequestStatus.PENDING,
    priority: RequestPriority.NORMAL,
    agent_role: TEST_AGENT_ROLE_ID,
    created: new Date().toISOString(),
    created_by: "tester",
    source: RequestSource.CLI as const,
  };
}

function createRequestAnalysis(): IRequestAnalysis {
  return {
    goals: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: 100,
    complexity: TaskComplexity.SIMPLE,
    taskType: TaskType.ANALYSIS,
    tags: [],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 0,
      mode: AnalysisMode.HYBRID,
      analyzerVersion: "test",
    },
  };
}

Deno.test("RequestAdapter delegates create/list/show helpers and update status paths", async () => {
  let updateCalled = false;
  const metadata = createRequestMetadata();
  const requestService = {
    create: (description: string) => {
      assertEquals(description, TEST_DESCRIPTION);
      return toPromise(metadata);
    },
    list: () => toPromise([metadata]),
    show: () => toPromise({ metadata, content: "hello" }),
    getRequestContent: () => toPromise("request body"),
    analyze: () => toPromise(createRequestAnalysis()),
    updateRequestStatus: (_requestId: string, _status: string) => {
      updateCalled = true;
      return toPromise(true);
    },
  };

  const adapter = new RequestAdapter(requestService);
  assertEquals(await adapter.create(TEST_DESCRIPTION), metadata);
  assertEquals(await adapter.createRequest(TEST_DESCRIPTION), metadata);
  assertEquals(await adapter.list(), [metadata]);
  assertEquals(await adapter.listRequests(), [metadata]);
  assertEquals((await adapter.show(TEST_TRACE_ID)).content, "hello");
  assertEquals(await adapter.getRequestContent(TEST_TRACE_ID), "request body");

  const updated = await adapter.updateRequestStatus(TEST_TRACE_ID, RequestStatus.COMPLETED);
  assertEquals(updated, true);
  assertEquals(updateCalled, true);

  const noUpdateAdapter = new RequestAdapter({
    create: () => toPromise(metadata),
    list: () => toPromise([metadata]),
    show: () => toPromise({ metadata, content: "ok" }),
    getRequestContent: () => toPromise("ok"),
    analyze: () => toPromise(createRequestAnalysis()),
  });
  assertEquals(await noUpdateAdapter.updateRequestStatus(TEST_TRACE_ID, RequestStatus.COMPLETED), false);
});

Deno.test("DisplayAdapter forwards log calls and defaults target to system", async () => {
  const calls: Array<{ level: string; action: string; target: string | null }> = [];
  const logger = {
    info: (action: string, target: string | null) =>
      toPromise(calls.push({ level: "info", action, target })).then(() => {}),
    warn: (action: string, target: string | null) =>
      toPromise(calls.push({ level: "warn", action, target })).then(() => {}),
    error: (action: string, target: string | null) =>
      toPromise(calls.push({ level: "error", action, target })).then(() => {}),
    debug: (action: string, target: string | null) =>
      toPromise(calls.push({ level: "debug", action, target })).then(() => {}),
    fatal: (action: string, target: string | null) =>
      toPromise(calls.push({ level: "fatal", action, target })).then(() => {}),
  } as EventLogger;

  const adapter = new DisplayAdapter(logger);
  await adapter.info("a");
  await adapter.warn("b", "custom");
  await adapter.error("c");
  await adapter.debug("d");
  await adapter.fatal("e");

  assertEquals(calls.length, 5);
  assertEquals(calls[0].target, "system");
  assertEquals(calls[1].target, "custom");
});

Deno.test("JournalServiceAdapter query and distinct-values handling", async () => {
  const records = [{
    id: "1",
    trace_id: TEST_TRACE_ID,
    actor: "cli",
    actor_type: null,
    agent_role: TEST_AGENT_ROLE_ID,
    agent_kind: null,
    action_type: "run",
    target: "target",
    payload: "{}",
    timestamp: new Date().toISOString(),
  }];

  let preparedAllCalled = false;
  const db = createStubDb({
    queryActivity: () => toPromise(records),
    preparedAll: <T>() => {
      preparedAllCalled = true;
      return toPromise([{ actor: "a" }, { actor: null }, { actor: "b" }] as T[]);
    },
  }) as IDatabaseService;

  const adapter = new JournalServiceAdapter(db);
  assertEquals(await adapter.query({ traceId: TEST_TRACE_ID }), records);

  assertEquals(await adapter.getDistinctValues("actor"), ["a", "b"]);
  assertEquals(preparedAllCalled, true);

  preparedAllCalled = false;
  assertEquals(await adapter.getDistinctValues("invalid_field"), []);
  assertEquals(preparedAllCalled, false);

  const failingDb = createStubDb({
    preparedAll: () => Promise.reject(new Error("db failed")),
  }) as IDatabaseService;
  const failingAdapter = new JournalServiceAdapter(failingDb);
  assertEquals(await failingAdapter.getDistinctValues("actor"), []);
});

Deno.test("AgentServiceAdapter list/health/log helpers", async () => {
  const missingDirRoot = await Deno.makeTempDir({ prefix: "agent-adapter-missing-" });
  const missingConfig = createMockConfig(missingDirRoot);
  const missingContext = createStubContext({ config: createStubConfig(missingConfig) });

  const missingDirAdapter = new AgentServiceAdapter(missingContext);
  const defaultAgents = await missingDirAdapter.listAgents();
  assertEquals(defaultAgents.length, 1);
  assertEquals(defaultAgents[0].id, "system");

  const existingDirRoot = await Deno.makeTempDir({ prefix: "agent-adapter-existing-" });
  try {
    const existingConfig = createMockConfig(existingDirRoot);
    const agentRolesDir = join(existingDirRoot, existingConfig.paths.workspace, existingConfig.paths.agents);
    await Deno.mkdir(agentRolesDir, { recursive: true });
    await Deno.writeTextFile(join(agentRolesDir, "alpha.json"), "{}");
    await Deno.mkdir(join(agentRolesDir, "beta"), { recursive: true });

    const context = createStubContext({ config: createStubConfig(existingConfig), db: createStubDb() });
    const adapter = new AgentServiceAdapter(context);
    const listed = await adapter.listAgents();
    const ids = listed.map((item) => item.id).sort();
    assertEquals(ids, ["alpha", "beta"]);

    const health = await adapter.getAgentHealth("alpha");
    assertEquals(health.status, "healthy");
    assertEquals(await adapter.getAgentLogs("alpha"), []);
  } finally {
    await Deno.remove(missingDirRoot, { recursive: true }).catch(() => {});
    await Deno.remove(existingDirRoot, { recursive: true }).catch(() => {});
  }
});

Deno.test("LogServiceAdapter handles filtering, subscriptions, and export", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "log-adapter-" });
  const jsonlPath = join(tempDir, "events.jsonl");

  const eventA: ILogEvent = {
    action: "a",
    target: "t1",
    traceId: "t1",
    agentRole: "ag1",
    level: LogLevel.INFO,
    payload: { correlation_id: "c1" },
  };
  const eventB: ILogEvent = {
    action: "b",
    target: "t2",
    traceId: "t2",
    agentRole: "ag2",
    level: LogLevel.ERROR,
    payload: { correlation_id: "c2" },
  };

  try {
    const output = new EventLoggerStructuredOutput(jsonlPath);
    const loggerLike = { getOutputs: () => [output] };
    const adapter = new LogServiceAdapter(loggerLike);

    // Write events through EventLoggerStructuredOutput
    output.write(eventA);
    output.write(eventB);
    // Wait for async file writes to complete
    await new Promise((r) => setTimeout(r, 50));

    const allLogs = await adapter.getStructuredLogs({ limit: 10 });
    assertEquals(allLogs.length, 2);

    const filtered = await adapter.getLogsByTraceId("t1");
    assertEquals(filtered.length, 1);
    assert(filtered[0].message.includes("a"));

    const byAgent = await adapter.getLogsByAgentId("ag2");
    assertEquals(byAgent.length, 1);

    // Test subscriptions
    let observed = 0;
    const unsubscribe = adapter.subscribeToLogs(() => {
      observed += 1;
    });
    output.write(eventA);
    assertEquals(observed, 1);
    unsubscribe();
    output.write(eventB);
    assertEquals(observed, 1);

    // Test export
    const exportPath = join(tempDir, "export.jsonl");
    await adapter.exportLogs(exportPath, allLogs);
    const exported = await Deno.readTextFile(exportPath);
    assert(exported.includes('"message"'));
    assert(exported.includes('"a: t1"'));

    // Test no-file case
    const noFileOutput = { getOutputs: () => [] as IEventLoggerOutput[] };
    assertEquals(await new LogServiceAdapter(noFileOutput).getStructuredLogs({}), []);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
