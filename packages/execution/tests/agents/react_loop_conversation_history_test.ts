/**
 * @module ReActLoopConversationHistoryTest
 * @path packages/execution/tests/agents/react_loop_conversation_history_test.ts
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/tests/agents/react_loop_strategy_test.ts]
 * @architectural-layer Services
 * @description Offline (mock-provider) integration tests for ReActLoopStrategy's
 * conversation-history round-trip: each turn's parsed thought and every tool execution
 * result must be appended to the loop history and actually SENT to the model inside the
 * next request's prompt — otherwise the "loop" is a sequence of amnesiac one-shot calls.
 * Complements react_loop_strategy_test.ts (basic execution, budget capping) by asserting
 * the CONTENT of successive prompts, not just that calls happen.
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ExecutionStrategyName, SecurityMode, ToolName } from "@exaix/core";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX, REACT_THOUGHT_PREFIX } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { JSONValue } from "@exaix/core/types";

type TestToolParams = Record<string, JSONValue>;
type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

/** Provider that captures every prompt it is sent and replays scripted responses. */
class CapturingMockProvider implements IModelProvider {
  readonly id = "mock-history-provider";
  readonly prompts: string[] = [];
  private callCount = 0;

  constructor(private responses: string[]) {}

  async generate(prompt: string): Promise<IGenerateResult> {
    await Promise.resolve();
    this.prompts.push(prompt);
    const content = this.responses[this.callCount++] ??
      `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}fallback done`;
    return {
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "mock-model",
      provider: "mock",
      cost_usd: 0,
    };
  }
}

const testBlueprint = {
  name: "history-test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const testContext = {
  trace_id: "trace-22222222-2222-4222-8222-222222222222",
  request_id: "request-history",
  request: "read config.json then fix its port value",
  plan: "Read then patch config.json",
  portal: "test",
} satisfies IExecutionContext;

const testOptions: IAgentExecutionOptions = {
  agent_role: "history-test-agent",
  portal: "test",
  security_mode: SecurityMode.SANDBOXED,
  timeout_ms: 300000,
  max_tool_calls: 100,
  audit_enabled: true,
};

const READ_RESULT_DATA = "port=1234 host=localhost";

function buildExecutor(toolResults: Record<string, { success: boolean; data?: string; error?: string }>) {
  return {
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    parseAgentResponse: (response: string, context: IExecutionContext, startTime: number): IChangesetResult => ({
      branch: `feat/${context.portal || "test"}`,
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: response,
      tool_calls: 0,
      execution_time_ms: Date.now() - startTime,
    }),
    logGeneration: async () => {
      await Promise.resolve();
    },
    toolRegistry: {
      execute: async (tool: string, _params: TestToolParams) => {
        await Promise.resolve();
        return toolResults[tool] ?? { success: false, error: `Unknown tool: ${tool}` };
      },
      getTools: () => [],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  } as ReActExecutor;
}

const READ_ACTION_RESPONSE = `${REACT_THOUGHT_PREFIX}I need to read the config first.
\`\`\`toml
[[actions]]
tool = "read_file"
[actions.params]
path = "config.json"
\`\`\`
`;

const WRITE_ACTION_RESPONSE = `${REACT_THOUGHT_PREFIX}Now I will patch the port value.
\`\`\`toml
[[actions]]
tool = "write_file"
[actions.params]
path = "config.json"
content = "port=4321"
\`\`\`
`;

const COMPLETE_RESPONSE = `${REACT_STATUS_COMPLETE}
${REACT_SUMMARY_PREFIX}Patched the port value in config.json`;

Deno.test("ReActLoop history: first prompt carries no HISTORY block, but request and plan", async () => {
  const provider = new CapturingMockProvider([READ_ACTION_RESPONSE, COMPLETE_RESPONSE]);
  const executor = buildExecutor({ [ToolName.READ_FILE]: { success: true, data: READ_RESULT_DATA } });
  const strategy = new ReActLoopStrategy(executor, provider);

  await strategy.execute(testBlueprint, testContext, testOptions);

  assertFalse(provider.prompts[0].includes("HISTORY:"), "turn 1 must not carry a HISTORY block");
  assertStringIncludes(provider.prompts[0], testContext.request);
  assertStringIncludes(provider.prompts[0], testContext.plan);
});

Deno.test("ReActLoop history: turn-2 prompt contains turn-1's thought inside HISTORY", async () => {
  const provider = new CapturingMockProvider([READ_ACTION_RESPONSE, COMPLETE_RESPONSE]);
  const executor = buildExecutor({ [ToolName.READ_FILE]: { success: true, data: READ_RESULT_DATA } });
  const strategy = new ReActLoopStrategy(executor, provider);

  await strategy.execute(testBlueprint, testContext, testOptions);

  assertEquals(provider.prompts.length, 2);
  assertStringIncludes(provider.prompts[1], "HISTORY:");
  assertStringIncludes(
    provider.prompts[1],
    "I need to read the config first.",
    "the previous turn's thought must be replayed to the model",
  );
});

Deno.test("ReActLoop history: turn-2 prompt contains the tool result the registry returned", async () => {
  const provider = new CapturingMockProvider([READ_ACTION_RESPONSE, COMPLETE_RESPONSE]);
  const executor = buildExecutor({ [ToolName.READ_FILE]: { success: true, data: READ_RESULT_DATA } });
  const strategy = new ReActLoopStrategy(executor, provider);

  await strategy.execute(testBlueprint, testContext, testOptions);

  assertStringIncludes(
    provider.prompts[1],
    `Tool ${ToolName.READ_FILE} result:`,
    "the tool result entry must be replayed to the model",
  );
  assertStringIncludes(
    provider.prompts[1],
    READ_RESULT_DATA,
    "the actual tool output data must reach the model, not just a result marker",
  );
});

Deno.test("ReActLoop history: three turns accumulate both exchanges in order", async () => {
  const provider = new CapturingMockProvider([READ_ACTION_RESPONSE, WRITE_ACTION_RESPONSE, COMPLETE_RESPONSE]);
  const executor = buildExecutor({
    [ToolName.READ_FILE]: { success: true, data: READ_RESULT_DATA },
    [ToolName.WRITE_FILE]: { success: true, data: "wrote config.json" },
  });
  const strategy = new ReActLoopStrategy(executor, provider);

  await strategy.execute(testBlueprint, testContext, testOptions);

  assertEquals(provider.prompts.length, 3);
  const turn3 = provider.prompts[2];
  const firstThought = turn3.indexOf("I need to read the config first.");
  const firstResult = turn3.indexOf(READ_RESULT_DATA);
  const secondThought = turn3.indexOf("Now I will patch the port value.");
  const secondResult = turn3.indexOf("wrote config.json");

  assert(firstThought >= 0, "turn-1 thought present in turn-3 prompt");
  assert(firstResult >= 0, "turn-1 tool result present in turn-3 prompt");
  assert(secondThought >= 0, "turn-2 thought present in turn-3 prompt");
  assert(secondResult >= 0, "turn-2 tool result present in turn-3 prompt");
  assert(
    firstThought < firstResult && firstResult < secondThought && secondThought < secondResult,
    "history entries must appear in chronological order",
  );
});

Deno.test("ReActLoop history: a failed tool result is replayed so the model can react to the error", async () => {
  const provider = new CapturingMockProvider([READ_ACTION_RESPONSE, COMPLETE_RESPONSE]);
  const executor = buildExecutor({
    [ToolName.READ_FILE]: { success: false, error: "ENOENT: config.json not found" },
  });
  const strategy = new ReActLoopStrategy(executor, provider);

  await strategy.execute(testBlueprint, testContext, testOptions);

  assertStringIncludes(
    provider.prompts[1],
    "ENOENT: config.json not found",
    "tool failure detail must reach the model, or it cannot correct course",
  );
});
