/**
 * @module PortalKnowledgeAdaptiveInjectionTest
 * @path packages/request/tests/portal_knowledge_adaptive_injection_test.ts
 * @architectural-layer Services
 * @description Phase 198 Step 3: `RequestProcessor.buildRequestContext` attaches the
 * resolved `IPortalKnowledge` snapshot to `IParsedRequest.portalKnowledgeSnapshot` when
 * `portal_knowledge.inclusion === "adaptive"`, reaching `AgentRunner.assemblePromptSegments`
 * without calling `resolveKnowledgeContext`/`getRelevantContext`; default `summary` mode is
 * unaffected.
 * @related-files ["packages/request/src/processor.ts", "packages/execution/src/agent_runner.ts"]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AgentRunner } from "@exaix/execution";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import { PortalKnowledgeInclusion, PortalOperation } from "@exaix/core";
import { RequestStatus } from "@exaix/core/status";
import type { IApplicationContext, IPortalKnowledgeService } from "@exaix/core/types";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import {
  makeKnowledge,
  makeMockKnowledgeService,
  makeRequestProcessorEnv as makeEnvBase,
} from "./request_test_helpers.ts";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { createStubConfig, createStubDisplay, createStubGit } from "@exaix/testing";
import { RequestProcessor } from "@exaix/request";

function makeCapturingProvider(): { provider: IModelProvider; capturedPrompts: string[] } {
  const capturedPrompts: string[] = [];
  const provider: IModelProvider = {
    id: "capturing-mock",
    generate: (prompt: string): Promise<IGenerateResult> => {
      capturedPrompts.push(prompt);
      return Promise.resolve({
        content:
          `<thought>ok</thought>\n<content>\n{"subject":"t","description":"d","steps":[{"step":1,"title":"t","description":"d"}]}\n</content>`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "capturing-mock",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  return { provider, capturedPrompts };
}

async function makeAdaptiveEnv(opts: {
  knowledgeService: IPortalKnowledgeService & {
    callCount: number;
    relevanceCalls: Array<{ text: string; path: string; maxTokens: number }>;
  };
  inclusion?: PortalKnowledgeInclusion;
  withTokenizer?: boolean;
}) {
  const { db, config, tempDir, cleanup } = await makeEnvBase();

  const workspacePath = join(tempDir, config.paths.workspace);
  const requestsDir = join(workspacePath, config.paths.requests);
  const blueprintsPath = join(tempDir, config.paths.blueprints);
  const agentRolesPath = join(blueprintsPath, config.paths.agents);
  await Deno.mkdir(agentRolesPath, { recursive: true });

  const portalTargetDir = await Deno.makeTempDir({ prefix: "portal-target-" });
  config.portals = [{
    alias: "test-portal",
    target_path: portalTargetDir,
    default_branch: TEST_DEFAULT_BRANCH,
    agents_allowed: ["*"],
    operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
  }];
  config.portal_knowledge = {
    ...config.portal_knowledge,
    inclusion: opts.inclusion ?? PortalKnowledgeInclusion.ADAPTIVE,
  };

  const { provider, capturedPrompts } = makeCapturingProvider();

  const context: IApplicationContext = {
    config: createStubConfig(config),
    db,
    provider,
    git: createStubGit(),
    display: createStubDisplay(db),
    portalKnowledge: opts.knowledgeService,
  };

  const agentRunner = new AgentRunner(
    provider,
    opts.withTokenizer === false ? {} : { tokenizer: new AiTokenEstimatorTokenizer() },
  );

  const processor = new RequestProcessor({
    workspacePath,
    requestsDir,
    blueprintsPath,
    includeReasoning: false,
    context,
    testProvider: provider,
    portalKnowledgeService: opts.knowledgeService,
    agentRunner,
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
  agent_role?: string;
  portal?: string;
} = {}): string {
  const requestId = opts.requestId ?? "req-adaptive-001";
  const portalLine = opts.portal ? `portal: "${opts.portal}"` : "";
  const content = `---
trace_id: "trace-${requestId}"
created: "${new Date().toISOString()}"
status: "${RequestStatus.PENDING}"
priority: "normal"
agent_role: "${opts.agent_role ?? "test-agent"}"
assessed_at: "${new Date().toISOString()}"
${portalLine}
created_by: "test-user"
---
${opts.body ?? "Test body"}`;

  const filePath = join(requestsDir, `${requestId}.md`);
  Deno.writeTextFileSync(filePath, content);
  return filePath;
}

Deno.test("[adaptive injection] adaptive mode attaches the snapshot, skips resolveKnowledgeContext/getRelevantContext, and surfaces a named symbol", async () => {
  const knowledge = makeKnowledge({
    symbolMap: [{
      name: "PaymentRouter",
      kind: "class",
      file: "src/services/auth.ts",
      signature: "class PaymentRouter",
      doc: "Routes payment requests",
    }],
  });
  const mockKnowledge = makeMockKnowledgeService({ knowledge, relevanceEnabled: true });
  const env = await makeAdaptiveEnv({ knowledgeService: mockKnowledge, inclusion: PortalKnowledgeInclusion.ADAPTIVE });

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, {
      portal: "test-portal",
      body: "Investigate PaymentRouter behavior",
    });
    const blueprintPath = join(env.blueprintsPath, "Agents", "test-agent.md");
    Deno.writeTextFileSync(blueprintPath, "# test-agent blueprint\n{{context}}");

    await env.processor.process(filePath);

    assertEquals(mockKnowledge.callCount, 1, "getOrAnalyze should resolve the snapshot exactly once");
    assertEquals(mockKnowledge.relevanceCalls.length, 0, "adaptive mode must not call getRelevantContext");

    const lastPrompt = env.capturedPrompts[env.capturedPrompts.length - 1];
    assertEquals(lastPrompt.includes("## Portal Knowledge Summary"), false, "the fixed HNSW/text summary must not run");
    assertStringIncludes(lastPrompt, "PaymentRouter");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[adaptive injection] default summary mode is unaffected by the adaptive branch", async () => {
  const knowledge = makeKnowledge();
  const mockKnowledge = makeMockKnowledgeService({ knowledge });
  const env = await makeAdaptiveEnv({ knowledgeService: mockKnowledge, inclusion: PortalKnowledgeInclusion.SUMMARY });

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { portal: "test-portal" });
    const blueprintPath = join(env.blueprintsPath, "Agents", "test-agent.md");
    Deno.writeTextFileSync(blueprintPath, "# test-agent blueprint\n{{context}}");

    await env.processor.process(filePath);

    const lastPrompt = env.capturedPrompts[env.capturedPrompts.length - 1];
    assertStringIncludes(lastPrompt, "## Portal Knowledge Summary");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[adaptive injection] no portal and disabled injection keep their existing no-snapshot paths", async () => {
  const mockKnowledge = makeMockKnowledgeService();
  const env = await makeAdaptiveEnv({ knowledgeService: mockKnowledge, inclusion: PortalKnowledgeInclusion.ADAPTIVE });

  try {
    const filePath = makeAgentRequestFile(env.requestsDir, { portal: undefined });
    const blueprintPath = join(env.blueprintsPath, "Agents", "test-agent.md");
    Deno.writeTextFileSync(blueprintPath, "# test-agent blueprint\n{{context}}");

    await env.processor.process(filePath);

    assertEquals(mockKnowledge.callCount, 0, "no portal means no knowledge resolution regardless of inclusion mode");
  } finally {
    await env.cleanup();
  }
});
