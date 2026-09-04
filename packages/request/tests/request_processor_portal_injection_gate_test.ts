/**
 * @module RequestProcessorPortalInjectionGateTest
 * @path packages/request/tests/request_processor_portal_injection_gate_test.ts
 * @description Phase 143 Step 2 — RED-first test for the portal-knowledge ablation
 *   switch. `portal_knowledge.injection_enabled` (schema-additive, default true) must
 *   gate the processor's portal-knowledge resolution at the injection site: when false,
 *   the knowledge service is never consulted and no portal-knowledge summary reaches
 *   the prompt; the default and explicit-true paths keep injecting (control).
 * @architectural-layer Services
 * @related-files [packages/request/src/processor.ts, packages/schemas/src/config.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { RequestProcessor } from "@exaix/request";
import { AgentRunner } from "@exaix/execution";
import { PortalOperation } from "@exaix/core";
import type { IApplicationContext, IPortalKnowledgeService } from "@exaix/core/types";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { makeMockKnowledgeService, makeRequestProcessorEnv as makeEnvBase } from "./request_test_helpers.ts";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { createStubConfig, createStubDisplay, createStubGit } from "@exaix/testing";

function makeCapturingProvider(): IModelProvider {
  return {
    id: "capturing-mock",
    generate: (_prompt: string): Promise<IGenerateResult> => {
      return Promise.resolve({
        content:
          `<thought>Processing</thought>\n<content>\n{"subject": "Test plan", "description": "A plan", "steps": [{"step": 1, "title": "Do", "description": "X"}]}\n</content>`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "capturing-mock",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
}

async function makePortalGateEnv(opts: {
  knowledgeService: IPortalKnowledgeService & { callCount: number };
  injectionEnabled?: boolean;
}): Promise<{
  processor: RequestProcessor;
  config: Awaited<ReturnType<typeof makeEnvBase>>["config"];
  requestsDir: string;
  blueprintsPath: string;
  cleanup: () => Promise<void>;
}> {
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
  if (opts.injectionEnabled !== undefined) {
    config.portal_knowledge!.injection_enabled = opts.injectionEnabled;
  }

  const processorConfig = {
    workspacePath,
    requestsDir,
    blueprintsPath,
    includeReasoning: false,
  };

  const provider = makeCapturingProvider();

  const context: IApplicationContext = {
    config: createStubConfig(config),
    db,
    provider,
    git: createStubGit(),
    display: createStubDisplay(db),
    portalKnowledge: opts.knowledgeService,
  };

  const processor = new RequestProcessor({
    ...processorConfig,
    context,
    testProvider: provider,
    portalKnowledgeService: opts.knowledgeService,
    agentRunner: new AgentRunner(provider),
  });

  const fullCleanup = async () => {
    await cleanup();
    await Deno.remove(portalTargetDir, { recursive: true }).catch(() => {});
  };

  return { processor, config, requestsDir, blueprintsPath, cleanup: fullCleanup };
}

async function processPortalRequest(env: {
  processor: RequestProcessor;
  requestsDir: string;
  blueprintsPath: string;
}): Promise<void> {
  const filePath = join(env.requestsDir, "req-ablate-portal.md");
  await Deno.writeTextFile(
    filePath,
    `---
trace_id: "trace-ablate-portal"
created: "${new Date().toISOString()}"
status: "pending"
priority: "normal"
agent_role: "test-agent"
portal: "test-portal"
created_by: "test-user"
---
Test body`,
  );
  const blueprintPath = join(env.blueprintsPath, "Agents", "test-agent.md");
  await Deno.mkdir(join(env.blueprintsPath, "Agents"), { recursive: true });
  Deno.writeTextFileSync(blueprintPath, "# test-agent blueprint\n{{context}}");
  await env.processor.process(filePath);
}

Deno.test("[RequestProcessor] skips portal knowledge when injection_enabled=false (ablation)", async () => {
  const mockKnowledge = makeMockKnowledgeService();
  const env = await makePortalGateEnv({ knowledgeService: mockKnowledge, injectionEnabled: false });

  try {
    await processPortalRequest(env);

    assertEquals(mockKnowledge.callCount, 0, "knowledge service must not be consulted under ablation");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] keeps portal knowledge when injection_enabled=true (control)", async () => {
  const mockKnowledge = makeMockKnowledgeService();
  const env = await makePortalGateEnv({ knowledgeService: mockKnowledge, injectionEnabled: true });

  try {
    await processPortalRequest(env);

    assertEquals(mockKnowledge.callCount, 1, "knowledge service must be consulted when injection is enabled");
  } finally {
    await env.cleanup();
  }
});
