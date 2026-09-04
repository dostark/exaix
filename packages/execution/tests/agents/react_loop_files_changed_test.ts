/**
 * @module ReActLoopFilesChangedTest
 * @path packages/execution/tests/agents/react_loop_files_changed_test.ts
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/src/agent_composer.ts]
 * @architectural-layer Services
 * @description Offline (mock-provider) tests for ReActLoopStrategy's changeset
 * file tracking: the strategy must report every file it wrote through a
 * write-type tool in the changeset's files_changed. This is the authorization
 * source the git audit needs — without it the audit runs against an empty
 * authorized set and reverts the step's own legitimate writes as a security
 * violation.
 */

import { assertArrayIncludes, assertEquals } from "@std/assert";
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

class ScriptedProvider implements IModelProvider {
  readonly id = "mock-files-provider";
  private callCount = 0;
  constructor(private responses: string[]) {}
  async generate(): Promise<IGenerateResult> {
    await Promise.resolve();
    const content = this.responses[this.callCount++] ??
      `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`;
    return {
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "mock-model",
      provider: "mock",
      cost_usd: 0,
    };
  }
}

const blueprint = {
  name: "files-test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const context = {
  trace_id: "trace-44444444-4444-4444-8444-444444444444",
  request_id: "request-files",
  request: "fix the bug and add tests",
  plan: "edit utils.ts and utils_test.ts",
  portal: "todo-app",
} satisfies IExecutionContext;

const options: IAgentExecutionOptions = {
  agent_role: "files-test-agent",
  portal: "todo-app",
  security_mode: SecurityMode.HYBRID,
  timeout_ms: 300000,
  max_tool_calls: 100,
  audit_enabled: true,
};

function buildExecutor(): ReActExecutor {
  return {
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    parseAgentResponse: (response: string, ctx: IExecutionContext, startTime: number): IChangesetResult => ({
      branch: `feat/${ctx.portal || "test"}`,
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
      execute: async (_tool: string, _params: TestToolParams) => {
        await Promise.resolve();
        return { success: true, data: "ok" };
      },
      getTools: () => [],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  } as ReActExecutor;
}

function writeAction(tool: string, path: string): string {
  return `${REACT_THOUGHT_PREFIX}Writing ${path}.
\`\`\`toml
[[actions]]
tool = "${tool}"
[actions.params]
path = "${path}"
content = "x"
\`\`\`
`;
}

Deno.test("ReActLoop files_changed: write_file target is reported in the changeset", async () => {
  const provider = new ScriptedProvider([
    writeAction(ToolName.WRITE_FILE, "src/utils.ts"),
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}fixed`,
  ]);
  const strategy = new ReActLoopStrategy(buildExecutor(), provider);

  const result = await strategy.execute(blueprint, context, options);

  assertArrayIncludes(
    result.files_changed,
    ["src/utils.ts"],
    "a write_file target must appear in files_changed so the audit can authorize it",
  );
});

Deno.test("ReActLoop files_changed: an action in the SAME turn as STATUS: COMPLETE is still executed", async () => {
  // The exact live-failure shape: the model emits a write_file action AND signals
  // completion in one response. The loop must run the action before honoring
  // completion — otherwise the fix is silently dropped and files_changed is empty.
  const provider = new ScriptedProvider([
    `${REACT_THOUGHT_PREFIX}Applying the fix now, then done.
\`\`\`toml
[[actions]]
tool = "${ToolName.WRITE_FILE}"
[actions.params]
path = "src/utils.ts"
content = "fixed"
\`\`\`
${REACT_STATUS_COMPLETE}
${REACT_SUMMARY_PREFIX}Added null guards.`,
  ]);
  const strategy = new ReActLoopStrategy(buildExecutor(), provider);

  const result = await strategy.execute(blueprint, context, options);

  assertArrayIncludes(
    result.files_changed,
    ["src/utils.ts"],
    "a write action bundled with STATUS: COMPLETE must run, not be discarded by early completion",
  );
});

Deno.test("ReActLoop files_changed: multiple distinct write targets are all reported, de-duplicated", async () => {
  const provider = new ScriptedProvider([
    writeAction(ToolName.WRITE_FILE, "src/utils_test.ts"),
    writeAction(ToolName.WRITE_FILE, "src/utils.ts"),
    writeAction(ToolName.WRITE_FILE, "src/utils.ts"),
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
  ]);
  const strategy = new ReActLoopStrategy(buildExecutor(), provider);

  const result = await strategy.execute(blueprint, context, options);

  assertArrayIncludes(result.files_changed, ["src/utils.ts", "src/utils_test.ts"]);
  assertEquals(
    result.files_changed.filter((f) => f === "src/utils.ts").length,
    1,
    "a file written twice must appear once",
  );
});

Deno.test("ReActLoop files_changed: a read-only step reports no changed files", async () => {
  const provider = new ScriptedProvider([
    `${REACT_THOUGHT_PREFIX}Just reading.
\`\`\`toml
[[actions]]
tool = "read_file"
[actions.params]
path = "src/utils.ts"
\`\`\`
`,
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}reviewed`,
  ]);
  const strategy = new ReActLoopStrategy(buildExecutor(), provider);

  const result = await strategy.execute(blueprint, context, options);

  assertEquals(result.files_changed, [], "read_file must not add to files_changed");
});
