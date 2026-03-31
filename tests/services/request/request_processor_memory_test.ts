/**
 * @module RequestProcessorMemoryTest
 * @path tests/services/request/request_processor_memory_test.ts
 * @description Tests for SessionMemoryService injection into RequestProcessor.
 * Verifies that enhanceRequest() is called before analysis and that the result
 * is passed to the analyzer.
 * @architectural-layer Tests
 */
import { assertEquals, assertExists } from "@std/assert";
import { IApplicationContext } from "../../../src/shared/interfaces/i_application_context.ts";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import { RequestProcessor } from "../../../src/services/request/request_processor.ts";
import { type EnhancedRequest, SessionMemoryService } from "../../../src/services/memory/session_memory.ts";
import { createMockProvider } from "../../helpers/mock_provider.ts";
import {
  makeAgentRequestFileSync as makeRequestFile,
  makeAnalysis,
  makeFakeAnalyzer,
  makeRequestProcessorEnv as makeEnv,
} from "./request_test_helpers.ts";
import type {
  IRequestAnalysisContext,
  IRequestAnalyzerService,
} from "../../../src/shared/interfaces/i_request_analyzer_service.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeMockAnalyzer(): IRequestAnalyzerService & { capturedCtx: IRequestAnalysisContext | undefined } {
  const analysis = makeAnalysis();
  let capturedCtx: IRequestAnalysisContext | undefined;
  const mock = {
    analyze: (_text: string, ctx?: IRequestAnalysisContext) => {
      capturedCtx = ctx;
      return Promise.resolve(analysis);
    },
    analyzeQuick: () => analysis,
    get capturedCtx() {
      return capturedCtx;
    },
  };
  return mock as any;
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
      const context: IApplicationContext = {
        config: { get: () => env.config, getChecksum: () => "test" } as any,
        db: env.db,
        provider: mockProvider,
        git: {} as any,
        display: new EventLogger({ db: env.db, defaultActor: "test" }),
        portalKnowledge: undefined,
      };
      const processor = new RequestProcessor({
        ...env.processorConfig,
        context,
        testProvider: mockProvider,
        testAnalyzer: makeFakeAnalyzer(makeAnalysis()),
        sessionMemory: spy.service,
      });

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
  "[RequestProcessor] passes EnhancedRequest to the analyzer",
  async () => {
    const env = await makeEnv();
    const spy = makeSpyMemoryService();
    const analyzerSpy = makeMockAnalyzer();
    const mockProvider = createMockProvider(["<thought>ok</thought><content>{}</content>"]);

    try {
      const context: IApplicationContext = {
        config: { get: () => env.config, getChecksum: () => "test" } as any,
        db: env.db,
        provider: mockProvider,
        git: {} as any,
        display: new EventLogger({ db: env.db, defaultActor: "test" }),
        portalKnowledge: undefined,
      };
      const processor = new RequestProcessor({
        ...env.processorConfig,
        context,
        testProvider: mockProvider,
        testAnalyzer: analyzerSpy,
        sessionMemory: spy.service,
      });

      const filePath = makeRequestFile(env.requestsDir, { body: "Request for memory" });
      await processor.process(filePath);

      const capturedCtx = analyzerSpy.capturedCtx;
      assertExists(capturedCtx, "Analyzer should have captured context");
      const enhanced = capturedCtx.memories;
      assertExists(enhanced, "EnhancedRequest should be present in analyzer context");
      assertEquals(enhanced.memoryContext, "## Past context\n- Pattern: use dependency injection");
    } finally {
      await env.cleanup();
    }
  },
);

Deno.test(
  "[RequestProcessor] continues normally if SessionMemoryService.enhanceRequest() fails",
  async () => {
    const env = await makeEnv();
    const mockProvider = createMockProvider(["<thought>ok</thought><content>{}</content>"]);

    const failingService: SessionMemoryService = {
      enhanceRequest: () => Promise.reject(new Error("Memory service exploded")),
    } as any;

    try {
      const context: IApplicationContext = {
        config: { get: () => env.config, getChecksum: () => "test" } as any,
        db: env.db,
        provider: mockProvider,
        git: {} as any,
        display: new EventLogger({ db: env.db, defaultActor: "test" }),
        portalKnowledge: undefined,
      };
      const processor = new RequestProcessor({
        ...env.processorConfig,
        context,
        testProvider: mockProvider,
        testAnalyzer: makeFakeAnalyzer(makeAnalysis()),
        sessionMemory: failingService,
      });

      const filePath = makeRequestFile(env.requestsDir);
      // Should not throw
      await processor.process(filePath);
    } finally {
      await env.cleanup();
    }
  },
);
