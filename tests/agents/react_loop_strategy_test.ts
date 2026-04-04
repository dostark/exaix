/**
 * @module ReActLoopStrategyTest
 * @path tests/agents/react_loop_strategy_test.ts
 * @description Unit tests for ReActLoopStrategy.
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "../../src/services/agent/strategies/react_loop_strategy.ts";
import { ExecutionStrategyName, SecurityMode, ToolName } from "../../src/shared/enums.ts";
import { Config } from "../../src/shared/schemas/config.ts";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX, REACT_THOUGHT_PREFIX } from "../../src/shared/constants.ts";

// Mock dependencies
const _mockConfig: Config = {
  system: { root: "/tmp/react-test", log_level: "info", schema_version: "1.0.0" },
  paths: {
    workspace: "Workspace",
    memory: "Memory",
    blueprints: "Blueprints",
    portals: "Portals",
    identities: "Identities",
    active: "Active",
    archive: "Archive",
    plans: "Plans",
    requests: "Requests",
    rejected: "Rejected",
    runtime: "Runtime",
    flows: "Flows",
    memoryProjects: "Projects",
    memoryExecution: "Execution",
    memoryIndex: "Index",
    memorySkills: "Skills",
    memoryPending: "Pending",
    memoryTasks: "Tasks",
    memoryGlobal: "Global",
  },
  agents: { default_model: "mock:test", timeout_sec: 30, max_iterations: 10 },
  portals: [
    {
      alias: "test",
      target_path: "/tmp/react-test/portal-test",
      identities_allowed: ["*"],
      operations: ["read", "write"],
    } as any,
  ],
  models: { "mock:test": { provider: "mock", model: "test" } },
} as any;

class MockModelProvider {
  private responses: string[] = [];
  private callCount = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async generate(_prompt: string): Promise<string> {
    await Promise.resolve();
    return this.responses[this.callCount++] || `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Task finished`;
  }
}

const mockExecutor = {
  logAgentOutput: async () => {
    await Promise.resolve();
  },
  validateReviewResult: (res: any) => res,
  parseAgentResponse: (response: string, context: any, startTime: number) => {
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
      return JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } catch {
      return {
        branch: "fallback",
        files_changed: [],
        tool_calls: 0,
        execution_time_ms: 0,
        description: "error",
      };
    }
  },
  toolRegistry: {
    execute: async (tool: string, params: any) => {
      await Promise.resolve();
      if (tool === ToolName.WRITE_FILE) {
        return { success: true, data: `Wrote ${params.path}` };
      }
      return { success: false, error: "Unknown tool" };
    },
  },
} as any;

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

  const strategy = new ReActLoopStrategy(mockExecutor, provider as any);
  const result = await strategy.execute(
    { name: "test-agent", capabilities: [ExecutionStrategyName.REACT] } as any,
    { trace_id: "trace-1", request: "write hello world to hello.txt", plan: "Step 1" } as any,
    { portal: "test", security_mode: SecurityMode.SANDBOXED } as any,
  );

  assertEquals(result.description, "Task completed successfully after writing hello.txt");
  assertEquals(result.tool_calls, 1);
});

Deno.test("ReActLoopStrategy - Path Prefixing", async () => {
  let capturedParams: any = null;
  const mockExecutorWithToolCapture = {
    ...mockExecutor,
    toolRegistry: {
      execute: async (_tool: string, params: any) => {
        await Promise.resolve();
        capturedParams = params;
        return { success: true };
      },
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

  const strategy = new ReActLoopStrategy(mockExecutorWithToolCapture as any, provider as any);
  await strategy.execute(
    { name: "test-agent", capabilities: [ExecutionStrategyName.REACT] } as any,
    { trace_id: "trace-2", request: "test", plan: "test" } as any,
    { portal: "test-portal", security_mode: SecurityMode.SANDBOXED } as any,
  );

  // Verify @portal/ prefix is added if portal is specified in options
  assertEquals(capturedParams.path, "@test-portal/sub/file.txt");
});
