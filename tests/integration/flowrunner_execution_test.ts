/**
 * @module FlowRunnerExecutionIntegrationTest
 * @path tests/integration/flowrunner_execution_test.ts
 * @description Integration test: flow request → RequestProcessor delegates to
 * FlowRunner when configured in processor config.
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import {
  createStubConfig,
  createStubDisplay,
  createStubGit,
  createStubProvider,
  getWorkspaceDir,
  getWorkspaceRequestsDir,
  initTestDbService,
} from "@exaix/testing";
import { ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { RequestProcessor } from "@exaix/request";
import { CostTracker } from "@exaix/core/cost";
import type { IApplicationContext } from "@exaix/core/types";
import type { IFlowRunner } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import type { IFlowLoaderService } from "@exaix/core/types";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";

Deno.test({
  name: "[integration] Flow request delegates to FlowRunner when configured",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { db, config, tempDir, cleanup } = await initTestDbService();
    ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
      name: "mock",
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      capabilities: ["chat"],
      description: "Mock provider for testing",
      strengths: ["fast", "reliable", "deterministic"],
    });

    try {
      const identitiesDir = join(tempDir, "Blueprints", "Agents");
      const requestsDir = getWorkspaceRequestsDir(tempDir);
      await Deno.mkdir(identitiesDir, { recursive: true });
      await Deno.mkdir(requestsDir, { recursive: true });

      await Deno.writeTextFile(
        join(identitiesDir, "default.md"),
        `---
identity_id: "default"
name: "Default Agent"
model: "mock:gpt-5.2-pro"
---\nYou are a helpful assistant.`,
      );

      // A missing loader is a hard wiring fault: `loadFlowOrFail` reports "Flow requests
      // require a flowLoader" and returns null, so the runner is never reached. Previously the
      // processor fabricated `{ id } as IFlow` and this test passed while the real path was broken.
      const flowLoader: IFlowLoaderService = {
        loadFlow: (flowId: string) =>
          // Parsed through the real schema so the stub gains the same defaults (version,
          // settings, per-step type/execution_mode) a loaded blueprint has, and cannot drift
          // from IFlow as fields are added.
          Promise.resolve(FlowSchema.parse({
            id: flowId,
            name: "Code Review",
            description: "Flow blueprint stub for the delegation test",
            steps: [{
              id: "review",
              name: "Review",
              identity: "default",
              input: { source: FlowInputSource.REQUEST },
              dependsOn: [],
            }],
            output: { from: "review", format: FlowOutputFormat.MARKDOWN },
          })),
      };

      let flowRunnerCalled = false;
      const mockFlowRunner: IFlowRunner = {
        execute(
          _flow: IFlow,
          _request: { userPrompt: string; traceId?: string; requestId?: string },
        ) {
          flowRunnerCalled = true;
          return Promise.resolve({
            flowRunId: "test-run",
            success: true,
            stepResults: new Map<string, never>(),
            output: "Flow execution result",
            duration: 50,
            startedAt: new Date(),
            completedAt: new Date(),
          });
        },
      };

      const provider = createStubProvider();
      const costTracker = new CostTracker(db, config);
      const context: IApplicationContext = {
        config: createStubConfig(config),
        db,
        provider,
        git: createStubGit(),
        display: createStubDisplay(db),
      };

      const requestProcessor = new RequestProcessor({
        workspacePath: getWorkspaceDir(tempDir),
        requestsDir,
        blueprintsPath: identitiesDir,
        includeReasoning: true,
        context,
        costTracker,
        flowRunner: mockFlowRunner,
        flowLoader,
      });

      const traceId = crypto.randomUUID();
      const requestPath = join(requestsDir, `${traceId}.md`);
      await Deno.writeTextFile(
        requestPath,
        `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: high
flow: code-review
source: cli
created_by: "test@example.com"
---

Review pull request #42.`,
      );

      await requestProcessor.process(requestPath);
      assert(flowRunnerCalled, "FlowRunner.execute should be called for flow requests");
    } finally {
      await cleanup();
    }
  },
});
