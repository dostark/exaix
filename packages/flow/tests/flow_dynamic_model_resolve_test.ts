/**
 * @module FlowDynamicModelResolveTest
 * @path packages/flow/tests/flow_dynamic_model_resolve_test.ts
 * @description Phase 132 Step 4 — validates that FlowRunner lazily resolves
 *   dynamic model via ModelResolver when executing a flow with dynamic steps.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, @exaix/schemas, @exaix/ai]
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import { FlowRunner } from "@exaix/flow";
import type { IAgentExecutor, IFlowEventLogger, IFlowStepRequest } from "@exaix/flow";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { ModelIntent } from "@exaix/schemas/model_intent.ts";
import type { ModelResolver } from "@exaix/ai";

class MockAgentRunner implements IAgentExecutor {
  run(_identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    return Promise.resolve({ thought: "", content: "mock-result", raw: "mock-result" });
  }
}

const noopLogger: IFlowEventLogger = { log: () => {} };

function createMockFlow(stepId = "step1"): IFlowInput {
  return {
    id: "test-flow",
    name: "Test Flow",
    description: "Flow for dynamic model resolve test",
    steps: [
      {
        id: stepId,
        name: "Step 1",
        identity: "agent1",
        input: { source: FlowInputSource.REQUEST },
        dependsOn: [] as string[],
      },
    ],
    output: { from: stepId, format: FlowOutputFormat.MARKDOWN },
  };
}

Deno.test("[step132.4][dynamic-model] FlowRunner ensures dynamic executor with ModelResolver on execute", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    let resolvedIntent: ModelIntent | undefined;
    const mockResolver = {
      resolve: (intent: ModelIntent) => {
        resolvedIntent = intent;
        return Promise.resolve({ provider: "mock", model: "mock-model", attempt: 1 });
      },
    } as ModelResolver;

    const runner = new FlowRunner({
      agentExecutor: new MockAgentRunner(),
      eventLogger: noopLogger,
      config,
      db,
      modelResolver: mockResolver,
      dynamicModel: "medium",
      dynamicHandlers: new Map(),
    });

    const flow = createMockFlow();
    await runner.execute(flow as IFlow, { userPrompt: "test" });

    assertExists(resolvedIntent);
    assertEquals(resolvedIntent.model_size, "M");
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.4][dynamic-model] FlowRunner with unknown dynamicModel falls through gracefully", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    let resolvedIntent: ModelIntent | undefined;
    const mockResolver = {
      resolve: (intent: ModelIntent) => {
        resolvedIntent = intent;
        return Promise.resolve({ provider: "mock", model: "mock-model", attempt: 1 });
      },
    } as ModelResolver;

    const runner = new FlowRunner({
      agentExecutor: new MockAgentRunner(),
      eventLogger: noopLogger,
      config,
      db,
      modelResolver: mockResolver,
      dynamicModel: "unknown",
      dynamicHandlers: new Map(),
    });

    const flow = createMockFlow();
    await runner.execute(flow as IFlow, { userPrompt: "test" });

    assertExists(resolvedIntent);
    assertEquals(resolvedIntent.model_size, undefined);
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.4][dynamic-model] FlowRunner without modelResolver completes successfully", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const runner = new FlowRunner({
      agentExecutor: new MockAgentRunner(),
      eventLogger: noopLogger,
      config,
      db,
      dynamicModel: "medium",
      dynamicHandlers: new Map(),
    });

    const flow = createMockFlow();
    const result = await runner.execute(flow as IFlow, { userPrompt: "test" });
    assertEquals(result.success, true);
  } finally {
    await cleanup();
  }
});
