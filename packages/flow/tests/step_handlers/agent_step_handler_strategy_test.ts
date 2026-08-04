/**
 * @module AgentStepHandlerStrategyTest
 * @path packages/flow/tests/step_handlers/agent_step_handler_strategy_test.ts
 * @description Phase 159 Step 4: AgentStepHandler's routing matrix — a DECLARED step with
 *   `strategy` set routes to `agentExecutor.runWithStrategy`; a DYNAMIC step still routes to
 *   the dynamic executor; a step with no strategy still routes to `agentExecutor.run`. An
 *   executor with no `runWithStrategy` fails fast when a step declares a strategy.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ExecutionStrategyName, FlowInputSource, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import type { IFlowStep } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import { AgentStepHandler } from "@exaix/flow";
import type { IAgentExecutor, IFlowStepRequest, IStepExecutionContext } from "@exaix/flow";

class SpyAgentExecutor implements IAgentExecutor {
  runCalls: Array<{ identityId: string; request: IFlowStepRequest }> = [];
  runWithStrategyCalls: Array<{ identityId: string; request: IFlowStepRequest; strategy: string }> = [];

  run(identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.runCalls.push({ identityId, request });
    return Promise.resolve({ thought: "t", content: "declared-run", raw: "r" });
  }

  runWithStrategy(
    identityId: string,
    request: IFlowStepRequest,
    strategy: ExecutionStrategyName.REACT | ExecutionStrategyName.MCP | ExecutionStrategyName.CLI_DELEGATE,
  ): Promise<IAgentExecutionResult> {
    this.runWithStrategyCalls.push({ identityId, request, strategy });
    return Promise.resolve({ thought: "t", content: "strategy-run", raw: "r" });
  }
}

class NoStrategyAgentExecutor implements IAgentExecutor {
  run(identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    return Promise.resolve({ thought: "t", content: `ran ${identityId} ${request.userPrompt}`, raw: "r" });
  }
}

function makeStep(overrides: Partial<IFlowStep> = {}): IFlowStep {
  return {
    id: "step-1",
    name: "Step 1",
    type: FlowStepType.AGENT,
    identity: "senior-coder",
    execution_mode: FlowStepExecutionMode.DECLARED,
    dependsOn: [],
    input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
    retry: { maxAttempts: 1, backoffMs: 1000 },
    ...overrides,
  } as IFlowStep;
}

function makeCtx(step: IFlowStep, portal?: string): IStepExecutionContext {
  return {
    stepType: step.type,
    step,
    flow: { id: "flow-1" },
    request: { userPrompt: "do the task" },
    stepRequest: { userPrompt: "do the task", context: {}, portal },
    flowRunId: "run-1",
    startedAt: new Date(),
    flowLogBase: { flowId: "flow-1" },
  } as IStepExecutionContext;
}

Deno.test("AgentStepHandler: a DECLARED step with strategy routes to runWithStrategy", async () => {
  const agentExecutor = new SpyAgentExecutor();
  const handler = new AgentStepHandler({ agentExecutor });
  const step = makeStep({ strategy: ExecutionStrategyName.CLI_DELEGATE });

  const result = await handler.execute(makeCtx(step, "workspace"));

  assertEquals(agentExecutor.runWithStrategyCalls.length, 1);
  assertEquals(agentExecutor.runCalls.length, 0);
  assertEquals(agentExecutor.runWithStrategyCalls[0].identityId, "senior-coder");
  assertEquals(agentExecutor.runWithStrategyCalls[0].strategy, ExecutionStrategyName.CLI_DELEGATE);
  assertEquals(result.content, "strategy-run");
});

Deno.test("AgentStepHandler: a step with no strategy still routes to run (unchanged)", async () => {
  const agentExecutor = new SpyAgentExecutor();
  const handler = new AgentStepHandler({ agentExecutor });
  const step = makeStep();

  const result = await handler.execute(makeCtx(step, "workspace"));

  assertEquals(agentExecutor.runCalls.length, 1);
  assertEquals(agentExecutor.runWithStrategyCalls.length, 0);
  assertEquals(result.content, "declared-run");
});

Deno.test("AgentStepHandler: a step declaring strategy fails fast when the executor has no runWithStrategy", async () => {
  const agentExecutor = new NoStrategyAgentExecutor();
  const handler = new AgentStepHandler({ agentExecutor });
  const step = makeStep({ strategy: ExecutionStrategyName.REACT });

  const err = await assertRejects(() => handler.execute(makeCtx(step, "workspace")));
  assertStringIncludes(String(err), "step-1");
  assertStringIncludes(String(err), "react");
});
