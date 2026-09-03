// deno-lint-ignore-file no-explicit-any
/**
 * @module PortalMemoryAdaptersTest
 * @path apps/common/tests/portal_memory_adapters_test.ts
 * @description Focused unit tests for low-coverage service adapters:
 *   PortalAdapter, MemoryServiceAdapter, ArchiveAdapter,
 *   FlowValidatorAdapter, DaemonServiceAdapter.
 */

import { assertEquals } from "@std/assert";
import { PortalAdapter } from "../../../apps/common/adapters/portal_adapter.ts";
import type { IPortalDetails, IPortalInfo } from "@exaix/core/types";
import { DEFAULT_SKILL_INDEX_VERSION } from "@exaix/core";
import { ArchiveStatus, DaemonStatus, PortalExecutionStrategy, PortalStatus, VerificationStatus } from "@exaix/core";
import type { PortalService } from "@exaix/portal";
import { MemoryServiceAdapter } from "../../../apps/common/adapters/memory_adapter.ts";
import type { MemoryBankService } from "@exaix/memory";
import type { MemoryExtractorService } from "@exaix/memory";
import { ArchiveAdapter } from "../../../apps/common/adapters/archive_adapter.ts";
import type { ArchiveEntry, ArchiveService } from "@exaix/core/artifact";
import { FlowValidatorAdapter } from "../../../apps/common/adapters/flow_validator_adapter.ts";
import type { FlowValidatorImpl } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";
import { DaemonServiceAdapter } from "../../../apps/common/adapters/daemon_adapter.ts";
import type { DaemonCommands } from "../../../apps/exactl/src/commands/daemon_commands.ts";
import type { ConfigAdapter as _ConfigAdapter } from "../../../apps/common/adapters/config_adapter.ts";
import type { ConfigService as _ConfigService } from "@exaix/core/config";
import { join } from "@std/path";

// PortalAdapter

function createMockPortalService(overrides: Partial<PortalService> = {}): PortalService {
  const defaultDetails: IPortalDetails = {
    alias: "myportal",
    targetPath: "/target",
    symlinkPath: "/symlink",
    contextCardPath: "/ctx",
    status: PortalStatus.ACTIVE,
    permissions: "Read/Write",
  };
  const defaultInfo: IPortalInfo = {
    alias: "myportal",
    targetPath: "/target",
    symlinkPath: "/symlink",
    contextCardPath: "/ctx",
    status: PortalStatus.ACTIVE,
  };

  return ({
    add: () => Promise.resolve(),
    list: () => Promise.resolve([defaultInfo]),
    show: () => Promise.resolve(defaultDetails),
    remove: () => Promise.resolve(),
    verify: () => Promise.resolve([{ alias: "myportal", status: VerificationStatus.OK }]),
    refresh: () => Promise.resolve(),
    ...overrides,
  } as any) as PortalService;
}

Deno.test("PortalAdapter: add delegates with options", async () => {
  let capturedAlias = "";
  let capturedPath = "";
  let capturedOptions: { defaultBranch?: string; executionStrategy?: PortalExecutionStrategy } | undefined;

  const service = createMockPortalService({
    add: (targetPath: string, alias: string, options) => {
      capturedPath = targetPath;
      capturedAlias = alias;
      capturedOptions = options;
      return Promise.resolve();
    },
  });

  const adapter = new PortalAdapter(service);
  await adapter.add("/my/path", "test-portal", {
    defaultBranch: "develop",
    executionStrategy: PortalExecutionStrategy.WORKTREE,
  });

  assertEquals(capturedPath, "/my/path");
  assertEquals(capturedAlias, "test-portal");
  assertEquals(capturedOptions?.defaultBranch, "develop");
  assertEquals(capturedOptions?.executionStrategy, PortalExecutionStrategy.WORKTREE);
});

Deno.test("PortalAdapter: list and listPortals delegate correctly", async () => {
  const adapter = new PortalAdapter(createMockPortalService());
  const list = await adapter.list();
  assertEquals(list.length, 1);
  assertEquals(list[0].alias, "myportal");

  const listPortals = await adapter.listPortals();
  assertEquals(listPortals.length, 1);
  assertEquals(listPortals[0].alias, "myportal");
});

Deno.test("PortalAdapter: show and getPortalDetails delegate correctly", async () => {
  const adapter = new PortalAdapter(createMockPortalService());
  const details = await adapter.show("myportal");
  assertEquals(details.alias, "myportal");
  assertEquals(details.permissions, "Read/Write");

  const detailsAlias = await adapter.getPortalDetails("myportal");
  assertEquals(detailsAlias.alias, "myportal");
});

Deno.test("PortalAdapter: remove and removePortal delegate correctly", async () => {
  let removeCalled = false;
  let capturedOptions: { keepCard?: boolean } | undefined;

  const service = createMockPortalService({
    remove: (_alias: string, options?: { keepCard?: boolean }) => {
      removeCalled = true;
      capturedOptions = options;
      return Promise.resolve();
    },
  });

  const adapter = new PortalAdapter(service);
  await adapter.remove("myportal", { keepCard: true });
  assertEquals(removeCalled, true);
  assertEquals(capturedOptions?.keepCard, true);

  // removePortal returns true on success
  const result = await adapter.removePortal("myportal");
  assertEquals(result, true);
});

Deno.test("PortalAdapter: removePortal returns false on error", async () => {
  const service = createMockPortalService({
    remove: () => Promise.reject(new Error("Not found")),
  });
  const adapter = new PortalAdapter(service);
  const result = await adapter.removePortal("missing");
  assertEquals(result, false);
});

Deno.test("PortalAdapter: verify delegates", async () => {
  const service = createMockPortalService({
    verify: (alias?: string) =>
      Promise.resolve([{
        alias: alias ?? "all",
        status: VerificationStatus.OK as const,
      }]),
  });
  const adapter = new PortalAdapter(service);
  const results = await adapter.verify("myportal");
  assertEquals(results.length, 1);
  assertEquals(results[0].alias, "myportal");
});

Deno.test("PortalAdapter: refresh and refreshPortal delegates", async () => {
  let refreshedAlias = "";
  const service = createMockPortalService({
    refresh: (alias: string) => {
      refreshedAlias = alias;
      return Promise.resolve();
    },
  });
  const adapter = new PortalAdapter(service);

  await adapter.refresh("myportal");
  assertEquals(refreshedAlias, "myportal");

  const result = await adapter.refreshPortal("myportal");
  assertEquals(result, true);
});

Deno.test("PortalAdapter: refreshPortal returns false on error", async () => {
  const service = createMockPortalService({
    refresh: () => Promise.reject(new Error("Not found")),
  });
  const adapter = new PortalAdapter(service);
  const result = await adapter.refreshPortal("missing");
  assertEquals(result, false);
});

Deno.test("PortalAdapter: openPortal and closePortal are stubs", async () => {
  const adapter = new PortalAdapter(createMockPortalService());
  assertEquals(await adapter.openPortal("myportal"), true);
  assertEquals(await adapter.closePortal("myportal"), true);
});

Deno.test("PortalAdapter: getPortalFilesystemPath and quickJumpToPortalDir", async () => {
  const adapter = new PortalAdapter(createMockPortalService());
  const path = await adapter.getPortalFilesystemPath("myportal");
  assertEquals(path, "/target");

  const jumpPath = await adapter.quickJumpToPortalDir("myportal");
  assertEquals(jumpPath, "/target");
});

Deno.test("PortalAdapter: getPortalActivityLog returns placeholder", () => {
  const adapter = new PortalAdapter(createMockPortalService());
  const log = adapter.getPortalActivityLog("myportal");
  assertEquals(log.length, 1);
  assertEquals(log[0].includes("not yet implemented"), true);
});

// MemoryServiceAdapter

function createMockMemoryBank(overrides: Partial<MemoryBankService> = {}): MemoryBankService {
  return ({
    getProjects: () => Promise.resolve(["alpha", "beta"]),
    getProjectMemory: () => Promise.resolve(null),
    getGlobalMemory: () => Promise.resolve(null),
    getExecutionByTraceId: () => Promise.resolve(null),
    getExecutionHistory: () => Promise.resolve([]),
    searchMemory: () => Promise.resolve([]),
    ...overrides,
  } as any) as MemoryBankService;
}

function createMockExtractor(overrides: Partial<MemoryExtractorService> = {}): MemoryExtractorService {
  return ({
    listPending: () => Promise.resolve([]),
    getPending: () => Promise.resolve(null),
    approvePending: () => Promise.resolve(),
    rejectPending: () => Promise.resolve(),
    ...overrides,
  } as any) as MemoryExtractorService;
}

Deno.test("MemoryServiceAdapter: getProjects delegates", async () => {
  const adapter = new MemoryServiceAdapter(createMockMemoryBank(), createMockExtractor());
  const projects = await adapter.getProjects();
  assertEquals(projects, ["alpha", "beta"]);
});

Deno.test("MemoryServiceAdapter: getProjectMemory delegates", async () => {
  const mockMemory = { portal: "test", overview: "", patterns: [], decisions: [], references: [] };
  const adapter = new MemoryServiceAdapter(
    createMockMemoryBank({
      getProjectMemory: () => Promise.resolve(mockMemory),
    }),
    createMockExtractor(),
  );
  const result = await adapter.getProjectMemory("test");
  assertEquals(result?.portal, "test");
});

Deno.test("MemoryServiceAdapter: getGlobalMemory delegates", async () => {
  const mockGlobal = { overview: "", patterns: [], decisions: [], references: [] };
  const adapter = new MemoryServiceAdapter(
    createMockMemoryBank(
      ({
        getGlobalMemory: () => Promise.resolve(mockGlobal),
      } as any) as MemoryBankService,
    ),
    createMockExtractor(),
  );
  const result = await adapter.getGlobalMemory();
  assertEquals(result !== null, true);
});

Deno.test("MemoryServiceAdapter: getExecutionByTraceId delegates", async () => {
  const adapter = new MemoryServiceAdapter(createMockMemoryBank(), createMockExtractor());
  const result = await adapter.getExecutionByTraceId("trace-123");
  assertEquals(result, null);
});

Deno.test("MemoryServiceAdapter: getExecutionHistory delegates with options", async () => {
  let capturedPortal: string | undefined;
  let capturedLimit: number | undefined;

  const adapter = new MemoryServiceAdapter(
    createMockMemoryBank({
      getExecutionHistory: (portal?: string, limit?: number) => {
        capturedPortal = portal;
        capturedLimit = limit;
        return Promise.resolve([]);
      },
    }),
    createMockExtractor(),
  );

  await adapter.getExecutionHistory({ portal: "myportal", limit: 10 });
  assertEquals(capturedPortal, "myportal");
  assertEquals(capturedLimit, 10);
});

Deno.test("MemoryServiceAdapter: getExecutionHistory without options", async () => {
  let capturedPortal: string | undefined;
  let capturedLimit: number | undefined;

  const adapter = new MemoryServiceAdapter(
    createMockMemoryBank({
      getExecutionHistory: (portal?: string, limit?: number) => {
        capturedPortal = portal;
        capturedLimit = limit;
        return Promise.resolve([]);
      },
    }),
    createMockExtractor(),
  );

  await adapter.getExecutionHistory();
  assertEquals(capturedPortal, undefined);
  assertEquals(capturedLimit, undefined);
});

Deno.test("MemoryServiceAdapter: search delegates with options", async () => {
  let capturedQuery = "";
  let capturedOptions: { portal?: string; limit?: number } | undefined;

  const adapter = new MemoryServiceAdapter(
    createMockMemoryBank({
      searchMemory: (query: string, options?: { portal?: string; limit?: number }) => {
        capturedQuery = query;
        capturedOptions = options;
        return Promise.resolve([]);
      },
    }),
    createMockExtractor(),
  );

  await adapter.search("test query", { portal: "myportal", limit: 5 });
  assertEquals(capturedQuery, "test query");
  assertEquals(capturedOptions?.portal, "myportal");
  assertEquals(capturedOptions?.limit, 5);
});

Deno.test("MemoryServiceAdapter: listPending delegates to extractor", async () => {
  const mockProposals = [{ id: "p1", status: "pending" }];
  const adapter = new MemoryServiceAdapter(
    createMockMemoryBank(),
    createMockExtractor(
      ({
        listPending: () => Promise.resolve(mockProposals),
      } as any) as MemoryExtractorService,
    ),
  );
  const pending = await adapter.listPending();
  assertEquals(pending.length, 1);
});

Deno.test("MemoryServiceAdapter: getPending delegates to extractor", async () => {
  const adapter = new MemoryServiceAdapter(createMockMemoryBank(), createMockExtractor());
  const result = await adapter.getPending("p1");
  assertEquals(result, null);
});

Deno.test("MemoryServiceAdapter: approvePending delegates to extractor", async () => {
  let approvedId = "";
  const adapter = new MemoryServiceAdapter(
    createMockMemoryBank(),
    createMockExtractor({
      approvePending: (id: string) => {
        approvedId = id;
        return Promise.resolve();
      },
    }),
  );
  await adapter.approvePending("p1");
  assertEquals(approvedId, "p1");
});

Deno.test("MemoryServiceAdapter: rejectPending delegates to extractor", async () => {
  let rejectedId = "";
  let rejectionReason = "";
  const adapter = new MemoryServiceAdapter(
    createMockMemoryBank(),
    createMockExtractor({
      rejectPending: (id: string, reason: string) => {
        rejectedId = id;
        rejectionReason = reason;
        return Promise.resolve();
      },
    }),
  );
  await adapter.rejectPending("p1", "not relevant");
  assertEquals(rejectedId, "p1");
  assertEquals(rejectionReason, "not relevant");
});

// ArchiveAdapter

function createMockArchiveService(overrides: Partial<ArchiveService> = {}): ArchiveService {
  const sampleEntry: ArchiveEntry = {
    trace_id: "00000000-0000-0000-0000-000000000001",
    request_id: "req-1",
    agent_role: "agent-1",
    archived_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    status: ArchiveStatus.COMPLETED,
    step_count: 3,
    duration_ms: 1500,
    tags: ["test"],
  };

  return ({
    searchByDateRange: () => Promise.resolve([sampleEntry]),
    searchByAgent: () => Promise.resolve([sampleEntry]),
    getByTraceId: () => Promise.resolve(sampleEntry),
    ...overrides,
  } as any) as ArchiveService;
}

Deno.test("ArchiveAdapter: searchByDateRange delegates", async () => {
  let capturedStart = "";
  let capturedEnd = "";
  const service = createMockArchiveService({
    searchByDateRange: (start: string, end: string) => {
      capturedStart = start;
      capturedEnd = end;
      return Promise.resolve([]);
    },
  });
  const adapter = new ArchiveAdapter(service);
  const results = await adapter.searchByDateRange("2025-01-01", "2025-12-31");
  assertEquals(results, []);
  assertEquals(capturedStart, "2025-01-01");
  assertEquals(capturedEnd, "2025-12-31");
});

Deno.test("ArchiveAdapter: searchByAgent delegates", async () => {
  let capturedAgentId = "";
  const service = createMockArchiveService({
    searchByAgent: (identityId: string) => {
      capturedAgentId = identityId;
      return Promise.resolve([]);
    },
  });
  const adapter = new ArchiveAdapter(service);
  await adapter.searchByAgent("agent-1");
  assertEquals(capturedAgentId, "agent-1");
});

Deno.test("ArchiveAdapter: getByTraceId delegates and handles null", async () => {
  const adapter = new ArchiveAdapter(createMockArchiveService());
  const result = await adapter.getByTraceId("00000000-0000-0000-0000-000000000001");
  assertEquals(result !== null, true);
  assertEquals(result?.trace_id, "00000000-0000-0000-0000-000000000001");

  // Test when inner returns undefined
  const emptyAdapter = new ArchiveAdapter(
    createMockArchiveService({
      getByTraceId: () => Promise.resolve(undefined),
    }),
  );
  const nullResult = await emptyAdapter.getByTraceId("missing");
  assertEquals(nullResult, null);
});

Deno.test("ArchiveAdapter: getTrace delegates to getByTraceId", async () => {
  let capturedId = "";
  const service = createMockArchiveService({
    getByTraceId: (traceId: string) => {
      capturedId = traceId;
      return Promise.resolve(undefined);
    },
  });
  const adapter = new ArchiveAdapter(service);
  await adapter.getTrace("trace-1");
  assertEquals(capturedId, "trace-1");
});

// FlowValidatorAdapter

function createMockFlowValidatorImpl(overrides: Partial<FlowValidatorImpl> = {}): FlowValidatorImpl {
  return ({
    validate: () => Promise.resolve({ isValid: true, errors: [], warnings: [] }),
    validateFile: () => Promise.resolve({ isValid: true, errors: [], warnings: [] }),
    ...overrides,
  } as any) as FlowValidatorImpl;
}

Deno.test("FlowValidatorAdapter: validate delegates and returns structured result", async () => {
  const adapter = new FlowValidatorAdapter(createMockFlowValidatorImpl());
  const flow: IFlow = ({ id: "test-flow", name: "Test", steps: [] } as any) as IFlow;
  const result = await adapter.validate(flow);
  assertEquals(result.isValid, true);
  assertEquals(result.errors, []);
  assertEquals(result.warnings, []);
});

Deno.test("FlowValidatorAdapter: validate with errors", async () => {
  const inner = createMockFlowValidatorImpl({
    validate: () =>
      Promise.resolve({
        isValid: false,
        errors: ["Step 'process' has invalid agent"],
        warnings: ["Deprecated output format"],
      }),
  });
  const adapter = new FlowValidatorAdapter(inner);
  const result = await adapter.validate(({ id: "bad-flow", name: "Bad", steps: [] } as any) as IFlow);
  assertEquals(result.isValid, false);
  assertEquals(result.errors.length, 1);
  assertEquals(result.warnings.length, 1);
});

Deno.test("FlowValidatorAdapter: validate maps missing warnings to empty array", async () => {
  const inner = createMockFlowValidatorImpl(
    ({
      validate: () =>
        Promise.resolve({
          isValid: true,
          errors: [],
        }),
    } as any) as FlowValidatorImpl,
  );
  const adapter = new FlowValidatorAdapter(inner);
  const result = await adapter.validate(({ id: "f", name: "F", steps: [] } as any) as IFlow);
  assertEquals(result.warnings, []);
});

Deno.test("FlowValidatorAdapter: validateFile delegates and returns structured result", async () => {
  const adapter = new FlowValidatorAdapter(createMockFlowValidatorImpl());
  const result = await adapter.validateFile("/path/to/flow.ts");
  assertEquals(result.isValid, true);
});

Deno.test("FlowValidatorAdapter: validateFile with errors", async () => {
  const inner = createMockFlowValidatorImpl(
    ({
      validateFile: () =>
        Promise.resolve({
          isValid: false,
          errors: ["File not found"],
        }),
    } as any) as FlowValidatorImpl,
  );
  const adapter = new FlowValidatorAdapter(inner);
  const result = await adapter.validateFile("/bad/path");
  assertEquals(result.isValid, false);
  assertEquals(result.errors[0], "File not found");
  assertEquals(result.warnings, []);
});

// DaemonServiceAdapter

function createMockDaemonCommands(
  overrides: Partial<DaemonCommands> = {},
  configRoot?: string,
): DaemonCommands {
  return ({
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    restart: () => Promise.resolve(),
    status: () =>
      Promise.resolve({ running: false, version: "0.0.0", workspace_schema_version: DEFAULT_SKILL_INDEX_VERSION }),
    getConfig: () =>
      configRoot
        ? {
          system: { root: configRoot },
          paths: { runtime: "Runtime" },
        }
        : null,
    ...overrides,
  } as any) as DaemonCommands;
}

Deno.test("DaemonServiceAdapter: start/stop/restart delegate", async () => {
  let started = false;
  let stopped = false;
  let restarted = false;

  const commands = createMockDaemonCommands({
    start: () => {
      started = true;
      return Promise.resolve();
    },
    stop: () => {
      stopped = true;
      return Promise.resolve();
    },
    restart: () => {
      restarted = true;
      return Promise.resolve();
    },
  });

  const adapter = new DaemonServiceAdapter(commands);
  await adapter.start();
  assertEquals(started, true);
  await adapter.stop();
  assertEquals(stopped, true);
  await adapter.restart();
  assertEquals(restarted, true);
});

Deno.test("DaemonServiceAdapter: getStatus returns RUNNING when daemon is running", async () => {
  const commands = createMockDaemonCommands({
    status: () =>
      Promise.resolve({ running: true, version: "1.0.0", workspace_schema_version: DEFAULT_SKILL_INDEX_VERSION }),
  });
  const adapter = new DaemonServiceAdapter(commands);
  assertEquals(await adapter.getStatus(), DaemonStatus.RUNNING);
});

Deno.test("DaemonServiceAdapter: getStatus returns STOPPED when daemon is stopped", async () => {
  const commands = createMockDaemonCommands({
    status: () =>
      Promise.resolve({ running: false, version: "1.0.0", workspace_schema_version: DEFAULT_SKILL_INDEX_VERSION }),
  });
  const adapter = new DaemonServiceAdapter(commands);
  assertEquals(await adapter.getStatus(), DaemonStatus.STOPPED);
});

Deno.test("DaemonServiceAdapter: getLogs reads from log file when exists", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "daemon-adapter-" });
  try {
    const runtimeDir = join(tempDir, "Runtime");
    await Deno.mkdir(runtimeDir, { recursive: true });
    const logFile = join(runtimeDir, "daemon.log");
    const logContent = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    await Deno.writeTextFile(logFile, logContent);

    const commands = createMockDaemonCommands({}, tempDir);
    const adapter = new DaemonServiceAdapter(commands);
    const logs = await adapter.getLogs();

    // Should return last 50 lines
    assertEquals(logs.length, 50);
    assertEquals(logs[0], "line 10");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("DaemonServiceAdapter: getLogs returns message when no log file", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "daemon-adapter-nologs-" });
  try {
    const commands = createMockDaemonCommands({}, tempDir);
    const adapter = new DaemonServiceAdapter(commands);
    const logs = await adapter.getLogs();
    assertEquals(logs.length, 1);
    assertEquals(logs[0].includes("No logs found"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("DaemonServiceAdapter: getLogs returns message when config is null", async () => {
  const commands = createMockDaemonCommands(
    ({
      getConfig: () => null,
    } as any) as DaemonCommands,
  );
  const adapter = new DaemonServiceAdapter(commands);
  const logs = await adapter.getLogs();
  assertEquals(logs.length, 1);
  assertEquals(logs[0], "Configuration not available.");
});

Deno.test("DaemonServiceAdapter: getErrors returns empty array", async () => {
  const adapter = new DaemonServiceAdapter(createMockDaemonCommands());
  const errors = await adapter.getErrors();
  assertEquals(errors, []);
});
