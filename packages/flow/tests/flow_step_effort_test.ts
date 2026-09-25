/**
 * @module FlowStepEffortTest
 * @path packages/flow/tests/flow_step_effort_test.ts
 * @description Phase-197 Step 4 integration proof: two declared steps of one flow with the
 *   SAME role resolve to different per-step effort values at the planning provider call
 *   (FlowRunner → AgentComposerAdapter.run → AgentRunner), and a strategy-routed step's
 *   `effort: medium` reaches AgentComposer.executeStep's resolution through
 *   runWithStrategy (GAP-15).
 * @architectural-layer Flows
 * @related-files [packages/flow/src/flow_runner.ts, packages/flow/src/agent_composer_adapter.ts, packages/execution/src/agent_runner.ts, packages/execution/src/agent_composer.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IModelCallOptions } from "@exaix/schemas";
import { AgentRunner, StrategyRegistry } from "@exaix/execution";
import { EffortResolver } from "@exaix/ai";
import type { IEffortDeclarations, IEffortResolutionSignals } from "@exaix/ai";
import type { IChangesetResult } from "@exaix/schemas/agent_composer.ts";
import { AgentComposerAdapter, FlowRunner } from "@exaix/flow";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import type { IFlowEventLogger } from "@exaix/flow";
import type { JSONValue } from "@exaix/core";
import { ExecutionStrategyName, FlowOutputFormat, FlowStepExecutionMode } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import { initTestDbService } from "@exaix/testing";
import { PortalPermissionsService } from "@exaix/portal";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";

function makeCapturingProvider(): { provider: IModelProvider; options: IModelOptions[] } {
  const options: IModelOptions[] = [];
  const provider: IModelProvider = {
    id: "capturing-mock",
    generate(_prompt: string, opts?: IModelOptions): Promise<IGenerateResult> {
      options.push(opts ?? {});
      return Promise.resolve({
        content: WELL_FORMED_RESPONSE,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "capturing-mock",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  return { provider, options };
}

class MockFlowEventLogger implements IFlowEventLogger {
  log(_event: string, _payload: Record<string, JSONValue | undefined>): Promise<void> | void {
    void _event;
    void _payload;
  }
}

async function setup(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await Deno.makeTempDir({ prefix: "flow-step-effort-" });
  await Deno.mkdir(join(root, "Blueprints", "Agents"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "Blueprints", "Agents", "test-agent.md"),
    "---\nagent_role: test-agent\nmodel: mock:test\neffort: high\n---\nYou are a test agent.\n",
  );
  return { root, cleanup: () => Deno.remove(root, { recursive: true }).catch(() => {}) };
}

Deno.test("FlowRunner: two declared steps of one flow, same role, resolve different effort values", async () => {
  const { root, cleanup } = await setup();
  try {
    const { provider, options } = makeCapturingProvider();
    const seenDeclarations: Array<{ d: IEffortDeclarations; effort: string | undefined }> = [];
    const spyResolver: typeof EffortResolver.prototype = {
      resolve(
        declarations: IEffortDeclarations,
        signals: IEffortResolutionSignals,
      ) {
        const r = new EffortResolver().resolve(declarations, signals);
        seenDeclarations.push({ d: declarations, effort: r.effort });
        return r;
      },
    } as never;
    const agentRunner = new AgentRunner(provider, { disableRetry: true, effortResolver: spyResolver });
    const adapter = new AgentComposerAdapter(agentRunner, join(root, "Blueprints", "Agents"));
    const runner = new FlowRunner({
      agentExecutor: adapter,
      eventLogger: new MockFlowEventLogger(),
    });

    const steps = [
      {
        id: "step-a",
        name: "Step A",
        agent_role: "test-agent",
        execution_mode: FlowStepExecutionMode.DECLARED,
        dependsOn: [],
        input: { source: "request", transform: "passthrough" },
        effort: "low",
      },
      {
        id: "step-b",
        name: "Step B",
        agent_role: "test-agent",
        execution_mode: FlowStepExecutionMode.DECLARED,
        dependsOn: [],
        input: { source: "request", transform: "passthrough" },
        effort: "high",
      },
    ] as object as IFlowStep[];
    const flow: IFlow = {
      id: "effort-flow",
      name: "Effort Flow",
      description: "Two declared steps",
      version: "1.0",
      output: { from: "step-b" as never, format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
      steps,
    };

    await runner.execute(flow, {
      userPrompt: "Do the thing",
      traceId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    });

    const efforts = options.filter((o) => o.effort !== undefined).map((o) => o.effort).sort();
    assertEquals(efforts, ["high", "low"], "step-a low and step-b high must reach the provider");
    const flowStepDecls = seenDeclarations.map((r) => r.d.flowStep?.effort);
    assertEquals(flowStepDecls.includes("low") && flowStepDecls.includes("high"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("runWithStrategy: a strategy-routed step's effort medium reaches executeStep resolution", async () => {
  const { root, cleanup } = await setup();
  const { db, cleanup: dbCleanup } = await initTestDbService();
  try {
    let capturedCallOptions: IModelCallOptions | undefined;
    const stub: {
      name: string;
      callOptions?: IModelCallOptions;
      execute: (
        _b: IAgentFileBlueprint,
        _c: IExecutionContext,
        _o: IAgentExecutionOptions,
      ) => Promise<IChangesetResult>;
    } = {
      name: ExecutionStrategyName.CLI_DELEGATE,
      callOptions: {},
      execute: () => {
        capturedCallOptions = stub.callOptions;
        return Promise.resolve({
          branch: "feat/effort",
          commit_sha: "0000000000000000000000000000000000000000",
          files_changed: [],
          description: "Done",
          tool_calls: 0,
          execution_time_ms: 1,
        });
      },
    };
    const strategyRegistry = new StrategyRegistry();
    strategyRegistry.register(stub as never);

    const config = createTestConfig();
    config.system.root = root;
    config.portals = [{ alias: "TestPortal", target_path: root, operations: [] }] as never;
    const permissions = new PortalPermissionsService(config.portals as never);
    const logger = new EventLogger({ db });

    const adapter = new AgentComposerAdapter(
      {} as never,
      join(root, "Blueprints", "Agents"),
      {
        config,
        db,
        logger,
        permissions,
        strategyRegistry,
      },
    );

    const request = {
      userPrompt: "Do the strategy-routed thing",
      context: {},
      traceId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      portal: "TestPortal",
      effort: "medium",
    };
    await adapter.runWithStrategy("test-agent", request as never, ExecutionStrategyName.CLI_DELEGATE);

    assertEquals(capturedCallOptions?.effort, "medium");
  } finally {
    await dbCleanup();
    await cleanup();
  }
});
Deno.test("adapter.run: a flowStep effort low reaches the AgentRunner resolution", async () => {
  const { root, cleanup } = await setup();
  try {
    const { provider, options } = makeCapturingProvider();
    const agentRunner = new AgentRunner(provider, { disableRetry: true });
    const adapter = new AgentComposerAdapter(agentRunner, join(root, "Blueprints", "Agents"));
    const stepRequest = {
      userPrompt: "Do the thing",
      context: {},
      traceId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      effort: "low",
    };
    await adapter.run("test-agent", stepRequest as never);
    const efforts = options.filter((o) => o.effort !== undefined).map((o) => o.effort);
    assertEquals(efforts, ["low"], "the step-level low must be reached");
  } finally {
    await cleanup();
  }
});
