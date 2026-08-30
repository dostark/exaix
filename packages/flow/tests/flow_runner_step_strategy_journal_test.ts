/**
 * @module FlowRunnerStepStrategyJournalTest
 * @path packages/flow/tests/flow_runner_step_strategy_journal_test.ts
 * @description Phase 159 Step 4: the `flow.step.started`/`flow.step.completed` journal
 *   events carry the step's declared `strategy` in their payload when set, so a scenario
 *   can assert which strategy executed a step. Absent for a step with no strategy.
 *   Phase 167 Step 3 closure: a strategy-declared step's `userPrompt` must NOT carry the
 *   `<content>` plan-envelope output instruction (flow_runner.flowStepOutputInstruction),
 *   because a tool-calling execution strategy (react/cli_delegate/mcp) already instructs
 *   the model to emit tool calls; injecting the "PLANNING phase / output a JSON plan in
 *   <content>" text makes a live model return a plan JSON instead of actions, causing
 *   ReAct to fail with "No actions generated in ReAct iteration". A plain (no-strategy)
 *   agent step keeps the envelope instruction, since its contiguity with the flow's
 *   aggregated output depends on it.
 */

import { assert, assertEquals } from "@std/assert";
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
  received: Array<{ identityId: string; request: IFlowStepRequest }> = [];
  run(identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.received.push({ identityId, request });
    return Promise.resolve({ thought: "ok", content: "done", raw: "done" });
  }
  runWithStrategy(
    identityId: string,
    request: IFlowStepRequest,
    _strategy: ExecutionStrategyName.REACT | ExecutionStrategyName.MCP | ExecutionStrategyName.CLI_DELEGATE,
  ): Promise<IAgentExecutionResult> {
    this.received.push({ identityId, request });
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

Deno.test("FlowRunner: a strategy-declared step's userPrompt does NOT carry the <content> plan-envelope output instruction", async () => {
  // The react step prompt must ONLY instruct tool-calling, never the "PLANNING phase / output
  // a JSON plan in <content>" text, or a live codex model obeys the planning instruction and
  // returns a plan JSON instead of toml tool actions. Regression over react, cli_delegate, mcp.
  for (
    const strategy of [
      ExecutionStrategyName.REACT,
      ExecutionStrategyName.CLI_DELEGATE,
      ExecutionStrategyName.MCP,
    ] as const
  ) {
    const executor = new StubAgentExecutor();
    const runner = new FlowRunner({ agentExecutor: executor, eventLogger: new CapturingEventLogger() });

    await runner.execute(makeFlow(strategy), {
      userPrompt: "do the thing",
      traceId: crypto.randomUUID(),
      requestId: `req-${strategy}`,
      portal: "workspace",
    });

    assertEquals(executor.received.length, 1);
    const prompt = executor.received[0].request.userPrompt;
    assert(
      !prompt.includes("<content>"),
      `strategy step '${strategy}' must not receive the plan-envelope <content> instruction, got: ${prompt}`,
    );
    assert(
      !/step of a multi-agent flow/i.test(prompt),
      `strategy step '${strategy}' must not be told it is a flow output step, got: ${prompt}`,
    );
  }
});

Deno.test("FlowRunner: a plain no-strategy agent step keeps the <content> plan-envelope output instruction", async () => {
  // Regression guard: the flow output step's <content> envelope contract is unchanged for
  // a plain (no-strategy) agent step — the next step / aggregated output still parses it.
  const executor = new StubAgentExecutor();
  const runner = new FlowRunner({ agentExecutor: executor, eventLogger: new CapturingEventLogger() });

  await runner.execute(makeFlow(), {
    userPrompt: "do the thing",
    traceId: crypto.randomUUID(),
    requestId: "req-plain",
    portal: "workspace",
  });

  assertEquals(executor.received.length, 1);
  const prompt = executor.received[0].request.userPrompt;
  assert(prompt.includes("<content>"), "a plain agent step keeps the <content> envelope instruction");
  assert(/must be valid JSON/i.test(prompt), "a plain agent step still demands valid JSON in <content>");
  assert(/step of a multi-agent flow/i.test(prompt), "a plain agent step is still framed as a flow step");
});
