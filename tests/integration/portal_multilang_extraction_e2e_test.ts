/**
 * @module PortalMultilangExtractionE2ETest
 * @path tests/integration/portal_multilang_extraction_e2e_test.ts
 * @description End-to-end tests for multi-language symbol extraction (Phase 119):
 * verifies that a Python portal yields a populated symbolMap via the default
 * Solo registry, an unregistered language (Rust) yields [], and a mixed
 * portal extracts only the dominant language's symbols (fail-soft on others).
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts,
 *   packages/portal/knowledge/symbol_extractor_registry.ts]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { PortalAnalysisMode } from "@exaix/core";
import { PortalKnowledgeService } from "@exaix/portal/knowledge";
import type { IDocCommandRunner, IPortalKnowledgeServiceOptions } from "@exaix/portal/knowledge";
import type { IMemoryBankService, IPortalKnowledgeConfig } from "@exaix/core/types";

// Helpers

const NULL_RUNNER: IDocCommandRunner = {
  run(_entrypoint: string, _portalPath: string): Promise<string | null> {
    return Promise.resolve("[]");
  },
};

function makeConfig(overrides: Partial<IPortalKnowledgeConfig> = {}): IPortalKnowledgeConfig {
  return {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.STANDARD,
    quickScanLimit: 50,
    maxFilesToRead: 10,
    ignorePatterns: [],
    staleness: 168,
    useLlmInference: false,
    relevanceSearchEmbeddingEnabled: false,
    maxPatternDetectorSampleSize: 50,
    minPatternDetectorSampleSize: 10,
    enableAstAnalysis: false,
    enableTestExecution: false,
    enableVulnerabilityScan: false,
    enableGitHistoryAnalysis: false,
    gitHistoryCommitLimit: 500,
    gitHistorySince: "1.year",
    ...overrides,
  };
}

function makeMockMemoryBank(): IMemoryBankService {
  return {
    getProjectMemory: () => Promise.resolve(null),
    createProjectMemory: () => Promise.resolve(),
    updateProjectMemory: () => Promise.resolve(),
    addPattern: () => Promise.resolve(),
    addDecision: () => Promise.resolve(),
    createExecutionRecord: () => Promise.resolve(),
    getExecutionByTraceId: () => Promise.resolve(null),
    getExecutionHistory: () => Promise.resolve([]),
    getGlobalMemory: () => Promise.resolve(null),
    createGlobalMemory: () => Promise.resolve(),
    updateGlobalMemory: () => Promise.resolve(),
    searchMemory: () => Promise.resolve([]),
    searchMemoryByType: () => Promise.resolve([]),
    deleteProjectMemory: () => Promise.resolve(),
    listProjectMemories: () => Promise.resolve([]),
    getLearnings: () => Promise.resolve([]),
    addLearning: () => Promise.resolve(),
  } as Partial<IMemoryBankService> as IMemoryBankService;
}

function makeServiceOptions(overrides: Partial<IPortalKnowledgeServiceOptions> = {}): IPortalKnowledgeServiceOptions {
  return {
    config: makeConfig({ enableGitHistoryAnalysis: false, enableAstAnalysis: false }),
    memoryBank: makeMockMemoryBank(),
    runner: NULL_RUNNER,
    ...overrides,
  };
}

// Fixture builders

/** Create a Python-dominant portal fixture. */
async function createPythonPortal(baseDir: string): Promise<string> {
  const dir = join(baseDir, "py-portal");
  await ensureDir(dir);
  await Deno.writeTextFile(join(dir, "main.py"), "def hello(): pass\n");
  await Deno.writeTextFile(join(dir, "utils.py"), "from main import hello\n\ndef world(): pass\n");
  return dir;
}

/** Create a Rust portal fixture (no extractor registered — expect empty symbolMap). */
async function createRustPortal(baseDir: string): Promise<string> {
  const dir = join(baseDir, "rs-portal");
  await ensureDir(dir);
  await Deno.writeTextFile(join(dir, "main.rs"), "fn hello() {}\n");
  await Deno.writeTextFile(join(dir, "lib.rs"), "pub fn world() {}\n");
  return dir;
}

/** Create a mixed portal: Python dominant (3 .py) with an unsupported Rust file (1 .rs). */
async function createMixedPortal(baseDir: string): Promise<string> {
  const dir = join(baseDir, "mixed-portal");
  await ensureDir(dir);
  // Python files (dominant)
  await Deno.writeTextFile(join(dir, "app.py"), "def start(): pass\n");
  await Deno.writeTextFile(join(dir, "models.py"), "class Model: pass\n");
  await Deno.writeTextFile(join(dir, "routes.py"), "def route(): pass\n");
  // Rust file (secondary, unsupported at extraction)
  await Deno.writeTextFile(join(dir, "ffi.rs"), "fn ffi_call() {}\n");
  return dir;
}

// Tests

Deno.test({
  name: "[portal] [E2E] Solo default registry extracts Python symbols — real symbolMap",
  fn: async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "p119_py_e2e_" });
    try {
      const portalDir = await createPythonPortal(tempDir);
      const svc = new PortalKnowledgeService(makeServiceOptions());
      const result = await svc.analyze("py-e2e", portalDir, PortalAnalysisMode.STANDARD);
      assertExists(result.symbolMap, "symbolMap should exist for Python portal");
      assert(result.symbolMap.length > 0, "Python portal should have non-empty symbolMap");
      const names = result.symbolMap.map((s) => s.name);
      assert(names.includes("hello"), "hello function should be in symbolMap");
      assert(names.includes("world"), "world function should be in symbolMap");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "[portal] [E2E] Solo yields empty symbolMap for Rust portal (no extractor registered)",
  fn: async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "p119_rs_e2e_" });
    try {
      const portalDir = await createRustPortal(tempDir);
      const svc = new PortalKnowledgeService(makeServiceOptions());
      const result = await svc.analyze("rs-e2e", portalDir, PortalAnalysisMode.STANDARD);
      assertExists(result.symbolMap, "symbolMap should exist for Rust portal");
      assertEquals(result.symbolMap.length, 0, "Rust portal should have empty symbolMap (no extractor)");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "[portal] [E2E] mixed portal extracts dominant (Python) only; Rust files fail-soft",
  fn: async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "p119_mixed_e2e_" });
    try {
      const portalDir = await createMixedPortal(tempDir);
      const svc = new PortalKnowledgeService(makeServiceOptions());
      const result = await svc.analyze("mixed-e2e", portalDir, PortalAnalysisMode.STANDARD);
      assertExists(result.symbolMap, "symbolMap should exist for mixed portal");
      // Python is dominant — should have symbols
      assert(result.symbolMap.length > 0, "Mixed portal should have symbols from dominant Python");
      const names = result.symbolMap.map((s) => s.name);
      assert(names.includes("start"), "start (Python) should be in symbolMap");
      // Rust files should not cause an error (fail-soft)
      // The portal should not crash despite having unextractable files
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});
