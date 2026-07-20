/**
 * @module ReActLoopStrategyTest
 * @path packages/execution/tests/agents/react_loop_strategy_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description Unit tests for ReActLoopStrategy.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ExecutionStrategyName, SecurityMode, ToolName } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import {
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  REACT_THOUGHT_PREFIX,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import type { JSONValue } from "@exaix/core/types";

class MockModelProvider implements IModelProvider {
  readonly id = "mock-react-provider";
  private responses: string[] = [];
  private callCount = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async generate(_prompt: string): Promise<IGenerateResult> {
    await Promise.resolve();
    const content = this.responses[this.callCount++] ||
      `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Task finished`;
    return {
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "mock-model",
      provider: "mock",
      cost_usd: 0,
    };
  }
}

type TestToolParams = Record<string, JSONValue>;
type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

const testBlueprint = {
  name: "test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const testContext = {
  trace_id: "trace-11111111-1111-4111-8111-111111111111",
  request_id: "request-1",
  request: "test",
  plan: "test",
  portal: "test",
} satisfies IExecutionContext;

function createOptions(portal: string): IAgentExecutionOptions {
  return {
    identity_id: "test-agent",
    portal,
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

const mockExecutor = {
  logAgentOutput: async () => {
    await Promise.resolve();
  },
  validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
  parseAgentResponse: (response: string, context: IExecutionContext, startTime: number): IChangesetResult => {
    // Basic mock parser to satisfy strategy needs
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        branch: `feat/${context.portal || "test"}`,
        commit_sha: "0000000000000000000000000000000000000000",
        files_changed: [],
        description: context.plan || "Task completed",
        tool_calls: 0,
        execution_time_ms: Date.now() - startTime,
      };
    }
    try {
      return JSON.parse(jsonMatch[1] || jsonMatch[0]) as IChangesetResult;
    } catch {
      return {
        branch: "fallback",
        commit_sha: "0000000000000000000000000000000000000000",
        files_changed: [],
        tool_calls: 0,
        execution_time_ms: 0,
        description: "error",
      };
    }
  },
  logGeneration: async () => {
    await Promise.resolve();
  },
  toolRegistry: {
    execute: async (tool: string, params: TestToolParams) => {
      await Promise.resolve();
      if (tool === ToolName.WRITE_FILE) {
        return { success: true, data: `Wrote ${params.path}` };
      }
      return { success: false, error: "Unknown tool" };
    },
    getTools: () => [],
    getBaseDir: () => "/nonexistent-test-basedir",
  },
};

Deno.test("ReActLoopStrategy - Basic Execution", async () => {
  const provider = new MockModelProvider([
    `${REACT_THOUGHT_PREFIX}I should write a file first.
\`\`\`toml
[[actions]]
tool = "write_file"
[actions.params]
path = "hello.txt"
content = "world"
\`\`\`
`,
    `${REACT_STATUS_COMPLETE}
${REACT_SUMMARY_PREFIX}Task completed successfully after writing hello.txt`,
  ]);

  const strategy = new ReActLoopStrategy(mockExecutor as ReActExecutor, provider);
  const result = await strategy.execute(
    testBlueprint,
    { ...testContext, request: "write hello world to hello.txt", plan: "Step 1" },
    createOptions("test"),
  );

  assertEquals(result.description, "Task completed successfully after writing hello.txt");
  assertEquals(result.tool_calls, 1);
});

Deno.test("ReActLoopStrategy - Path Prefixing", async () => {
  let capturedPath = "";
  const mockExecutorWithToolCapture = {
    ...mockExecutor,
    toolRegistry: {
      execute: async (_tool: string, params: TestToolParams) => {
        await Promise.resolve();
        capturedPath = String(params.path ?? "");
        return { success: true };
      },
      getTools: () => [],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };

  const provider = new MockModelProvider([
    `${REACT_THOUGHT_PREFIX}Writing to absolute-ish path.
\`\`\`toml
[[actions]]
tool = "write_file"
[actions.params]
path = "sub/file.txt"
content = "test"
\`\`\`
`,
    `${REACT_STATUS_COMPLETE}
${REACT_SUMMARY_PREFIX}Done`,
  ]);

  const strategy = new ReActLoopStrategy(mockExecutorWithToolCapture as ReActExecutor, provider);
  await strategy.execute(
    testBlueprint,
    { ...testContext, trace_id: "trace-22222222-2222-4222-8222-222222222222" },
    createOptions("test-portal"),
  );

  // Verify @portal/ prefix is added if portal is specified in options
  assertEquals(capturedPath, "@test-portal/sub/file.txt");
});

Deno.test("ReActLoopStrategy - caps loop history to configured budget", async () => {
  const capturedPrompts: string[] = [];
  const provider: IModelProvider = {
    id: "budgeted-react-provider",
    async generate(prompt: string): Promise<IGenerateResult> {
      await Promise.resolve();
      capturedPrompts.push(prompt);

      let content = `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`;
      if (capturedPrompts.length === 1) {
        content = `${REACT_THOUGHT_PREFIX}${"OLD".repeat(40)}
\`\`\`toml
[[actions]]
tool = "write_file"
[actions.params]
path = "hello.txt"
content = "world"
\`\`\`
`;
      }

      return {
        content,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "budgeted-mock",
        provider: "mock",
        cost_usd: 0,
      };
    },
  };

  const budgetedExecutor = {
    ...mockExecutor,
    currentPromptBudget: {
      model: "openai:gpt-4o-mini",
      totalBudgetTokens: 1000,
      safetyBufferTokens: 0,
      sections: {
        system: 100,
        plan: 100,
        portalKnowledge: 50,
        memory: 50,
        skills: 10,
        loopHistory: 10,
      },
    },
    toolRegistry: {
      execute: async () => {
        await Promise.resolve();
        return { success: true, data: "NEW".repeat(40) };
      },
      getTools: () => [],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };

  const strategy = new ReActLoopStrategy(budgetedExecutor as ReActExecutor, provider);
  await strategy.execute(
    testBlueprint,
    { ...testContext, trace_id: "trace-33333333-3333-4333-8333-333333333333" },
    createOptions("test"),
  );

  assertEquals(capturedPrompts.length >= 2, true);
  const historyMatch = capturedPrompts[1].match(/HISTORY:\n([\s\S]*?)\n\nINSTRUCTIONS:/);
  assert(historyMatch, "Expected HISTORY block in second prompt");
  assertEquals(historyMatch[1].length <= 10 * TOKEN_ESTIMATION_CHARS_PER_TOKEN, true);
  assertFalse(historyMatch[1].includes("OLDOLDOLD"));
});
