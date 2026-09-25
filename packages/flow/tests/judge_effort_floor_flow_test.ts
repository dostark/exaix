/**
 * @module JudgeEffortFloorFlowTest
 * @path packages/flow/tests/judge_effort_floor_flow_test.ts
 * @description Phase-197 Step 5 integration proof: a judge role bound to a flow step never
 *   resolves below the configured judge floor. A fixture `voting-judge` blueprint declaring
 *   `effort: auto` with a SIMPLE request reaches generate() with effort "medium" through the
 *   flow path (FlowRunner → AgentComposerAdapter.run → AgentRunner), while a judge blueprint
 *   declaring `effort: high` keeps sending "high" (GAP-4).
 * @architectural-layer Flows
 * @related-files [packages/flow/src/agent_composer_adapter.ts, packages/execution/src/agent_runner.ts, packages/ai/src/effort_resolver.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { AgentRunner } from "@exaix/execution";
import { AgentComposerAdapter, FlowRunner } from "@exaix/flow";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import type { IFlowEventLogger } from "@exaix/flow";
import type { JSONValue } from "@exaix/core";
import { FlowOutputFormat, FlowStepExecutionMode, TaskComplexity } from "@exaix/core";

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

async function setup(blueprint: string): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await Deno.makeTempDir({ prefix: "judge-effort-flow-" });
  await Deno.mkdir(join(root, "Blueprints", "Agents"), { recursive: true });
  await Deno.writeTextFile(join(root, "Blueprints", "Agents", "voting-judge.md"), blueprint);
  return { root, cleanup: () => Deno.remove(root, { recursive: true }).catch(() => {}) };
}

function judgeFlow(): IFlow {
  const steps = [{
    id: "judge-step",
    name: "Judge",
    agent_role: "voting-judge",
    execution_mode: FlowStepExecutionMode.DECLARED,
    dependsOn: [],
    input: { source: "request", transform: "passthrough" },
  }] as object as IFlowStep[];
  return {
    id: "judge-flow",
    name: "Judge Flow",
    description: "A judge step",
    version: "1.0",
    output: { from: "judge-step" as never, format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
    steps,
  };
}

Deno.test("FlowRunner: a judge blueprint with effort auto resolves to medium on a SIMPLE request", async () => {
  const { root, cleanup } = await setup(
    "---\nagent_role: voting-judge\nmodel: mock:test\neffort: auto\n---\nYou are a voting judge.\n",
  );
  try {
    const { provider, options } = makeCapturingProvider();
    const agentRunner = new AgentRunner(provider, { disableRetry: true });
    const adapter = new AgentComposerAdapter(agentRunner, join(root, "Blueprints", "Agents"));
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new MockFlowEventLogger() });

    await runner.execute(judgeFlow(), {
      userPrompt: "Vote on the change",
      traceId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      requestAnalysis: { complexity: TaskComplexity.SIMPLE } as never,
    });

    const efforts = options.filter((o) => o.effort !== undefined).map((o) => o.effort);
    assertEquals(efforts, ["medium"], "the judge floor must raise SIMPLE auto to medium");
  } finally {
    await cleanup();
  }
});

Deno.test("FlowRunner: a judge blueprint with effort high keeps sending high", async () => {
  const { root, cleanup } = await setup(
    "---\nagent_role: voting-judge\nmodel: mock:test\neffort: high\n---\nYou are a voting judge.\n",
  );
  try {
    const { provider, options } = makeCapturingProvider();
    const agentRunner = new AgentRunner(provider, { disableRetry: true });
    const adapter = new AgentComposerAdapter(agentRunner, join(root, "Blueprints", "Agents"));
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new MockFlowEventLogger() });

    await runner.execute(judgeFlow(), {
      userPrompt: "Vote on the change",
      traceId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      requestAnalysis: { complexity: TaskComplexity.SIMPLE } as never,
    });

    const efforts = options.filter((o) => o.effort !== undefined).map((o) => o.effort);
    assertEquals(efforts, ["high"], "the shipped judge's concrete high must pass through");
  } finally {
    await cleanup();
  }
});
