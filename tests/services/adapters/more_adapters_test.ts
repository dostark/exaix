// deno-lint-ignore-file no-explicit-any
/**
 * @module MoreAdaptersTest
 * @path tests/services/adapters/more_adapters_test.ts
 * @description Unit tests for ConfigAdapter, MemoryBankAdapter, and MemoryExtractorAdapter.
 */

import { assertEquals } from "@std/assert";
import { ConfigAdapter } from "../../../src/services/adapters/config_adapter.ts";
import { MemoryBankAdapter } from "../../../src/services/adapters/memory_bank_adapter.ts";
import { MemoryExtractorAdapter } from "../../../src/services/adapters/memory_extractor_adapter.ts";
import { ConfigService } from "../../../src/config/service.ts";
import { MemoryBankService } from "../../../src/services/memory/memory_bank.ts";
import { MemoryExtractorService } from "../../../src/services/memory/memory_extractor.ts";
import { MemoryType, PortalExecutionStrategy } from "@exaix/core";
import type { Config } from "@exaix/schemas/config.ts";

function cast<T>(obj: any): T {
  return obj as T;
}

// ──────────────────────────────────────────────────────────────────────
// ConfigAdapter
// ──────────────────────────────────────────────────────────────────────

function createMockConfigService(overrides: Partial<ConfigService> = {}): ConfigService {
  return Object.assign(Object.create(ConfigService.prototype), {
    get: () => ({ system: { root: "/root" }, paths: { workspace: "W", requests: "R" } }),
    getConfigPath: () => "/path/to/config.json",
    reload: () => ({}),
    addPortal: () => Promise.resolve(),
    removePortal: () => Promise.resolve(),
    getPortals: () => [],
    getPortal: () => undefined,
    ...overrides,
  });
}

Deno.test("ConfigAdapter: delegates all methods", async () => {
  let addCalled = false;
  let removeCalled = false;
  let reloadCalled = false;

  const service = createMockConfigService({
    addPortal: (alias, path, options) => {
      assertEquals(alias, "p");
      assertEquals(path, "/t");
      assertEquals(options?.executionStrategy, PortalExecutionStrategy.WORKTREE);
      addCalled = true;
      return Promise.resolve();
    },
    removePortal: (alias) => {
      assertEquals(alias, "p");
      removeCalled = true;
      return Promise.resolve();
    },
    reload: () => {
      reloadCalled = true;
      return cast<Config>({});
    },
  });

  const adapter = new ConfigAdapter(service);

  adapter.get();
  adapter.getAll();
  assertEquals(adapter.getConfigPath(), "/path/to/config.json");
  await adapter.addPortal("p", "/t", { executionStrategy: PortalExecutionStrategy.WORKTREE });
  await adapter.removePortal("p");
  adapter.reload();
  adapter.getPortals();
  adapter.getPortal("p");

  assertEquals(addCalled, true);
  assertEquals(removeCalled, true);
  assertEquals(reloadCalled, true);
});

// ──────────────────────────────────────────────────────────────────────
// MemoryBankAdapter
// ──────────────────────────────────────────────────────────────────────

function createMockMemoryBankService(overrides: Partial<MemoryBankService> = {}): MemoryBankService {
  return Object.assign(Object.create(MemoryBankService.prototype), {
    getProjectMemory: () => Promise.resolve(null),
    createProjectMemory: () => Promise.resolve(),
    updateProjectMemory: () => Promise.resolve(),
    addPattern: () => Promise.resolve(),
    addDecision: () => Promise.resolve(),
    createExecutionRecord: () => Promise.resolve(),
    getExecutionByTraceId: () => Promise.resolve(null),
    getExecutionHistory: () => Promise.resolve([]),
    getGlobalMemory: () => Promise.resolve(null),
    initGlobalMemory: () => Promise.resolve(),
    addGlobalLearning: () => Promise.resolve(),
    promoteLearning: () => Promise.resolve("new-id"),
    demoteLearning: () => Promise.resolve(),
    searchMemory: () => Promise.resolve([]),
    searchByTags: () => Promise.resolve([]),
    searchByKeyword: () => Promise.resolve([]),
    searchMemoryAdvanced: () => Promise.resolve([]),
    getRecentActivity: () => Promise.resolve([]),
    rebuildIndices: () => Promise.resolve(),
    rebuildIndicesWithEmbeddings: () => Promise.resolve(),
    getProjects: () => Promise.resolve(["alpha"]),
    ...overrides,
  });
}

Deno.test("MemoryBankAdapter: delegates project and execution methods", async () => {
  let addPatternCalled = false;
  let addDecisionCalled = false;
  let promoteCalled = false;

  const service = createMockMemoryBankService({
    addPattern: () => {
      addPatternCalled = true;
      return Promise.resolve();
    },
    addDecision: () => {
      addDecisionCalled = true;
      return Promise.resolve();
    },
    promoteLearning: () => {
      promoteCalled = true;
      return Promise.resolve("id");
    },
  });

  const adapter = new MemoryBankAdapter(service);

  const projectRecord = cast<Parameters<MemoryBankAdapter["createProjectMemory"]>[0]>({});
  const patternRecord = cast<Parameters<MemoryBankAdapter["addPattern"]>[1]>({});
  const decisionRecord = cast<Parameters<MemoryBankAdapter["addDecision"]>[1]>({});
  const executionRecord = cast<Parameters<MemoryBankAdapter["createExecutionRecord"]>[0]>({});
  const promotionRecord = cast<Parameters<MemoryBankAdapter["promoteLearning"]>[1]>({ type: MemoryType.PATTERN });
  await adapter.getProjectMemory("p");
  await adapter.createProjectMemory(projectRecord); // fallback to parameter bypassing temporarily
  await adapter.updateProjectMemory("p", {});
  await adapter.addPattern("p", patternRecord);
  await adapter.addDecision("p", decisionRecord);
  await adapter.createExecutionRecord(executionRecord);
  await adapter.getExecutionByTraceId("t");
  await adapter.getExecutionHistory("p", 5);
  await adapter.promoteLearning("p", promotionRecord);
  await adapter.demoteLearning("id", "p");

  assertEquals(addPatternCalled, true);
  assertEquals(addDecisionCalled, true);
  assertEquals(promoteCalled, true);
});

Deno.test("MemoryBankAdapter: delegates global and search methods", async () => {
  let initGlobalCalled = false;
  let rebuildCalled = false;
  const learningRecord = cast<Parameters<MemoryBankAdapter["addGlobalLearning"]>[0]>({});
  const embeddingService = cast<Parameters<MemoryBankAdapter["rebuildIndicesWithEmbeddings"]>[0]>({});

  const service = createMockMemoryBankService({
    initGlobalMemory: () => {
      initGlobalCalled = true;
      return Promise.resolve();
    },
    rebuildIndices: () => {
      rebuildCalled = true;
      return Promise.resolve();
    },
  });

  const adapter = new MemoryBankAdapter(service);

  await adapter.getGlobalMemory();
  await adapter.initGlobalMemory();
  await adapter.addGlobalLearning(learningRecord);
  await adapter.searchMemory("q");
  await adapter.searchByTags(["t"]);
  await adapter.searchByKeyword("k");
  await adapter.searchMemoryAdvanced({ tags: ["t"], keyword: "k", portal: "p", limit: 10 });
  await adapter.getRecentActivity(10);
  await adapter.rebuildIndices();
  await adapter.rebuildIndicesWithEmbeddings(embeddingService);
  assertEquals(await adapter.getProjects(), ["alpha"]);

  assertEquals(initGlobalCalled, true);
  assertEquals(rebuildCalled, true);
});

// ──────────────────────────────────────────────────────────────────────
// MemoryExtractorAdapter
// ──────────────────────────────────────────────────────────────────────

function createMockMemoryExtractorService(overrides: Partial<MemoryExtractorService> = {}): MemoryExtractorService {
  return Object.assign(Object.create(MemoryExtractorService.prototype), {
    analyzeExecution: () => [],
    createProposal: () => Promise.resolve("prop-1"),
    listPending: () => Promise.resolve([]),
    getPending: () => Promise.resolve(null),
    approvePending: () => Promise.resolve(),
    rejectPending: () => Promise.resolve(),
    approveAll: () => Promise.resolve(5),
    ...overrides,
  });
}

Deno.test("MemoryExtractorAdapter: delegates all methods", async () => {
  let approveCalled = false;
  let rejectCalled = false;

  const service = createMockMemoryExtractorService({
    approvePending: (id) => {
      assertEquals(id, "1");
      approveCalled = true;
      return Promise.resolve();
    },
    rejectPending: (id) => {
      assertEquals(id, "2");
      rejectCalled = true;
      return Promise.resolve();
    },
  });

  const adapter = new MemoryExtractorAdapter(service);

  assertEquals(await adapter.listPending(), []);
  assertEquals(await adapter.getPending("1"), null);

  const learning = cast<Parameters<MemoryExtractorAdapter["createProposal"]>[0]>({
    type: "pattern",
    name: "p",
    title: "t",
    description: "d",
    category: "insight",
    confidence: 0.9,
    tags: [],
  });
  const execution = cast<Parameters<MemoryExtractorAdapter["createProposal"]>[1]>({ trace_id: "t" });
  await adapter.analyzeExecution(execution);
  await adapter.createProposal(learning, execution, "identityId");
  await adapter.approvePending("1");
  await adapter.rejectPending("2", "Reason");
  assertEquals(await adapter.approveAll(), 5);

  assertEquals(approveCalled, true);
  assertEquals(rejectCalled, true);
});
