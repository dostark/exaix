/**
 * @module RequestProcessorKnowledgeTest
 * @path packages/request/tests/request_processor_knowledge_test.ts
 * @architectural-layer Services
 * @description Tests for RequestProcessor integration with IPortalKnowledgeService:
 * resolves portal knowledge pre-execution, injects a capped Markdown summary into
 * IParsedRequest.context via PORTAL_KNOWLEDGE_KEY, passes knowledge to both agent
 * and flow processing paths, and degrades gracefully on failure.
 * @related-files ["packages/request/src/processor.ts", "packages/core/src/types/constants.ts", "packages/core/src/types/i_portal_knowledge_service.ts"]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildPortalKnowledgeSummary, RequestProcessor } from "@exaix/request";
import { AgentRunner } from "@exaix/execution";
import { PORTAL_KNOWLEDGE_PROMPT_MAX_LINES, PortalOperation } from "@exaix/core";
import { RequestStatus } from "@exaix/core/status";
import type { IApplicationContext, IPortalKnowledgeService } from "@exaix/core/types";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import {
  makeKnowledge,
  makeMockKnowledgeService,
  makeRequestProcessorEnv as makeEnvBase,
} from "./request_test_helpers.ts";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { createStubConfig, createStubDisplay, createStubGit } from "@exaix/testing";

// Fixtures

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
    generate: (prompt: string): Promise<IGenerateResult> => {
      capturedPrompts.push(prompt);
      return Promise.resolve({
        content: validResponse,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "capturing-mock",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  return { provider, capturedPrompts };
}

// Test environment setup

async function makeKnowledgeProcessorEnv(opts: {
  knowledgeService?: IPortalKnowledgeService & { callCount: number };
  providerOverride?: IModelProvider;
  withPortal?: boolean;
} = {}) {
  const { db, config, tempDir, cleanup } = await makeEnvBase();

  const workspacePath = join(tempDir, config.paths.workspace);
  const requestsDir = join(workspacePath, config.paths.requests);
  const blueprintsPath = join(tempDir, config.paths.blueprints);
  const identitiesPath = join(blueprintsPath, config.paths.identities);
  await Deno.mkdir(identitiesPath, { recursive: true });

  // Inject a portal entry into the config when portal-bound testing is needed
  const portalTargetDir = await Deno.makeTempDir({ prefix: "portal-target-" });
  if (opts.withPortal !== false) {
    config.portals = [{
      alias: "test-portal",
      target_path: portalTargetDir,
      default_branch: TEST_DEFAULT_BRANCH,
      identities_allowed: ["*"],
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    }];
  }

  const processorConfig = {
    workspacePath,
    requestsDir,
    blueprintsPath,
    includeReasoning: false,
  };

  const { provider, capturedPrompts } = makeCapturingProvider();
  const activeProvider = opts.providerOverride ?? provider;

  const context: IApplicationContext = {
    config: createStubConfig(config),
    db,
    provider: activeProvider,
    git: createStubGit(),
    display: createStubDisplay(db),
    portalKnowledge: opts.knowledgeService,
  };

  const processor = new RequestProcessor({
    ...processorConfig,
    context,
    testProvider: activeProvider,
    portalKnowledgeService: opts.knowledgeService,
    agentRunner: new AgentRunner(activeProvider),
  });

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
identity_id: "${opts.identity ?? "test-agent"}"
assessed_at: "${new Date().toISOString()}"
${portalLine}
created_by: "test-user"
---
${opts.body ?? "Test body"}`;

  const filePath = join(requestsDir, `${requestId}.md`);
  Deno.writeTextFileSync(filePath, content);
  return filePath;
}

// Unit tests: buildPortalKnowledgeSummary

Deno.test("[RequestProcessor] buildPortalKnowledgeSummary: generates Markdown header and conventions", () => {
  const knowledge = makeKnowledge();
  const summary = buildPortalKnowledgeSummary(knowledge);

  assertStringIncludes(summary, "## Portal Knowledge Summary");
  assertStringIncludes(summary, "*.service.ts naming");
});

Deno.test("[RequestProcessor] buildPortalKnowledgeSummary: caps convention lists to stay within token limits", () => {
  const extraConventions = Array.from({ length: PORTAL_KNOWLEDGE_PROMPT_MAX_LINES + 10 }, (_, i) => ({
    name: `Convention ${i}`,
    description: "desc",
    category: "cat",
    evidenceCount: i,
    confidence: "high" as const,
    examples: [],
  }));
  const knowledge = makeKnowledge({
    conventions: extraConventions as IPortalKnowledge["conventions"],
  });
  const summary = buildPortalKnowledgeSummary(knowledge);

  const lines = summary.split("\n");
  // The summary should be approximately capped
  assertEquals(lines.length <= PORTAL_KNOWLEDGE_PROMPT_MAX_LINES, true);
});

// Integration tests: RequestProcessor + IPortalKnowledgeService

Deno.test("[RequestProcessor] resolves portal knowledge before execution and injects it into context", async () => {
  const mockKnowledge = makeMockKnowledgeService();
  const env = await makeKnowledgeProcessorEnv({ knowledgeService: mockKnowledge, withPortal: true });

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { portal: "test-portal" });

    // Write a dummy blueprint
    const blueprintPath = join(env.blueprintsPath, "Identities", "test-agent.md");
    Deno.writeTextFileSync(blueprintPath, "# test-agent blueprint\n{{context}}");

    await env.processor.process(filePath);

    assertEquals(mockKnowledge.callCount, 1, "Knowledge service should have been called");

    // Check captured prompt for knowledge markers
    const lastPrompt = env.capturedPrompts[env.capturedPrompts.length - 1];
    assertStringIncludes(lastPrompt, "## Portal Knowledge Summary");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] passes injected knowledge to agent during prompt generation", async () => {
  const mockKnowledge = makeMockKnowledgeService();
  const env = await makeKnowledgeProcessorEnv({ knowledgeService: mockKnowledge, withPortal: true });

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { portal: "test-portal", identity: "know-agent" });
    // Write a dummy blueprint
    const blueprintPath = join(env.blueprintsPath, "Identities", "know-agent.md");
    Deno.writeTextFileSync(blueprintPath, "# know-agent blueprint\n{{context}}");

    await env.processor.process(filePath);

    // Check captured prompt for knowledge markers
    const lastPrompt = env.capturedPrompts[env.capturedPrompts.length - 1];
    assertStringIncludes(lastPrompt, "## Portal Knowledge Summary");
    assertStringIncludes(lastPrompt, "*.service.ts naming");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] handles knowledge resolution failure gracefully", async () => {
  const failingKnowledge = makeMockKnowledgeService({ fail: true });
  const env = await makeKnowledgeProcessorEnv({ knowledgeService: failingKnowledge, withPortal: true });

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { portal: "test-portal" });

    // Write a dummy blueprint
    const blueprintPath = join(env.blueprintsPath, "Identities", "test-agent.md");
    Deno.writeTextFileSync(blueprintPath, "# test-agent blueprint\n{{context}}");

    // Should not throw
    await env.processor.process(filePath);

    // Check captured prompt: knowledge markers should be absent
    const lastPrompt = env.capturedPrompts[env.capturedPrompts.length - 1];
    assertEquals(lastPrompt.includes("## Portal Knowledge Summary"), false);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] skips knowledge resolution if request specifies no portal", async () => {
  const mockKnowledge = makeMockKnowledgeService();
  const env = await makeKnowledgeProcessorEnv({ knowledgeService: mockKnowledge, withPortal: false });

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { portal: undefined });

    // Write a dummy blueprint
    const blueprintPath = join(env.blueprintsPath, "Identities", "test-agent.md");
    Deno.writeTextFileSync(blueprintPath, "# test-agent blueprint\n{{context}}");

    await env.processor.process(filePath);

    assertEquals(mockKnowledge.callCount, 0, "Knowledge service should not have been called");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] calls getRelevantContext when portal knowledge resolved", async () => {
  const mockKnowledge = makeMockKnowledgeService({ relevanceEnabled: true });
  const env = await makeKnowledgeProcessorEnv({ knowledgeService: mockKnowledge, withPortal: true });

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { portal: "test-portal" });

    // Write a dummy blueprint
    const blueprintPath = join(env.blueprintsPath, "Identities", "test-agent.md");
    Deno.writeTextFileSync(blueprintPath, "# test-agent blueprint\n{{context}}");

    await env.processor.process(filePath);

    // getRelevantContext should have been called
    assertEquals(
      mockKnowledge.relevanceCalls.length,
      1,
      "getRelevantContext should be called once during processing",
    );

    // The prompt should contain the relevant context instead of the full summary
    const lastPrompt = env.capturedPrompts[env.capturedPrompts.length - 1];
    assertStringIncludes(lastPrompt, "Relevant: TypeScript service");
    assertEquals(lastPrompt.includes("## Portal Knowledge Summary"), false);
  } finally {
    await env.cleanup();
  }
});
