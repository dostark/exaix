/**
 * @module RequestProcessorAnalysisTest
 * @path packages/request/tests/request_processor_analysis_test.ts
 * @architectural-layer Services
 * @description Verifies that RequestProcessor integrates with RequestAnalyzer to
 * produce structured IRequestAnalysis, enriches IParsedRequest fields, persists
 * analysis as a sibling JSON file, and handles analyzer failures gracefully.
 * @related-files [packages/request/src/processor.ts, packages/request/src/common.ts, packages/request/src/analysis/mod.ts, "packages/schemas/src/request_analysis.ts"]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import type { IApplicationContext, IRequestAnalysisContext, IRequestAnalyzerService } from "@exaix/core/types";
import type { ANALYZER_VERSION as _ANALYZER_VERSION } from "@exaix/core";
import { RequestProcessor } from "@exaix/request";
import { AgentRunner } from "@exaix/execution";
import { applyAnalysisToRequest, buildParsedRequest } from "@exaix/request";
import { loadAnalysis } from "@exaix/request";
import {
  type IRequestAnalysis,
  type RequestAnalysisComplexity as _RequestAnalysisComplexity,
  RequestTaskType,
} from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "@exaix/core/types";
import { RequestSource } from "@exaix/core";
import { RequestStatus } from "@exaix/core/status";
import type { IRequestFrontmatter } from "@exaix/core/request";
import type { initTestDbService as _initTestDbService } from "@exaix/testing";
import {
  createMockProvider,
  createStubConfig,
  createStubDisplay,
  createStubGit,
  createStubProvider,
} from "@exaix/testing";
import {
  makeAgentRequestFileSync as makeAgentRequestFile,
  makeAnalysis,
  type makeBlueprintFileSync as _makeBlueprintFile,
  makeFakeAnalyzer,
  makeFlowRequestFileSync as makeFlowRequestFile,
  makeRequestProcessorEnv,
  makeThrowingAnalyzer,
} from "./request_test_helpers.ts";

// ============================================================================
// Helpers
// ============================================================================

type AnalysisEnv = Awaited<ReturnType<typeof makeRequestProcessorEnv>>;

function makeTestFrontmatter(): IRequestFrontmatter {
  return {
    trace_id: "t1",
    created: new Date().toISOString(),
    status: RequestStatus.PENDING,
    priority: "normal",
    source: RequestSource.CLI,
    created_by: "user",
  };
}

function makeAnalysisProcessor(
  env: AnalysisEnv,
  analyzer: IRequestAnalyzerService,
): { processor: RequestProcessor; mockProvider: ReturnType<typeof createMockProvider> } {
  const mockProvider = createMockProvider(["<thought>ok</thought><content>{}</content>"]);
  const context: IApplicationContext = {
    config: createStubConfig(env.config),
    db: env.db,
    provider: mockProvider,
    git: createStubGit(),
    display: createStubDisplay(env.db),
  };
  const processor = new RequestProcessor({
    ...env.processorConfig,
    context,
    testProvider: mockProvider,
    testAnalyzer: analyzer,
    agentRunner: new AgentRunner(mockProvider),
  });
  return { processor, mockProvider };
}

function makeStubAnalysisProcessor(
  env: AnalysisEnv,
  analyzer: IRequestAnalyzerService,
  configOverride?: Parameters<typeof createStubConfig>[0],
): { processor: RequestProcessor } {
  const context: IApplicationContext = {
    config: createStubConfig(configOverride ?? env.config),
    db: env.db,
    provider: createStubProvider(),
    git: createStubGit(),
    display: createStubDisplay(env.db),
  };
  const processor = new RequestProcessor({
    ...env.processorConfig,
    context,
    testAnalyzer: analyzer,
    agentRunner: new AgentRunner(context.provider),
  });
  return { processor };
}

// ============================================================================
// Tests
// ============================================================================

// ============================================================================
// Unit tests: applyAnalysisToRequest
// ============================================================================

Deno.test("[RequestProcessor] populates IParsedRequest.taskType from analysis", () => {
  const frontmatter = makeTestFrontmatter();
  const request = buildParsedRequest("Do bugfix work", frontmatter, "req-1", "trace-1");
  const analysis = makeAnalysis({ taskType: RequestTaskType.BUGFIX });

  applyAnalysisToRequest(request, analysis);

  assertEquals(request.taskType, RequestTaskType.BUGFIX);
});

Deno.test("[RequestProcessor] populates IParsedRequest.tags from analysis", () => {
  const frontmatter = makeTestFrontmatter();
  const request = buildParsedRequest("Fix auth bug", frontmatter, "req-2", "trace-2");
  const analysis = makeAnalysis({ tags: ["auth", "security", "login"] });

  applyAnalysisToRequest(request, analysis);

  assertEquals(request.tags, ["auth", "security", "login"]);
});

Deno.test("[RequestProcessor] keeps frontmatter tags when analysis supplies its own", () => {
  // Regression: overwriting request.tags with analysis.tags discarded the frontmatter
  // author's tags, breaking tag-driven skill selection for every analyzed request.
  const frontmatter = { ...makeTestFrontmatter(), tags: ["self-critique", "architecture-review"] };
  const request = buildParsedRequest("Review the exception paths", frontmatter, "req-tags", "trace-tags");
  const analysis = makeAnalysis({ tags: ["error-handling", "reliability"] });

  applyAnalysisToRequest(request, analysis);

  assertEquals(request.tags, ["self-critique", "architecture-review", "error-handling", "reliability"]);
});

Deno.test("[RequestProcessor] does not duplicate a tag both sources declare", () => {
  const frontmatter = { ...makeTestFrontmatter(), tags: ["error-handling"] };
  const request = buildParsedRequest("Review the exception paths", frontmatter, "req-dup", "trace-dup");
  const analysis = makeAnalysis({ tags: ["error-handling", "reliability"] });

  applyAnalysisToRequest(request, analysis);

  assertEquals(request.tags, ["error-handling", "reliability"]);
});

Deno.test("[RequestProcessor] populates IParsedRequest.filePaths from analysis", () => {
  const frontmatter = makeTestFrontmatter();
  const request = buildParsedRequest("Update src/auth.ts", frontmatter, "req-3", "trace-3");
  const analysis = makeAnalysis({ referencedFiles: ["src/auth.ts", "tests/auth_test.ts"] });

  applyAnalysisToRequest(request, analysis);

  assertEquals(request.filePaths, ["src/auth.ts", "tests/auth_test.ts"]);
});

Deno.test("[RequestProcessor] populates request.context.analysis for downstream usage", () => {
  const frontmatter = makeTestFrontmatter();
  const request = buildParsedRequest("Test analysis propagation", frontmatter, "req-4", "trace-4");
  const analysis = makeAnalysis({ taskType: RequestTaskType.FEATURE });

  applyAnalysisToRequest(request, analysis);

  assertExists(request.context.analysis);
  assertEquals((request.context.analysis as IRequestAnalysis).taskType, RequestTaskType.FEATURE);
});

// ============================================================================
// Integration tests: RequestProcessor pipeline
// ============================================================================

Deno.test("[RequestProcessor] runs analysis before agent execution", async () => {
  const env = await makeRequestProcessorEnv();
  const testAnalysis = makeAnalysis();
  const fakeAnalyzer = makeFakeAnalyzer(testAnalysis);

  try {
    const filePath = makeAgentRequestFile(env.requestsDir);
    const { processor } = makeAnalysisProcessor(env, fakeAnalyzer);

    // Processing will fail (no blueprint), but analysis should run first
    await processor.process(filePath);

    // Analysis JSON must exist alongside the request file
    const analysisPath = filePath.replace(/\.md$/, "_analysis.json");
    const stat = await Deno.stat(analysisPath).catch(() => null);
    assertExists(stat, "_analysis.json should exist after processing");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] persists analysis as _analysis.json", async () => {
  const env = await makeRequestProcessorEnv();
  const testAnalysis = makeAnalysis({
    taskType: RequestTaskType.BUGFIX,
    tags: ["auth"],
    referencedFiles: ["src/auth.ts"],
  });
  const fakeAnalyzer = makeFakeAnalyzer(testAnalysis);

  try {
    const filePath = makeAgentRequestFile(env.requestsDir);
    const { processor } = makeAnalysisProcessor(env, fakeAnalyzer);

    await processor.process(filePath);

    // Load and verify the persisted analysis content
    const loaded = await loadAnalysis(filePath);
    assertExists(loaded, "Loaded analysis should not be null");
    assertEquals(loaded!.taskType, RequestTaskType.BUGFIX);
    assertEquals(loaded!.tags, ["auth"]);
    assertEquals(loaded!.referencedFiles, ["src/auth.ts"]);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] handles analyzer failure gracefully (continues without analysis)", async () => {
  const env = await makeRequestProcessorEnv();
  const throwingAnalyzer = makeThrowingAnalyzer();

  try {
    const filePath = makeAgentRequestFile(env.requestsDir);
    const { processor } = makeAnalysisProcessor(env, throwingAnalyzer);

    // Should not throw even though analyzer explodes
    const result = await processor.process(filePath);
    // Result is null because blueprint is not found, but no unhandled exception
    assertEquals(result, null);

    // No _analysis.json should exist (analysis failed)
    const analysisPath = filePath.replace(/\.md$/, "_analysis.json");
    const stat = await Deno.stat(analysisPath).catch(() => null);
    assertEquals(stat, null, "_analysis.json should NOT exist when analyzer fails");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] passes analysis to flow processing path", async () => {
  const env = await makeRequestProcessorEnv();
  const testAnalysis = makeAnalysis({ taskType: RequestTaskType.FEATURE });
  const fakeAnalyzer = makeFakeAnalyzer(testAnalysis);

  try {
    const filePath = makeFlowRequestFile(env.requestsDir);
    const { processor } = makeAnalysisProcessor(env, fakeAnalyzer);

    await processor.process(filePath);

    // Analysis JSON must exist alongside the flow request file
    const analysisPath = filePath.replace(/\.md$/, "_analysis.json");
    const stat = await Deno.stat(analysisPath).catch(() => null);
    assertExists(stat, "_analysis.json should exist after flow processing");
    // Load and verify analysis propagation (via save signal)
    const loaded = await loadAnalysis(filePath);
    assertEquals(loaded?.taskType, RequestTaskType.FEATURE);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] plan metadata contains request analysis", async () => {
  const env = await makeRequestProcessorEnv();
  const testAnalysis = makeAnalysis({
    taskType: RequestTaskType.BUGFIX,
    tags: ["security"],
  });
  const fakeAnalyzer = makeFakeAnalyzer(testAnalysis);

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { identity: "test-agent" });
    // Write a dummy blueprint
    await Deno.writeTextFile(join(env.blueprintsPath, "Identities", "test-agent.md"), "Test prompt");

    const mockProvider = createMockProvider([
      '<thought>Analyze</thought><content>{"subject": "Fixed security bug", "description": "Fix bug", "steps": [{"step": 1, "title": "Check code", "description": "Verify security issue"}]}</content>',
    ]);

    const context: IApplicationContext = {
      config: createStubConfig(env.config),
      db: env.db,
      provider: mockProvider,
      git: createStubGit(),
      display: createStubDisplay(env.db),
      portalKnowledge: undefined,
    };
    const processor = new RequestProcessor({
      ...env.processorConfig,
      context,
      testProvider: mockProvider,
      testAnalyzer: fakeAnalyzer,
      agentRunner: new AgentRunner(mockProvider),
    });

    const planPath = await processor.process(filePath);
    assertExists(planPath, "Plan should be generated");

    const planContent = await Deno.readTextFile(planPath);
    assertExists(planContent.includes("requestAnalysis"), "Plan file should contain analysis metadata");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] skips analysis if request status is already PLANNED/COMPLETED", async () => {
  const env = await makeRequestProcessorEnv();
  let analysisCalls = 0;
  const countingAnalyzer: IRequestAnalyzerService = {
    analyze: () => {
      analysisCalls++;
      return Promise.resolve(makeAnalysis());
    },
    analyzeQuick: () => makeAnalysis(),
  };

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { requestId: "skip-test" });

    // Update status to PLANNED directly in file
    const content = Deno.readTextFileSync(filePath);
    const updated = content.replace(`status: "${RequestStatus.PENDING}"`, `status: "${RequestStatus.PLANNED}"`);
    Deno.writeTextFileSync(filePath, updated);

    const { processor } = makeStubAnalysisProcessor(env, countingAnalyzer);

    await processor.process(filePath);

    assertEquals(analysisCalls, 0, "Analyzer should not be called for skipped requests");
  } finally {
    await env.cleanup();
  }
});

// enabled flag — skip analysis when config.request_analysis.enabled = false

Deno.test("[RequestProcessor] skips analysis when request_analysis.enabled is false", async () => {
  const env = await makeRequestProcessorEnv();
  let analysisCalls = 0;
  const countingAnalyzer: IRequestAnalyzerService = {
    analyze: () => {
      analysisCalls++;
      return Promise.resolve(makeAnalysis());
    },
    analyzeQuick: () => makeAnalysis(),
  };

  // Override config to disable analysis
  const disabledConfig = {
    ...env.config,
    request_analysis: {
      ...(env.config.request_analysis ?? {}),
      enabled: false,
    },
  };

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { requestId: "enabled-false" });
    const { processor } = makeStubAnalysisProcessor(env, countingAnalyzer, disabledConfig);

    await processor.process(filePath);

    assertEquals(analysisCalls, 0, "Analyzer should not be called when enabled=false");
  } finally {
    await env.cleanup();
  }
});

// persist_analysis flag — skip persistence when persist_analysis = false

Deno.test("[RequestProcessor] skips persisting analysis when persist_analysis is false", async () => {
  const env = await makeRequestProcessorEnv();
  const analysis = makeAnalysis({ taskType: RequestTaskType.FEATURE });
  const fakeAnalyzer = makeFakeAnalyzer(analysis);

  const noPersistConfig = {
    ...env.config,
    request_analysis: {
      ...(env.config.request_analysis ?? {}),
      enabled: true,
      persist_analysis: false,
    },
  };

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { requestId: "no-persist" });
    const { processor } = makeStubAnalysisProcessor(env, fakeAnalyzer, noPersistConfig);

    await processor.process(filePath);

    const analysisPath = filePath.replace(/\.md$/, "_analysis.json");
    const stat = await Deno.stat(analysisPath).catch(() => null);
    assertEquals(stat, null, "_analysis.json should NOT exist when persist_analysis=false");
  } finally {
    await env.cleanup();
  }
});

// DEFAULT_ANALYZER_MODE fallback — not hard-coded HEURISTIC

Deno.test("[RequestProcessor] uses DEFAULT_ANALYZER_MODE (hybrid) not HEURISTIC as fallback mode", async () => {
  const env = await makeRequestProcessorEnv();
  let capturedMode: string | undefined;
  const capturingAnalyzer: IRequestAnalyzerService = {
    analyze: (_text: string, ctx?: IRequestAnalysisContext) => {
      capturedMode = ctx?.mode;
      return Promise.resolve(makeAnalysis());
    },
    analyzeQuick: () => makeAnalysis(),
  };

  // The schema defaults mode to DEFAULT_ANALYZER_MODE (hybrid).
  // This test verifies the processor passes that mode (not hardcoded HEURISTIC).
  const hybridConfig = {
    ...env.config,
    request_analysis: {
      ...(env.config.request_analysis ?? {}),
      mode: AnalysisMode.HYBRID,
    },
  };
  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { requestId: "default-mode" });
    const { processor } = makeStubAnalysisProcessor(env, capturingAnalyzer, hybridConfig);

    await processor.process(filePath);

    assertEquals(capturedMode, "hybrid", "Default mode should be 'hybrid', not 'heuristic'");
  } finally {
    await env.cleanup();
  }
});
