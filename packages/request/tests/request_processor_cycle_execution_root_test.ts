/**
 * @module RequestProcessorCycleExecutionRootTest
 * @path packages/request/tests/request_processor_cycle_execution_root_test.ts
 * @description Phase 174 Step 2 (GAP-1): RequestProcessor.processFlowRequest derives
 *   executionRoot from the configured portal registry and carries the request's
 *   plan_context_ref into FlowRunner.execute() for a flow with a session_delegate_cycle
 *   step. A missing portal, missing plan_context_ref, or unconfigured portal fails the
 *   request before FlowRunner is ever invoked.
 * @architectural-layer Services
 * @related-files [packages/request/src/processor.ts, packages/flow/src/flow_runner.ts]
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { FlowStepType } from "@exaix/core";
import { RequestProcessor } from "@exaix/request";
import { AgentRunner } from "@exaix/execution";
import { ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { CostTracker } from "@exaix/core/cost";
import type { DatabaseService } from "@exaix/storage-sqlite";
import type { Config } from "@exaix/schemas/config.ts";
import type { IApplicationContext } from "@exaix/core/types";
import type { IFlowRunner } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";
import {
  createStubConfig,
  createStubDisplay,
  createStubGit,
  createStubProvider,
  getWorkspaceDir,
  getWorkspaceRequestsDir,
  initTestDbService,
} from "@exaix/testing";
import { RequestStatus } from "@exaix/core/status";

function makeCycleFlow(id: string): IFlow {
  return {
    id,
    name: id,
    description: id,
    version: "1.0",
    steps: [{ id: "next-steps", agent_role: "senior-coder", type: FlowStepType.SESSION_DELEGATE_CYCLE }],
  } as IFlow;
}

describe("RequestProcessor session_delegate_cycle execution root provenance", () => {
  let testDir: string;
  let config: Config;
  let db: DatabaseService;
  let cleanup: () => Promise<void>;
  let costTracker: CostTracker;

  beforeEach(async () => {
    const testDbResult = await initTestDbService();
    testDir = testDbResult.tempDir;
    db = testDbResult.db;
    config = testDbResult.config;
    cleanup = testDbResult.cleanup;
    costTracker = new CostTracker(db, config);

    await Deno.mkdir(getWorkspaceRequestsDir(testDir), { recursive: true });
    await Deno.mkdir(join(testDir, "Blueprints", "Agents"), { recursive: true });

    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
      name: "mock",
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      capabilities: ["chat"],
      description: "Mock provider for testing",
      strengths: ["fast", "reliable", "deterministic"],
    });
  });

  afterEach(async () => {
    ProviderRegistry.clear();
    await costTracker.flush();
    await cleanup();
  });

  function createProcessor(flowRunner: IFlowRunner): RequestProcessor {
    const provider = createStubProvider("<thought>ok</thought><content>{}</content>");
    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      provider,
      git: createStubGit(),
      display: createStubDisplay(db),
    };
    return new RequestProcessor({
      workspacePath: getWorkspaceDir(testDir),
      requestsDir: getWorkspaceRequestsDir(testDir),
      blueprintsPath: join(testDir, "Blueprints", "Agents"),
      includeReasoning: true,
      context,
      costTracker,
      agentRunner: new AgentRunner(provider),
      flowRunner,
      flowLoader: { loadFlow: (id: string) => Promise.resolve(makeCycleFlow(id)) },
    });
  }

  function writeCycleRequest(opts: { portal?: string; planContextRef?: string }): string {
    const traceId = crypto.randomUUID();
    const requestPath = join(getWorkspaceRequestsDir(testDir), `request-${traceId.slice(0, 8)}.md`);
    const lines = [
      `trace_id: "${traceId}"`,
      `created: "${new Date().toISOString()}"`,
      `status: pending`,
      `priority: high`,
      `flow: dogfood-meta-workflow`,
      opts.portal ? `portal: ${opts.portal}` : null,
      opts.planContextRef ? `plan_context_ref: ${opts.planContextRef}` : null,
      `source: cli`,
      `created_by: "test@example.com"`,
    ].filter(Boolean);
    Deno.writeTextFileSync(requestPath, `---\n${lines.join("\n")}\n---\n\nRun the cycle.\n`);
    return requestPath;
  }

  it("[integration] derives executionRoot from the configured portal and carries plan_context_ref into FlowRunner", async () => {
    config.portals = [{ alias: "exaix-self", target_path: "/configured/portal/root" } as never];
    let captured: { executionRoot?: string; planContextRef?: string } | undefined;
    const flowRunner: IFlowRunner = {
      execute(_flow, request) {
        captured = { executionRoot: request.executionRoot, planContextRef: request.planContextRef };
        return Promise.resolve({
          flowRunId: "run",
          success: true,
          stepResults: new Map(),
          output: "ok",
          duration: 1,
          startedAt: new Date(),
          completedAt: new Date(),
        });
      },
    };
    const requestPath = writeCycleRequest({ portal: "exaix-self", planContextRef: ".exa/PlanContext/phase-174.md" });

    const processor = createProcessor(flowRunner);
    await processor.process(requestPath);

    assert(captured, "FlowRunner.execute must have been called");
    assertEquals(captured!.executionRoot, "/configured/portal/root");
    assertEquals(captured!.planContextRef, ".exa/PlanContext/phase-174.md");
  });

  it("[security] a missing portal fails the request before FlowRunner is invoked", async () => {
    config.portals = [];
    let flowRunnerCalled = false;
    const flowRunner: IFlowRunner = {
      execute() {
        flowRunnerCalled = true;
        return Promise.reject(new Error("must not be called"));
      },
    };
    const requestPath = writeCycleRequest({ planContextRef: ".exa/PlanContext/phase-174.md" });

    const processor = createProcessor(flowRunner);
    const result = await processor.process(requestPath);

    assertEquals(result, null);
    assertEquals(flowRunnerCalled, false);
    const written = await Deno.readTextFile(requestPath);
    assert(written.includes(RequestStatus.FAILED), "request frontmatter must be marked FAILED");
  });

  it("[security] a missing plan_context_ref fails the request before FlowRunner is invoked", async () => {
    config.portals = [{ alias: "exaix-self", target_path: "/configured/portal/root" } as never];
    let flowRunnerCalled = false;
    const flowRunner: IFlowRunner = {
      execute() {
        flowRunnerCalled = true;
        return Promise.reject(new Error("must not be called"));
      },
    };
    const requestPath = writeCycleRequest({ portal: "exaix-self" });

    const processor = createProcessor(flowRunner);
    const result = await processor.process(requestPath);

    assertEquals(result, null);
    assertEquals(flowRunnerCalled, false);
  });

  it("[security] an unconfigured portal alias fails the request before FlowRunner is invoked", async () => {
    config.portals = [{ alias: "some-other-portal", target_path: "/other/root" } as never];
    let flowRunnerCalled = false;
    const flowRunner: IFlowRunner = {
      execute() {
        flowRunnerCalled = true;
        return Promise.reject(new Error("must not be called"));
      },
    };
    const requestPath = writeCycleRequest({ portal: "exaix-self", planContextRef: ".exa/PlanContext/phase-174.md" });

    const processor = createProcessor(flowRunner);
    const result = await processor.process(requestPath);

    assertEquals(result, null);
    assertEquals(flowRunnerCalled, false);
  });
});
