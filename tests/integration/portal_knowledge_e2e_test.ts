/**
 * @module PortalKnowledgeE2ETest
 * @path tests/integration/portal_knowledge_e2e_test.ts
 * @description End-to-end integration tests for the portal knowledge gathering
 * pipeline: analysis → persistence → retrieval → request-context injection.
 * Covers quick and standard modes, knowledge.json round-trip, IProjectMemory
 * file updates, and RequestProcessor portal-knowledge injection.
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts, *   packages/portal/knowledge/knowledge_persistence.ts, "packages/request/src/processor.ts", "packages/schemas/src/portal_knowledge.ts"]
 */

import { assert, assertEquals, assertExists, assertGreater } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { MockStrategy, PortalAnalysisMode, PortalOperation } from "@exaix/core";
import { type IDocCommandRunner, loadKnowledge, PortalKnowledgeService, saveKnowledge } from "@exaix/portal/knowledge";
import { MemoryBankService } from "@exaix/memory";
import { RequestProcessor } from "@exaix/request";
import type { IApplicationContext, IPortalKnowledgeConfig, IPortalKnowledgeService } from "@exaix/core/types";
import { MockLLMProvider } from "@exaix/ai/providers";
import { initTestDbService } from "@exaix/testing";
import { createStubConfig, createStubDisplay, createStubGit } from "@exaix/testing";
import { TestEnvironment } from "./helpers/test_environment.ts";

// Helpers

/** Build a minimal IPortalKnowledgeConfig for testing. */
function makeConfig(overrides: Partial<IPortalKnowledgeConfig> = {}): IPortalKnowledgeConfig {
  return {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.QUICK,
    quickScanLimit: 50,
    maxFilesToRead: 10,
    ignorePatterns: ["node_modules", ".git"],
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

/** A no-op IDocCommandRunner that returns an empty symbol list, avoiding real `deno doc` calls in tests. */
const NULL_RUNNER: IDocCommandRunner = {
  run(_entrypoint: string, _portalPath: string): Promise<string | null> {
    return Promise.resolve("[]");
  },
};

/** Create a minimal mock portal directory with TypeScript files so PortalKnowledgeService has something to analyze. */
async function createMockPortalDir(baseDir: string): Promise<string> {
  const portalDir = join(baseDir, "mock-portal");
  await ensureDir(join(portalDir, "src", "services"));
  await ensureDir(join(portalDir, "src", "models"));
  await ensureDir(join(portalDir, "tests"));

  await Deno.writeTextFile(
    join(portalDir, "deno.json"),
    JSON.stringify({ name: "mock-portal", version: "1.0.0" }),
  );
  await Deno.writeTextFile(
    join(portalDir, "README.md"),
    "# Mock Portal\n\nA minimal TypeScript project for testing.\n",
  );
  await Deno.writeTextFile(
    join(portalDir, "src", "main.ts"),
    "/**\n * @module Main\n */\nexport function run(): void {\n  console.log('hello');\n}\n",
  );
  await Deno.writeTextFile(
    join(portalDir, "src", "services", "greeter.ts"),
    "export class Greeter {\n  greet(name: string): string {\n    return `Hello, ${name}!`;\n  }\n}\n",
  );
  await Deno.writeTextFile(
    join(portalDir, "src", "models", "user.ts"),
    "export interface IUser {\n  id: string;\n  name: string;\n}\n",
  );
  await Deno.writeTextFile(
    join(portalDir, "tests", "greeter_test.ts"),
    'import { Greeter } from "../src/services/greeter.ts";\nimport { assertEquals } from "@std/assert";\nDeno.test("greeter", () => assertEquals(new Greeter().greet("world"), "Hello, world!"));\n',
  );

  return portalDir;
}

// Test 1: quick mode analysis

Deno.test("[E2E] portal knowledge pipeline with quick mode", async () => {
  const { cleanup } = await initTestDbService();

  try {
    const tempDir = await Deno.makeTempDir();
    const portalDir = await createMockPortalDir(tempDir);

    const service = new PortalKnowledgeService({
      config: makeConfig(),
      memoryBank: null as never,
    });
    const knowledge = await service.analyze("test-portal", portalDir, PortalAnalysisMode.QUICK);

    assertEquals(knowledge.portal, "test-portal");
    assertExists(knowledge.gatheredAt);
    assertEquals(knowledge.metadata.mode, PortalAnalysisMode.QUICK);
    assertGreater(knowledge.metadata.filesScanned, 0);
    assertExists(knowledge.techStack);
    assertExists(knowledge.keyFiles);
    assert(Array.isArray(knowledge.conventions));
    assert(knowledge.metadata.durationMs >= 0);

    await Deno.remove(tempDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

// Test 2: standard mode (no LLM, null runner skips deno doc)

Deno.test("[E2E] portal knowledge pipeline with standard mode (mock LLM)", async () => {
  const { cleanup } = await initTestDbService();

  try {
    const tempDir = await Deno.makeTempDir();
    const portalDir = await createMockPortalDir(tempDir);

    const service = new PortalKnowledgeService({
      config: makeConfig({ defaultMode: PortalAnalysisMode.STANDARD }),
      memoryBank: null as never,

      runner: NULL_RUNNER,
    });
    const knowledge = await service.analyze("std-portal", portalDir, PortalAnalysisMode.STANDARD);

    assertEquals(knowledge.portal, "std-portal");
    assertEquals(knowledge.metadata.mode, PortalAnalysisMode.STANDARD);
    assertGreater(knowledge.metadata.filesScanned, 0);
    assertExists(knowledge.techStack);
    assert(Array.isArray(knowledge.conventions));

    await Deno.remove(tempDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

// Test 3: knowledge persisted as knowledge.json

Deno.test("[E2E] knowledge persisted as knowledge.json", async () => {
  const { cleanup } = await initTestDbService();

  try {
    const tempDir = await Deno.makeTempDir();
    const portalDir = await createMockPortalDir(tempDir);
    const projectsDir = join(tempDir, "Memory", "Projects");
    await ensureDir(projectsDir);

    const service = new PortalKnowledgeService({
      config: makeConfig(),
      memoryBank: null as never,
    });
    const knowledge = await service.analyze("persist-portal", portalDir);

    await saveKnowledge("persist-portal", knowledge, null, projectsDir);

    const knowledgePath = join(projectsDir, "persist-portal", "knowledge.json");
    const stat = await Deno.stat(knowledgePath);
    assert(stat.isFile, "knowledge.json should be a file");

    const loaded = await loadKnowledge("persist-portal", projectsDir);
    assertExists(loaded, "loadKnowledge should return the saved knowledge");
    assertEquals(loaded!.portal, "persist-portal");
    assertEquals(loaded!.version, knowledge.version);
    assertEquals(loaded!.metadata.mode, PortalAnalysisMode.QUICK);

    await Deno.remove(tempDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

// Test 4: knowledge mapped to IProjectMemory files

Deno.test("[E2E] knowledge mapped to IProjectMemory files", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const tempDir = await Deno.makeTempDir();
    const portalDir = await createMockPortalDir(tempDir);
    const projectsDir = join(tempDir, "Memory", "Projects");
    await ensureDir(projectsDir);

    const memoryBank = new MemoryBankService(config);
    const service = new PortalKnowledgeService({
      config: makeConfig(),
      memoryBank: null as never,
    });
    const knowledge = await service.analyze("mem-portal", portalDir);

    await saveKnowledge("mem-portal", knowledge, memoryBank, projectsDir);

    const projectMem = await memoryBank.getProjectMemory("mem-portal");
    assertExists(projectMem, "IProjectMemory record should be created");
    assertEquals(projectMem!.portal, "mem-portal");
    assert(typeof projectMem!.overview === "string");
    assert(Array.isArray(projectMem!.patterns));

    await Deno.remove(tempDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

// Test 5: knowledge available in request processing context

Deno.test(
  "[E2E] knowledge available in request processing context",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const env = await TestEnvironment.create();

    try {
      const portalAlias = "ctx-portal";
      const portalTargetPath = join(env.tempDir, "ctx-portal-target");
      await ensureDir(portalTargetPath);
      await Deno.writeTextFile(join(portalTargetPath, "main.ts"), "export const x = 1;");

      let getOrAnalyzeCalled = false;
      let capturedAlias = "";

      const spyService: IPortalKnowledgeService = {
        analyze(alias, path, mode) {
          const svc = new PortalKnowledgeService({
            config: makeConfig(),
            memoryBank: null as never,
            runner: NULL_RUNNER,
          });
          return svc.analyze(alias, path, mode);
        },
        getOrAnalyze(alias, path) {
          getOrAnalyzeCalled = true;
          capturedAlias = alias;
          const svc = new PortalKnowledgeService({
            config: makeConfig(),
            memoryBank: null as never,
            runner: NULL_RUNNER,
          });
          return svc.analyze(alias, path);
        },
        isStale: () => Promise.resolve(true),
        updateKnowledge(alias, path) {
          const svc = new PortalKnowledgeService({
            config: makeConfig(),
            memoryBank: null as never,
            runner: NULL_RUNNER,
          });
          return svc.analyze(alias, path);
        },
        getRelevantContext: () => Promise.resolve(undefined),
      };

      await env.createBlueprint("code-analyst");

      const configWithPortal = {
        ...env.config,
        portals: [{
          alias: portalAlias,
          target_path: portalTargetPath,
          default_branch: "main",
          agents_allowed: ["*"],
          operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        }],
      };

      const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [] });
      const context: IApplicationContext = {
        config: createStubConfig(configWithPortal),
        db: env.db,
        provider,
        git: createStubGit(),
        display: createStubDisplay(env.db),
        portalKnowledge: spyService,
      };

      const processor = new RequestProcessor({
        workspacePath: join(env.tempDir, "Workspace"),
        requestsDir: join(env.tempDir, "Workspace", "Requests"),
        blueprintsPath: join(env.tempDir, "Blueprints", "Agents"),
        includeReasoning: false,
        context,
        testProvider: provider,
        portalKnowledgeService: spyService,
      });

      const { filePath } = await env.createRequest(
        "Analyze the portal codebase",
        { identityId: "code-analyst", portal: portalAlias },
      );

      try {
        await processor.process(filePath);
      } catch {
        // Plan generation failure is acceptable; we only care about the spy call
      }

      assert(getOrAnalyzeCalled, "portalKnowledgeService.getOrAnalyze should have been called");
      assertEquals(capturedAlias, portalAlias);
    } finally {
      await env.cleanup();
    }
  },
);

// Test 6: stale knowledge triggers re-analysis

Deno.test("[E2E] stale knowledge re-analyzed on request processing", async () => {
  const { cleanup } = await initTestDbService();

  try {
    const tempDir = await Deno.makeTempDir();
    const portalDir = await createMockPortalDir(tempDir);

    // staleness=-1 makes cutoff 1 hour in the future → always stale
    const service = new PortalKnowledgeService({
      config: makeConfig({ staleness: -1 }),
      memoryBank: null as never,
    });
    const first = await service.analyze("stale-portal", portalDir);
    assertEquals(first.version, 1);

    const stale = await service.isStale("stale-portal");
    assert(stale, "knowledge should be stale when cutoff is in the future (staleness=-1)");

    // getOrAnalyze returns stale data immediately, fires background re-analysis
    const returned = await service.getOrAnalyze("stale-portal", portalDir);
    assertEquals(returned.version, 1, "getOrAnalyze immediately returns stale version");

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Direct analyze confirms the version counter increments
    const fresh = await service.analyze("stale-portal", portalDir);
    assertGreater(fresh.version, 1, "version should increment after re-analysis");

    await Deno.remove(tempDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

// Test 7: standard mode populates new strategy fields

Deno.test("[E2E] standard mode populates licenses and gitHistory optional fields", async () => {
  const { cleanup } = await initTestDbService();
  try {
    const tempDir = await Deno.makeTempDir();
    const portalDir = await createMockPortalDir(tempDir);

    const service = new PortalKnowledgeService({
      config: makeConfig({
        defaultMode: PortalAnalysisMode.STANDARD,
        enableAstAnalysis: true,
        enableGitHistoryAnalysis: true,
      }),
      memoryBank: null as never,
      runner: NULL_RUNNER,
    });
    const knowledge = await service.analyze("e2e-new-fields", portalDir, PortalAnalysisMode.STANDARD);

    assertExists(knowledge.astDiagnostics, "standard mode must populate astDiagnostics (strategy 7)");
    assert(Array.isArray(knowledge.licenses), "standard mode must populate licenses (strategy 9)");
    assertExists(knowledge.gitHistory, "standard mode must populate gitHistory (strategy 11)");
    assertEquals(knowledge.testInfo, undefined, "testInfo absent without enableTestExecution");
    assertEquals(knowledge.vulnerabilities, undefined, "vulnerabilities absent without enableVulnerabilityScan");

    await Deno.remove(tempDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[E2E] knowledge.json round-trip preserves new optional fields", async () => {
  const { cleanup } = await initTestDbService();
  try {
    const tempDir = await Deno.makeTempDir();
    const portalDir = await createMockPortalDir(tempDir);
    const projectsDir = join(tempDir, "Memory", "Projects");
    await ensureDir(projectsDir);

    const service = new PortalKnowledgeService({
      config: makeConfig({
        defaultMode: PortalAnalysisMode.STANDARD,
        enableGitHistoryAnalysis: true,
      }),
      memoryBank: null as never,
      runner: NULL_RUNNER,
    });
    const knowledge = await service.analyze("round-trip", portalDir, PortalAnalysisMode.STANDARD);

    // Persist to disk and reload
    await saveKnowledge("round-trip", knowledge, null, projectsDir);
    const loaded = await loadKnowledge("round-trip", projectsDir);

    assertExists(loaded, "loadKnowledge should return saved knowledge");
    assert(Array.isArray(loaded!.licenses), "licenses must survive JSON round-trip");
    assertExists(loaded!.gitHistory, "gitHistory must survive JSON round-trip");
    assertEquals(loaded!.portal, knowledge.portal);
    assertEquals(loaded!.version, knowledge.version);

    await Deno.remove(tempDir, { recursive: true });
  } finally {
    await cleanup();
  }
});
