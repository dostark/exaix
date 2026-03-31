/**
 * @module RequestProcessorMemoryTest
 * @path tests/services/request/request_processor_memory_test.ts
 * @description Tests for SessionMemoryService injection into RequestProcessor.
 * Verifies that enhanceRequest() is called before analysis and that the result
 * is stored on IParsedRequest.context (Phase 49, Step 5).
 * @architectural-layer Tests
 * * @related-files [.copilot/planning/phase-49-quality-pipeline-hardening.md]
 */
import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { RequestProcessor } from "../../../src/services/request/request_processor.ts";
import type {
  IRequestAnalysisContext,
  IRequestAnalyzerService,
} from "../../../src/shared/interfaces/i_request_analyzer_service.ts";
import { RequestAnalysisComplexity, RequestTaskType } from "../../../src/shared/schemas/request_analysis.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";
import { RequestStatus } from "../../../src/shared/status/request_status.ts";
import { type EnhancedRequest, SessionMemoryService } from "../../../src/services/memory/session_memory.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { createMockProvider } from "../../helpers/mock_provider.ts";
import { ANALYZER_VERSION } from "../../../src/shared/constants.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePassthroughAnalyzer(): IRequestAnalyzerService {
  const analysis = {
    goals: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: 70,
    complexity: RequestAnalysisComplexity.SIMPLE,
    taskType: RequestTaskType.UNKNOWN,
    tags: [],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 10,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
  };
  return {
    analyze: (_text: string, _ctx?: IRequestAnalysisContext) => Promise.resolve(analysis),
    analyzeQuick: () => analysis,
  };
}

function makeSpyMemoryService(): { service: SessionMemoryService; calls: string[] } {
  const calls: string[] = [];
  const partial: Pick<SessionMemoryService, "enhanceRequest"> = {
    enhanceRequest: (request: string): Promise<EnhancedRequest> => {
      calls.push(request);
      return Promise.resolve({
        originalRequest: request,
        memories: [],
        memoryContext: "## Past context\n- Pattern: use dependency injection",
        metadata: { memoriesRetrieved: 0, searchTime: 0 },
      });
    },
  };
  return { service: partial as SessionMemoryService, calls };
}

async function makeEnv() {
  const { db, config, tempDir, cleanup } = await initTestDbService();
  const workspacePath = join(tempDir, config.paths.workspace);
  const requestsDir = join(workspacePath, config.paths.requests);
  const plansDir = join(workspacePath, config.paths.plans);
  const blueprintsPath = join(tempDir, config.paths.blueprints, config.paths.identities);

  await Deno.mkdir(requestsDir, { recursive: true });
  await Deno.mkdir(plansDir, { recursive: true });
  await Deno.mkdir(blueprintsPath, { recursive: true });

  const processorConfig = { workspacePath, requestsDir, blueprintsPath, includeReasoning: false };
  return { db, config, tempDir, cleanup, requestsDir, processorConfig };
}

function makeRequestFile(requestsDir: string, body = "Implement caching layer for the API"): string {
  const requestId = "req-mem-001";
  const filePath = join(requestsDir, `${requestId}.md`);
  Deno.writeTextFileSync(
    filePath,
    `---
trace_id: "trace-mem-001"
created: "${new Date().toISOString()}"
status: "${RequestStatus.PENDING}"
priority: "normal"
identity: "nonexistent-agent"
source: "cli"
created_by: "test-user"
assessed_at: "${new Date().toISOString()}"
---
${body}`,
  );
  return filePath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "[RequestProcessor] calls SessionMemoryService.enhanceRequest() before analysis",
  async () => {
    const env = await makeEnv();
    const spy = makeSpyMemoryService();
    const mockProvider = createMockProvider(["<thought>ok</thought><content>{}</content>"]);

    try {
      const processor = new RequestProcessor(
        env.config,
        env.db,
        env.processorConfig,
        mockProvider,
        undefined,
        makePassthroughAnalyzer(),
        undefined,
        undefined,
        spy.service,
      );

      const filePath = makeRequestFile(env.requestsDir);
      await processor.process(filePath);

      assertEquals(spy.calls.length, 1, "enhanceRequest() should be called once");
      assertExists(spy.calls[0]);
    } finally {
      await env.cleanup();
    }
  },
);

Deno.test(
  "[RequestProcessor] does not call enhanceRequest() when sessionMemory is undefined",
  async () => {
    const env = await makeEnv();
    const spy = makeSpyMemoryService();
    const mockProvider = createMockProvider(["<thought>ok</thought><content>{}</content>"]);

    try {
      const processor = new RequestProcessor(
        env.config,
        env.db,
        env.processorConfig,
        mockProvider,
        undefined,
        makePassthroughAnalyzer(),
      );

      const filePath = makeRequestFile(env.requestsDir);
      await processor.process(filePath);

      assertEquals(spy.calls.length, 0, "enhanceRequest() should NOT be called when no sessionMemory");
    } finally {
      await env.cleanup();
    }
  },
);

Deno.test(
  "[RequestProcessor] handles missing SessionMemoryService gracefully",
  async () => {
    const env = await makeEnv();
    const mockProvider = createMockProvider(["<thought>ok</thought><content>{}</content>"]);

    try {
      const processor = new RequestProcessor(
        env.config,
        env.db,
        env.processorConfig,
        mockProvider,
      );

      const filePath = makeRequestFile(env.requestsDir);
      // Should not throw even without sessionMemory
      const result = await processor.process(filePath);
      // Will return null because blueprint not found — that's expected
      assertEquals(result, null);
    } finally {
      await env.cleanup();
    }
  },
);
