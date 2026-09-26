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
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import {
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  REACT_THOUGHT_PREFIX,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import type { JSONValue } from "@exaix/core/types";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";

class MockModelProvider implements IModelProvider {
  readonly id = "mock-react-provider";
  private responses: string[] = [];
  private callCount = 0;
  readonly prompts: string[] = [];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async generate(prompt: string): Promise<IGenerateResult> {
    await Promise.resolve();
    this.prompts.push(prompt);
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
    agent_role: "test-agent",
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

Deno.test("[react_loop] a TOML action naming the alias Read executes as read_file (Phase 201 Step 3)", async () => {
  const executed: Array<{ tool: string; params: Record<string, JSONValue> }> = [];
  const executor = {
    ...mockExecutor,
    toolRegistry: {
      execute: (tool: string, params: Record<string, JSONValue>) => {
        executed.push({ tool, params });
        return Promise.resolve({ success: true, data: { content: "hi" } });
      },
      getTools: () => [{
        name: "read_file",
        description: "read",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      }],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };
  const provider = new MockModelProvider([
    `${REACT_THOUGHT_PREFIX}Read file.
\`\`\`toml
[[actions]]
tool = "Read"
[actions.params]
file_path = "src/a.ts"
\`\`\`
`,
    `${REACT_STATUS_COMPLETE}
${REACT_SUMMARY_PREFIX}Done`,
  ]);
  await new ReActLoopStrategy(executor as ReActExecutor, provider).execute(
    testBlueprint,
    testContext,
    { ...createOptions("test"), permitted_tools: ["read_file"] },
  );
  assertEquals(executed, [{ tool: "read_file", params: { path: "@test/src/a.ts" } }]);
});

Deno.test("[react_loop] an edit {file_path} write is recorded in writtenFiles and journaled as patch_file", async () => {
  const executor = {
    ...mockExecutor,
    toolRegistry: {
      execute: () => Promise.resolve({ success: true, data: {} }),
      getTools: () => [{
        name: "patch_file",
        description: "patch",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" } },
        },
      }],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };
  const provider = new MockModelProvider([
    `${REACT_THOUGHT_PREFIX}Edit file.
\`\`\`toml
[[actions]]
tool = "edit"
[actions.params]
file_path = "src/a.ts"
old_string = "a"
new_string = "b"
\`\`\`
`,
    `${REACT_STATUS_COMPLETE}
${REACT_SUMMARY_PREFIX}Done`,
  ]);
  const result = await new ReActLoopStrategy(executor as ReActExecutor, provider).execute(
    testBlueprint,
    testContext,
    { ...createOptions("test"), permitted_tools: ["patch_file"] },
  );
  assertEquals(result.files_changed, ["src/a.ts"]);
});

Deno.test("[react_loop] canonicalizes a path parameter before registry execution", async () => {
  const executed: Array<{ tool: string; params: Record<string, JSONValue> }> = [];
  const executor = {
    ...mockExecutor,
    toolRegistry: {
      execute: (tool: string, params: Record<string, JSONValue>) => {
        executed.push({ tool, params });
        return Promise.resolve({ success: true, data: { content: "outside" } });
      },
      getTools: () => [{
        name: "read_file",
        description: "read",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      }],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };
  const provider = new MockModelProvider([
    `${REACT_THOUGHT_PREFIX}Read file.
\`\`\`toml
[[actions]]
tool = "read_file"
[actions.params]
        file_path = "src/a.ts"
\`\`\`
`,
    `${REACT_STATUS_COMPLETE}
${REACT_SUMMARY_PREFIX}Denied`,
  ]);
  await new ReActLoopStrategy(executor as ReActExecutor, provider).execute(
    testBlueprint,
    testContext,
    { ...createOptions("test"), permitted_tools: ["read_file"] },
  );
  assertEquals(executed, [{ tool: "read_file", params: { path: "@test/src/a.ts" } }]);
});

Deno.test("[react_loop] a canonical role allowlist permits search_files and denies it when absent", async () => {
  const calls: Array<{ tool: string; params: TestToolParams }> = [];
  let executeCount = 0;
  const executor = {
    ...mockExecutor,
    toolRegistry: {
      execute: (tool: string, params: TestToolParams) => {
        executeCount++;
        calls.push({ tool, params });
        return Promise.resolve({ success: true, data: { files: [] } });
      },
      getTools: () => [{
        name: "search_files",
        description: "search",
        parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } } },
      }],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
    logDynamicToolCall: (_trace: string, tool: string, params: TestToolParams) => {
      calls.push({ tool, params });
      return Promise.resolve();
    },
  };
  const action = `${REACT_THOUGHT_PREFIX}Search.
\`\`\`toml
[[actions]]
tool = "search_files"
[actions.params]
pattern = "*.ts"
path = "."
\`\`\`
`;
  const responses = [
    action,
    `${REACT_STATUS_COMPLETE}
${REACT_SUMMARY_PREFIX}Done`,
  ];
  await new ReActLoopStrategy(executor as ReActExecutor, new MockModelProvider(responses)).execute(
    testBlueprint,
    testContext,
    { ...createOptions("test"), permitted_tools: ["search_files"] },
  );
  assertEquals(calls[0], { tool: "search_files", params: { pattern: "*.ts", path: "@test/." } });
  assertEquals(calls[1].tool, "search_files");
  assertEquals(executeCount, 1);

  calls.length = 0;
  await new ReActLoopStrategy(executor as ReActExecutor, new MockModelProvider(responses)).execute(
    testBlueprint,
    testContext,
    { ...createOptions("test"), permitted_tools: [] },
  );
  assertEquals(executeCount, 1);
});

Deno.test("[react_loop] rendered AVAILABLE TOOLS contains canonical names; a permitted_tools alias resolves before rendering", async () => {
  const executor = {
    ...mockExecutor,
    toolRegistry: {
      execute: () => Promise.resolve({ success: true, data: {} }),
      getTools: () => [{
        name: "grep_search",
        description: "search",
        parameters: { type: "object", properties: { pattern: { type: "string" } } },
      }],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };
  const provider = new MockModelProvider([
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`,
  ]);
  await new ReActLoopStrategy(executor as ReActExecutor, provider).execute(
    testBlueprint,
    testContext,
    { ...createOptions("test"), permitted_tools: ["grep"] },
  );
  assertEquals(provider.prompts.length, 1);
  const toolsLine = provider.prompts[0].split("AVAILABLE TOOLS:\n")[1]?.split("\n")[0];
  assertEquals(toolsLine, "grep_search");
});

Deno.test("[security] ReActLoopStrategy denies read_file with an absolute file_path outside the portal", async () => {
  const root = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/portal/src`, { recursive: true });
    await Deno.writeTextFile(`${root}/portal/src/a.ts`, "export const a = 1;\n");
    await Deno.writeTextFile(`${outside}/secret.txt`, "OUTSIDE\n");
    const config = createMockConfig(root);
    config.portals = [{ alias: "p", target_path: `${root}/portal` } as never];
    const registry = new ToolRegistry({ config, baseDir: `${root}/portal` });
    const executor = { ...mockExecutor, toolRegistry: registry };
    const provider = new MockModelProvider([
      `${REACT_THOUGHT_PREFIX}Read file.
\`\`\`toml
[[actions]]
tool = "read_file"
[actions.params]
file_path = "${outside}/secret.txt"
\`\`\`
`,
      `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`,
    ]);
    await new ReActLoopStrategy(executor as ReActExecutor, provider).execute(
      testBlueprint,
      { ...testContext, portal: "p" },
      { ...createOptions("p"), permitted_tools: ["read_file"] },
    );
    assertEquals(provider.prompts.length, 2);
    assertFalse(provider.prompts[1].includes("OUTSIDE"));
    assert(provider.prompts[1].includes("denied") || provider.prompts[1].includes("Access"));
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});
