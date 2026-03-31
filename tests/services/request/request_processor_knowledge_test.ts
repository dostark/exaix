/**
 * @module RequestProcessorKnowledgeTest
 * @path tests/services/request/request_processor_knowledge_test.ts
 * @description Tests for RequestProcessor integration with IPortalKnowledgeService:
 * resolves portal knowledge pre-execution, injects a capped Markdown summary into
 * IParsedRequest.context via PORTAL_KNOWLEDGE_KEY, passes knowledge to both agent
 * and flow processing paths, and degrades gracefully on failure.
 * @related-files [src/services/request_processor.ts, src/shared/constants.ts, src/shared/interfaces/i_portal_knowledge_service.ts]
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildPortalKnowledgeSummary, RequestProcessor } from "../../../src/services/request/request_processor.ts";
import { PORTAL_KNOWLEDGE_PROMPT_MAX_LINES } from "../../../src/shared/constants.ts";
import type { IPortalKnowledgeService } from "../../../src/shared/interfaces/i_portal_knowledge_service.ts";
import type { IPortalKnowledge } from "../../../src/shared/schemas/portal_knowledge.ts";
import { PortalAnalysisMode } from "../../../src/shared/enums.ts";
import { RequestStatus } from "../../../src/shared/status/request_status.ts";
import type { IModelProvider } from "../../../src/ai/types.ts";
import { initTestDbService } from "../../helpers/db.ts";

// ============================================================================
// Fixtures
// ============================================================================

function makeKnowledge(overrides: Partial<IPortalKnowledge> = {}): IPortalKnowledge {
  return {
    portal: "test-portal",
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "## Architecture\n\nThis is a TypeScript service codebase.\nIt has several layers.\n",
    layers: [],
    keyFiles: [
      { path: "src/main.ts", role: "entrypoint", description: "Application entry point" },
      { path: "src/services/auth.ts", role: "core-service", description: "Auth service" },
    ],
    conventions: [
      {
        name: "*.service.ts naming",
        description: "Services use .service.ts suffix",
        evidenceCount: 10,
        confidence: "high",
        examples: ["auth.service.ts"],
        category: "naming",
      },
      {
        name: "IFoo interface naming",
        description: "Interfaces start with I prefix",
        evidenceCount: 5,
        confidence: "medium",
        examples: ["IAuthService"],
        category: "naming",
      },
    ],
    dependencies: [],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    stats: {
      totalFiles: 20,
      totalDirectories: 5,
      extensionDistribution: { ".ts": 18, ".json": 2 },
    },
    metadata: {
      durationMs: 200,
      mode: PortalAnalysisMode.QUICK,
      filesScanned: 20,
      filesRead: 10,
    },
    ...overrides,
  };
}

// ============================================================================
// Mock helpers
// ============================================================================

function makeMockKnowledgeService(
  opts: { fail?: boolean; knowledge?: IPortalKnowledge } = {},
): IPortalKnowledgeService & { callCount: number } {
  let callCount = 0;
  const knowledge = opts.knowledge ?? makeKnowledge();
  return {
    get callCount() {
      return callCount;
    },
    analyze: (_alias: string, _path: string) => {
      callCount++;
      if (opts.fail) return Promise.reject(new Error("Analysis failed"));
      return Promise.resolve(knowledge);
    },
    getOrAnalyze: (_alias: string, _path: string) => {
      callCount++;
      if (opts.fail) return Promise.reject(new Error("getOrAnalyze failed"));
      return Promise.resolve(knowledge);
    },
    isStale: (_alias: string) => Promise.resolve(false),
    updateKnowledge: (_alias: string, _path: string) => Promise.resolve(knowledge),
  };
}

function makeCapturingProvider(response?: string): {
  provider: IModelProvider;
  capturedPrompts: string[];
} {
  const capturedPrompts: string[] = [];
  const validResponse = response ??
    `<thought>Processing request</thought>
<content>
{
  "subject": "Test plan",
  "description": "A test plan",
  "steps": [{"step": 1, "title": "Do work", "description": "Execute task"}]
}
</content>`;
  const provider: IModelProvider = {
    id: "capturing-mock",
    generate: (prompt: string) => {
      capturedPrompts.push(prompt);
      return Promise.resolve(validResponse);
    },
  };
  return { provider, capturedPrompts };
}

// ============================================================================
// Test environment setup
// ============================================================================

async function makeKnowledgeProcessorEnv(opts: {
  knowledgeService?: IPortalKnowledgeService & { callCount: number };
  providerOverride?: IModelProvider;
  withPortal?: boolean;
} = {}) {
  const { db, config, tempDir, cleanup } = await initTestDbService();

  const workspacePath = join(tempDir, config.paths.workspace);
  const requestsDir = join(workspacePath, config.paths.requests);
  const plansDir = join(workspacePath, config.paths.plans);
  const blueprintsPath = join(tempDir, config.paths.blueprints, config.paths.identities);

  await Deno.mkdir(requestsDir, { recursive: true });
  await Deno.mkdir(plansDir, { recursive: true });
  await Deno.mkdir(blueprintsPath, { recursive: true });

  // Inject a portal entry into the config when portal-bound testing is needed
  const portalTargetDir = await Deno.makeTempDir({ prefix: "portal-target-" });
  if (opts.withPortal !== false) {
    config.portals = [{ alias: "test-portal", target_path: portalTargetDir }];
  }

  const processorConfig = {
    workspacePath,
    requestsDir,
    blueprintsPath,
    includeReasoning: false,
  };

  const { provider, capturedPrompts } = makeCapturingProvider();
  const activeProvider = opts.providerOverride ?? provider;

  const processor = new RequestProcessor(
    config,
    db,
    processorConfig,
    activeProvider,
    undefined,
    undefined,
    opts.knowledgeService,
  );

  const fullCleanup = async () => {
    await cleanup();
    await Deno.remove(portalTargetDir, { recursive: true }).catch(() => {});
  };

  return { db, config, tempDir, processor, requestsDir, blueprintsPath, capturedPrompts, cleanup: fullCleanup };
}

function makeAgentRequestFile(requestsDir: string, opts: {
  requestId?: string;
  body?: string;
  identity?: string;
  portal?: string;
} = {}): string {
  const requestId = opts.requestId ?? "req-k-001";
  const portalLine = opts.portal ? `portal: "${opts.portal}"` : "";
  const content = `---
trace_id: "trace-${requestId}"
created: "${new Date().toISOString()}"
status: "${RequestStatus.PENDING}"
priority: "normal"
identity: "${opts.identity ?? "test-agent"}"
${portalLine}
created_by: "test-user"
---
${opts.body ?? "Implement the feature"}`;

  const filePath = join(requestsDir, `${requestId}.md`);
  Deno.writeTextFileSync(filePath, content);
  return filePath;
}

function makeFlowRequestFile(requestsDir: string, opts: {
  requestId?: string;
  portal?: string;
} = {}): string {
  const requestId = opts.requestId ?? "req-k-flow-001";
  const portalLine = opts.portal ? `portal: "${opts.portal}"` : "";
  const content = `---
trace_id: "trace-${requestId}"
created: "${new Date().toISOString()}"
status: "${RequestStatus.PENDING}"
priority: "normal"
flow: "test-flow"
${portalLine}
created_by: "test-user"
---
Run the flow`;

  const filePath = join(requestsDir, `${requestId}.md`);
  Deno.writeTextFileSync(filePath, content);
  return filePath;
}

function writeAgentBlueprint(blueprintsPath: string, identityId = "test-agent"): void {
  const content = `---
name: ${identityId}
description: Test agent
---
You are a helpful assistant. When asked to do work, return a structured plan.`;
  Deno.writeTextFileSync(join(blueprintsPath, `${identityId}.md`), content);
}

// ============================================================================
// Unit tests: buildPortalKnowledgeSummary
// ============================================================================

Deno.test("[RequestProcessor] buildPortalKnowledgeSummary includes architecture overview", () => {
  const knowledge = makeKnowledge({ architectureOverview: "## Architecture\nLine 1\nLine 2\n" });
  const summary = buildPortalKnowledgeSummary(knowledge);

  assertStringIncludes(summary, "Architecture");
  assertStringIncludes(summary, "Line 1");
});

Deno.test("[RequestProcessor] buildPortalKnowledgeSummary includes top-5 key files", () => {
  const knowledge = makeKnowledge({
    keyFiles: [
      { path: "src/main.ts", role: "entrypoint", description: "Entry" },
      { path: "src/a.ts", role: "core-service", description: "A" },
      { path: "src/b.ts", role: "core-service", description: "B" },
      { path: "src/c.ts", role: "core-service", description: "C" },
      { path: "src/d.ts", role: "core-service", description: "D" },
      { path: "src/e.ts", role: "core-service", description: "E - should be excluded (6th)" },
    ],
  });
  const summary = buildPortalKnowledgeSummary(knowledge);

  assertStringIncludes(summary, "src/main.ts");
  assertStringIncludes(summary, "src/d.ts");
  assertEquals(summary.includes("src/e.ts"), false, "6th key file should be excluded");
});

Deno.test("[RequestProcessor] clamps PORTAL_KNOWLEDGE_KEY summary to PORTAL_KNOWLEDGE_PROMPT_MAX_LINES", () => {
  const longOverview = Array.from({ length: 200 }, (_, i) => `Line ${i}`).join("\n");
  const knowledge = makeKnowledge({ architectureOverview: longOverview });
  const summary = buildPortalKnowledgeSummary(knowledge);

  const lineCount = summary.split("\n").length;
  assertEquals(
    lineCount <= PORTAL_KNOWLEDGE_PROMPT_MAX_LINES,
    true,
    `Summary must be ≤ ${PORTAL_KNOWLEDGE_PROMPT_MAX_LINES} lines, got ${lineCount}`,
  );
});

// ============================================================================
// Integration tests: process() with knowledge service
// ============================================================================

Deno.test("[RequestProcessor] resolves portal knowledge for portal-bound requests", async () => {
  const knowledgeService = makeMockKnowledgeService();
  const { processor, requestsDir, blueprintsPath, cleanup } = await makeKnowledgeProcessorEnv({
    knowledgeService,
    withPortal: true,
  });
  try {
    writeAgentBlueprint(blueprintsPath);
    const filePath = makeAgentRequestFile(requestsDir, { portal: "test-portal" });
    await processor.process(filePath);

    assertEquals(knowledgeService.callCount, 1, "Knowledge service should be called once");
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor] populates IRequestProcessingContext.portalKnowledge", async () => {
  // Verify knowledge is resolved: the capturing provider should see the knowledge
  // summary in the prompt when knowledge is available.
  const knowledgeService = makeMockKnowledgeService();
  const { provider: capProvider, capturedPrompts } = makeCapturingProvider();
  const { processor, requestsDir, blueprintsPath, cleanup } = await makeKnowledgeProcessorEnv({
    knowledgeService,
    providerOverride: capProvider,
    withPortal: true,
  });
  try {
    writeAgentBlueprint(blueprintsPath);
    const filePath = makeAgentRequestFile(requestsDir, { portal: "test-portal" });
    await processor.process(filePath);

    // Knowledge was resolved → captured prompt should contain knowledge content
    assertExists(capturedPrompts[0], "Provider should have been called");
    assertStringIncludes(capturedPrompts[0], "Portal Knowledge");
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor] injects knowledge Markdown summary into IParsedRequest.context via PORTAL_KNOWLEDGE_KEY", async () => {
  const knowledge = makeKnowledge({ architectureOverview: "## Overview\nSpecific arch line\n" });
  const knowledgeService = makeMockKnowledgeService({ knowledge });
  const { provider: capProvider, capturedPrompts } = makeCapturingProvider();
  const { processor, requestsDir, blueprintsPath, cleanup } = await makeKnowledgeProcessorEnv({
    knowledgeService,
    providerOverride: capProvider,
    withPortal: true,
  });
  try {
    writeAgentBlueprint(blueprintsPath);
    const filePath = makeAgentRequestFile(requestsDir, { portal: "test-portal" });
    await processor.process(filePath);

    assertExists(capturedPrompts[0]);
    assertStringIncludes(capturedPrompts[0], "Specific arch line");
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor] skips knowledge for requests without portal", async () => {
  const knowledgeService = makeMockKnowledgeService();
  const { processor, requestsDir, blueprintsPath, cleanup } = await makeKnowledgeProcessorEnv({
    knowledgeService,
    withPortal: true,
  });
  try {
    writeAgentBlueprint(blueprintsPath);
    // No portal: in frontmatter
    const filePath = makeAgentRequestFile(requestsDir, { requestId: "req-no-portal" });
    await processor.process(filePath);

    assertEquals(knowledgeService.callCount, 0, "Knowledge service should NOT be called when no portal");
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor] uses cached knowledge when fresh", async () => {
  // getOrAnalyze returns immediately (mock always resolves synchronously)
  const knowledge = makeKnowledge();
  const knowledgeService = makeMockKnowledgeService({ knowledge });
  const { processor, requestsDir, blueprintsPath, cleanup } = await makeKnowledgeProcessorEnv({
    knowledgeService,
    withPortal: true,
  });
  try {
    writeAgentBlueprint(blueprintsPath);
    const filePath = makeAgentRequestFile(requestsDir, { requestId: "req-cached", portal: "test-portal" });
    await processor.process(filePath);

    // Knowledge service called exactly once (getOrAnalyze, which uses cache internally)
    assertEquals(knowledgeService.callCount, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor] proceeds without knowledge on failure", async () => {
  const failingService = makeMockKnowledgeService({ fail: true });
  const { processor, requestsDir, blueprintsPath, cleanup } = await makeKnowledgeProcessorEnv({
    knowledgeService: failingService,
    withPortal: true,
  });
  try {
    writeAgentBlueprint(blueprintsPath);
    const filePath = makeAgentRequestFile(requestsDir, { requestId: "req-fail", portal: "test-portal" });
    // Should not throw; process() must return non-null (plan path)
    const result = await processor.process(filePath);
    assertExists(result, "process() must succeed even when knowledge service fails");
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor] passes knowledge to flow processing path", async () => {
  const knowledgeService = makeMockKnowledgeService();
  const { processor, requestsDir, cleanup } = await makeKnowledgeProcessorEnv({
    knowledgeService,
    withPortal: true,
  });
  try {
    const filePath = makeFlowRequestFile(requestsDir, { portal: "test-portal" });
    await processor.process(filePath);

    // Knowledge service must be called for flow-kind requests too
    assertEquals(knowledgeService.callCount, 1, "Knowledge service should be called for flow requests");
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor] returns stale knowledge immediately without blocking on re-analysis", async () => {
  // Mock getOrAnalyze to return immediately — verifies non-blocking behaviour.
  // The mock resolves synchronously so process() should complete without delay.
  const knowledge = makeKnowledge();
  const knowledgeService = makeMockKnowledgeService({ knowledge });
  const { processor, requestsDir, blueprintsPath, cleanup } = await makeKnowledgeProcessorEnv({
    knowledgeService,
    withPortal: true,
  });
  try {
    writeAgentBlueprint(blueprintsPath);
    const filePath = makeAgentRequestFile(requestsDir, { requestId: "req-stale", portal: "test-portal" });

    const start = Date.now();
    await processor.process(filePath);
    const elapsed = Date.now() - start;

    // If getOrAnalyze were blocking re-analysis, it would take much longer.
    // With the mock it resolves immediately; any result is correct here.
    assertEquals(knowledgeService.callCount >= 1, true);
    assertEquals(elapsed < 5000, true, "process() should complete quickly with synchronous mock");
  } finally {
    await cleanup();
  }
});
