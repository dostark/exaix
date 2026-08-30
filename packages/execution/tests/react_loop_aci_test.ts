/**
 * @module ReActLoopAciTest
 * @path packages/execution/tests/react_loop_aci_test.ts
 * @description Phase 112 Step 3 — verifies ReActLoopStrategy derives its visible tool
 *   IDs once and reuses them for both the AVAILABLE TOOLS line and ACI rendering, injects
 *   the allocated ACI section (prose and native-tools/skipToolProse modes) only when
 *   `executor.aciDocsEnabled` is true, leaves the disabled prompt byte-identical to the
 *   pre-phase behaviour, and journals exactly one `agent.prompt_assembled` event per
 *   provider-bound iteration when enabled (none when disabled). The buildPrompt-direct
 *   tests mirror the established bypass pattern in react_loop_native_tools_gate_test.ts;
 *   the execute()-level test exercises the real iteration loop for event cardinality.
 * @architectural-layer Test
 * @related-files ["packages/execution/src/strategies/react_loop_strategy.ts", "packages/execution/src/react_loop_adapter.ts"]
 */

import { assert, assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IReActLoopExecutor } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ExecutionStrategyName, REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX, SecurityMode } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import type { ITool } from "@exaix/core/types";
import { ToolSideEffectScope } from "@exaix/core";
import type { AciDoc } from "@exaix/schemas";
import type { IAgentPromptAssembledReactPayload } from "@exaix/core/events";

const testBlueprint = {
  name: "test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

function testContext(traceId: string): IExecutionContext {
  return { trace_id: traceId, request_id: "request-aci-1", request: "test", plan: "test", portal: "test" };
}

function createOptions(permittedTools?: string[]): IAgentExecutionOptions {
  return {
    identity_id: "test-agent",
    portal: "test",
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
    permitted_tools: permittedTools,
  };
}

const readFileAciDoc: AciDoc = {
  summary: "Return the full text content of a file at the given path.",
  when_to_use: "Use when you already know a file's path and need its full content.",
  when_not_to_use: "Do not use to locate files by pattern; use search_files instead.",
  example: {
    input: { path: "src/example.ts" },
    output: "export function example() {}\n",
    rationale: "A direct, single-file read is the intended use of this tool.",
  },
  anti_example: {
    input: { path: "src/**/*.ts" },
    why_wrong: "read_file takes exactly one literal path, not a glob pattern.",
  },
};

const REGISTRY_TOOLS: ITool[] = [
  {
    name: "read_file",
    description: "Read a file.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    aciDoc: readFileAciDoc,
    sideEffectScope: ToolSideEffectScope.NONE,
  },
  {
    name: "write_file",
    description: "Write a file.",
    parameters: { type: "object", properties: {}, required: [] },
    // No aciDoc — must be omitted fail-closed if ever requested.
  },
];

interface IBuildPromptExecutor {
  aciDocsEnabled?: boolean;
  aciDocPromptMaxChars?: number;
  toolRegistry: { getTools(): ITool[] };
}

/** Direct-call bypass for the private buildPrompt method, mirroring react_loop_native_tools_gate_test.ts. */
function callBuildPrompt(
  executor: IBuildPromptExecutor,
  options: IAgentExecutionOptions,
  skipToolProse = false,
): string {
  const strategy = new ReActLoopStrategy(executor as never as IReActLoopExecutor);
  const typed = strategy as never as {
    buildPrompt(
      blueprint: IAgentFileBlueprint,
      context: IExecutionContext,
      options: IAgentExecutionOptions,
      history: Array<{ role: string; content: string }>,
      skipToolProse?: boolean,
    ): string;
  };
  return typed.buildPrompt(testBlueprint, testContext("trace-buildprompt-1"), options, [], skipToolProse);
}

function toolRegistryOf(tools: ITool[] = REGISTRY_TOOLS): { getTools(): ITool[] } {
  return { getTools: () => tools };
}

Deno.test("[ReActLoopAci] enabled read_file injection reaches the exact prompt, in both prose and skipToolProse modes", () => {
  for (const skipToolProse of [false, true]) {
    const prompt = callBuildPrompt(
      { aciDocsEnabled: true, toolRegistry: toolRegistryOf() },
      createOptions(["read_file"]),
      skipToolProse,
    );
    assert(prompt.includes("ACI TOOL GUIDANCE"), `skipToolProse=${skipToolProse}: ACI section must be present`);
    assert(prompt.includes(JSON.stringify(readFileAciDoc.summary)), "prompt must carry the JSON-encoded ACI summary");
  }
});

Deno.test("[ReActLoopAci] disabled prompt is byte-identical to the pre-ACI behaviour", () => {
  const disabledPrompt = callBuildPrompt(
    { aciDocsEnabled: false, toolRegistry: toolRegistryOf() },
    createOptions(["read_file"]),
  );
  // A pre-ACI executor (no aciDocsEnabled/toolRegistry.getTools() ever called) yields the
  // exact same bytes — proving the disabled path never even touches the renderer.
  const preAciPrompt = callBuildPrompt(
    {
      toolRegistry: {
        getTools: () => {
          throw new Error("must not be called when disabled");
        },
      },
    },
    createOptions(["read_file"]),
  );
  assertEquals(disabledPrompt, preAciPrompt);
  assert(!disabledPrompt.includes("ACI TOOL GUIDANCE"), "disabled prompt must carry no ACI section");
});

Deno.test("[ReActLoopAci] permitted_tools: [] stays empty and injects no ACI section", () => {
  const prompt = callBuildPrompt(
    { aciDocsEnabled: true, toolRegistry: toolRegistryOf() },
    createOptions([]),
  );
  assertEquals(prompt.includes("AVAILABLE TOOLS:\n"), true);
  assertEquals(prompt.includes("ACI TOOL GUIDANCE"), false);
});

Deno.test("[ReActLoopAci] duplicate IDs are deduplicated everywhere; unknown IDs are ignored by ACI rendering", () => {
  const prompt = callBuildPrompt(
    { aciDocsEnabled: true, toolRegistry: toolRegistryOf() },
    createOptions(["read_file", "read_file", "does_not_exist"]),
  );
  const availableToolsLine = prompt.split("\n").find((line) => line.startsWith("read_file"));
  // The tool-listing line trusts permitted_tools verbatim but deduplicates the repeated
  // "read_file" entry — it never appears twice.
  assertEquals(availableToolsLine, "read_file, does_not_exist");
  // The ACI renderer independently ignores unknown IDs: only a real registry tool can
  // produce a fragment, and read_file's fragment appears exactly once, not twice.
  const aciOccurrences = prompt.split("### read_file").length - 1;
  assertEquals(aciOccurrences, 1, "the ACI fragment for read_file must appear exactly once");
  assertEquals(prompt.includes("### does_not_exist"), false, "an unknown tool ID can never render a fragment");
});

Deno.test("[ReActLoopAci] repeated iterations emit one agent.prompt_assembled event each, with indices 0 and 1", async () => {
  const capturedEvents: Array<{ traceId: string; target: string; payload: IAgentPromptAssembledReactPayload }> = [];
  const capturedPrompts: string[] = [];
  let callCount = 0;
  const provider: IModelProvider = {
    id: "mock-aci-provider",
    async generate(prompt: string): Promise<IGenerateResult> {
      await Promise.resolve();
      capturedPrompts.push(prompt);
      callCount++;
      const content = callCount === 1
        ? `THOUGHT: continue\n\`\`\`toml\n[[actions]]\ntool = "read_file"\n[actions.params]\npath = "a.ts"\n\`\`\``
        : `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`;
      return {
        content,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      };
    },
  };
  const executor = {
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    parseAgentResponse: (): IChangesetResult => ({
      branch: "feat/test",
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: "Task completed",
      tool_calls: 0,
      execution_time_ms: 0,
    }),
    logGeneration: async () => {
      await Promise.resolve();
    },
    toolRegistry: {
      execute: async () => {
        await Promise.resolve();
        return { success: true, data: "read content" };
      },
      getTools: () => REGISTRY_TOOLS,
      getBaseDir: () => "/nonexistent-test-basedir",
    },
    aciDocsEnabled: true,
    aciDocPromptMaxChars: 12_000,
    logPromptAssembled: async (traceId: string, target: string, payload: IAgentPromptAssembledReactPayload) => {
      await Promise.resolve();
      capturedEvents.push({ traceId, target, payload });
    },
  } as never as IReActLoopExecutor;

  const strategy = new ReActLoopStrategy(executor, provider);
  await strategy.execute(testBlueprint, testContext("trace-repeat-1"), createOptions(["read_file"]));

  assertEquals(capturedPrompts.length, 2, "two provider-bound iterations must occur");
  assertEquals(capturedEvents.length, 2);
  assertEquals(capturedEvents[0].payload.iteration, 0);
  assertEquals(capturedEvents[1].payload.iteration, 1);
  assertEquals(capturedEvents[0].target, "request-aci-1");
  assertEquals(capturedEvents[0].traceId, "trace-repeat-1");
});

Deno.test("[ReActLoopAci] disabled mode emits no agent.prompt_assembled event", async () => {
  const capturedEvents: Array<{ traceId: string; target: string; payload: IAgentPromptAssembledReactPayload }> = [];
  let generateCalls = 0;
  const provider: IModelProvider = {
    id: "mock-aci-provider-disabled",
    async generate(): Promise<IGenerateResult> {
      await Promise.resolve();
      generateCalls++;
      return {
        content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      };
    },
  };
  const executor = {
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    parseAgentResponse: (): IChangesetResult => ({
      branch: "feat/test",
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: "Task completed",
      tool_calls: 0,
      execution_time_ms: 0,
    }),
    logGeneration: async () => {
      await Promise.resolve();
    },
    toolRegistry: {
      execute: () => Promise.resolve({ success: true }),
      getTools: () => REGISTRY_TOOLS,
      getBaseDir: () => "/x",
    },
    aciDocsEnabled: false,
    logPromptAssembled: async (traceId: string, target: string, payload: IAgentPromptAssembledReactPayload) => {
      await Promise.resolve();
      capturedEvents.push({ traceId, target, payload });
    },
  } as never as IReActLoopExecutor;

  await new ReActLoopStrategy(executor, provider).execute(
    testBlueprint,
    testContext("trace-disabled-event-1"),
    createOptions(["read_file"]),
  );

  assertEquals(generateCalls, 1);
  assertEquals(capturedEvents.length, 0, "disabled mode must emit zero agent.prompt_assembled events");
});
