/**
 * @module FlowRunnerStepStrategyJournalTest
 * @path packages/flow/tests/flow_runner_step_strategy_journal_test.ts
 * @description Phase 159 Step 4: the `flow.step.started`/`flow.step.completed` journal
 *   events carry the step's declared `strategy` in their payload when set, so a scenario
 *   can assert which strategy executed a step. Absent for a step with no strategy.
 */

import { assertEquals } from "@std/assert";
import {
  ExecutionStrategyName,
  FlowInputSource,
  FlowOutputFormat,
  FlowStepExecutionMode,
  FlowStepType,
} from "@exaix/core";
import { FlowRunner, type IAgentExecutor, type IFlowEventLogger, type IFlowStepRequest } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { JSONValue } from "@exaix/core/types";

class StubAgentExecutor implements IAgentExecutor {
  run(_identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    return Promise.resolve({ thought: "ok", content: "done", raw: "done" });
  }
  runWithStrategy(
    _identityId: string,
    _request: IFlowStepRequest,
    _strategy: ExecutionStrategyName.REACT | ExecutionStrategyName.MCP | ExecutionStrategyName.CLI_DELEGATE,
  ): Promise<IAgentExecutionResult> {
    return Promise.resolve({ thought: "ok", content: "strategy-done", raw: "strategy-done" });
  }
}

class CapturingEventLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];
  log(event: string, payload: Record<string, JSONValue | undefined>): void {
    this.events.push({ event, payload });
  }
}

function makeFlow(
  strategy?: ExecutionStrategyName.REACT | ExecutionStrategyName.MCP | ExecutionStrategyName.CLI_DELEGATE,
): IFlow {
  return {
    id: "strategy-journal-flow",
    name: "Strategy Journal Flow",
    description: "test",
    version: "1.0.0",
    steps: [
      {
        id: "s1",
        name: "Step 1",
        type: FlowStepType.AGENT,
        identity: "senior-coder",
        execution_mode: FlowStepExecutionMode.DECLARED,
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: 1000 },
        strategy,
      },
    ],
    output: { from: "s1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
  };
}

Deno.test("FlowRunner: flow.step.started/completed carry strategy in payload when the step declares one", async () => {
  const eventLogger = new CapturingEventLogger();
  const runner = new FlowRunner({ agentExecutor: new StubAgentExecutor(), eventLogger });

  await runner.execute(makeFlow(ExecutionStrategyName.CLI_DELEGATE), {
    userPrompt: "do the thing",
    traceId: crypto.randomUUID(),
    requestId: "req-1",
    portal: "workspace",
  });

  const started = eventLogger.events.find((e) => e.event === "flow.step.started");
  const completed = eventLogger.events.find((e) => e.event === "flow.step.completed");
  assertEquals(started?.payload.strategy, ExecutionStrategyName.CLI_DELEGATE);
  assertEquals(completed?.payload.strategy, ExecutionStrategyName.CLI_DELEGATE);
});

Deno.test("FlowRunner: flow.step.started/completed carry no strategy field when the step declares none", async () => {
  const eventLogger = new CapturingEventLogger();
  const runner = new FlowRunner({ agentExecutor: new StubAgentExecutor(), eventLogger });

  await runner.execute(makeFlow(), {
    userPrompt: "do the thing",
    traceId: crypto.randomUUID(),
    requestId: "req-2",
    portal: "workspace",
  });

  const started = eventLogger.events.find((e) => e.event === "flow.step.started");
  const completed = eventLogger.events.find((e) => e.event === "flow.step.completed");
  assertEquals(started?.payload.strategy, undefined);
  assertEquals(completed?.payload.strategy, undefined);
});
