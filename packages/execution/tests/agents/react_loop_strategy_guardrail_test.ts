/**
 * @module ReActLoopStrategyGuardrailTest
 * @path packages/execution/tests/agents/react_loop_strategy_guardrail_test.ts
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/src/guardrail_runner.ts]
 * @architectural-layer Services
 * @description Phase 107 — verifies the optional IGuardrailRunner screening seam in
 * the ReAct loop: no-op when absent (parity), screen() invoked per iteration, and
 * hasBlockingViolation halting the loop.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint, IGuardrailRunner } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import {
  ExecutionStrategyName,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  REACT_THOUGHT_PREFIX,
  SecurityMode,
} from "@exaix/core";
import { GuardrailBlockedError } from "@exaix/core/planning";
import type { GuardrailIncident } from "@exaix/schemas";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { JSONValue } from "@exaix/core/types";

type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];
type TestToolParams = Record<string, JSONValue>;

class MockModelProvider implements IModelProvider {
  readonly id = "mock-guardrail-provider";
  private callCount = 0;
  constructor(private responses: string[]) {}
  async generate(_prompt: string): Promise<IGenerateResult> {
    await Promise.resolve();
    const content = this.responses[this.callCount++] ??
      `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`;
    return {
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "mock-model",
      provider: "mock",
      cost_usd: 0,
    };
  }
}

/** A test double recording screen() calls and reporting a configurable blocking verdict. */
class StubGuardrailRunner implements IGuardrailRunner {
  readonly screenCalls: Array<{ output: string; traceId: string; iteration: number }> = [];
  blocking = false;
  screen(agentOutput: string, traceId: string, iteration: number): Promise<GuardrailIncident[]> {
    this.screenCalls.push({ output: agentOutput, traceId, iteration });
    return Promise.resolve([]);
  }
  hasBlockingViolation(_traceId: string): boolean {
    return this.blocking;
  }
}

const baseExecutor = {
  logAgentOutput: async () => {
    await Promise.resolve();
  },
  validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
  parseAgentResponse: (_response: string, context: IExecutionContext, startTime: number): IChangesetResult => ({
    branch: `feat/${context.portal || "test"}`,
    commit_sha: "0000000000000000000000000000000000000000",
    files_changed: [],
    description: context.plan || "Task completed",
    tool_calls: 0,
    execution_time_ms: Date.now() - startTime,
  }),
  logGeneration: async () => {
    await Promise.resolve();
  },
  toolRegistry: {
    execute: async (_tool: string, _params: TestToolParams) => {
      await Promise.resolve();
      return { success: true, data: "ok" };
    },
    getTools: () => [],
    getBaseDir: () => "/nonexistent-test-basedir",
  },
};

const blueprint = {
  name: "test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const context = {
  trace_id: "trace-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  request_id: "request-1",
  request: "test",
  plan: "test",
  portal: "test",
} satisfies IExecutionContext;

function options(): IAgentExecutionOptions {
  return {
    agent_role: "test-agent",
    portal: "test",
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

const writeAction = (n: number) =>
  `${REACT_THOUGHT_PREFIX}step ${n}
\`\`\`toml
[[actions]]
tool = "write_file"
[actions.params]
path = "f${n}.txt"
content = "v"
\`\`\`
`;

Deno.test("[execution] ReAct loop behaves identically with no runner injected", async () => {
  const provider = new MockModelProvider([
    writeAction(1),
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
  ]);
  const strategy = new ReActLoopStrategy(baseExecutor as ReActExecutor, provider);
  const result = await strategy.execute(blueprint, context, options());
  assertEquals(result.tool_calls, 1);
});

Deno.test("[execution] injected stub runner.screen() is invoked once per action iteration", async () => {
  const runner = new StubGuardrailRunner();
  const provider = new MockModelProvider([
    writeAction(1),
    writeAction(2),
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
  ]);
  const strategy = new ReActLoopStrategy(
    { ...baseExecutor, guardrailRunner: runner } as ReActExecutor,
    provider,
  );
  await strategy.execute(blueprint, context, options());

  assertEquals(runner.screenCalls.length, 3);
  assertEquals(runner.screenCalls.map((c) => c.iteration), [0, 1, Number.MAX_SAFE_INTEGER]);
  assertEquals(runner.screenCalls[0].traceId, context.trace_id);
});

Deno.test("[execution] hasBlockingViolation halts the loop", async () => {
  const runner = new StubGuardrailRunner();
  runner.blocking = true;
  const provider = new MockModelProvider([writeAction(1)]);
  const strategy = new ReActLoopStrategy(
    { ...baseExecutor, guardrailRunner: runner } as ReActExecutor,
    provider,
  );
  await assertRejects(
    () => strategy.execute(blueprint, context, options()),
    GuardrailBlockedError,
    "guardrail",
  );
  assertEquals(runner.screenCalls.length, 0);
});
