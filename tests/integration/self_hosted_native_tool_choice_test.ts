/**
 * @module SelfHostedNativeToolChoiceTest
 * @path tests/integration/self_hosted_native_tool_choice_test.ts
 * @description Phase 203 Step 6 — proves the `supportsToolChoice` gate end to end against a real
 *   loopback fixture that answers HTTP 400 to any request carrying `tool_choice`. A self-hosted
 *   service that declares no tool-choice support completes both native paths (the ReAct loop and
 *   the dynamic `LlmClient` decision) with no `tool_choice` on the wire, and the same service with
 *   `supports_tool_choice = true` still sends it and fails through the existing provider error path.
 * @architectural-layer Test
 * @related-files [
 *   "packages/execution/src/strategies/react_loop_strategy.ts",
 *   "packages/ai/src/llm_client.ts",
 *   "packages/ai-openai/src/compatible_factory.ts"
 * ]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { ProviderFactory, ProviderRegistry } from "@exaix/ai";
import { LlmClient } from "@exaix/ai/llm_client.ts";
import type { IAgentFileBlueprint } from "@exaix/execution";
import { ReActLoopStrategy } from "@exaix/execution";
import {
  ExecutionStrategyName,
  McpToolName,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  SecurityMode,
} from "@exaix/core";
import type { IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import { ConfigSchema, type IResolvedBinding } from "@exaix/schemas";
import { withEnv } from "@exaix/testing";
import type { ITool } from "@exaix/core/types";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";

const MODEL = "llama3.1:8b";
const AGENT_ROLE = "self-hosted-native-tools-agent";
const SELF_HOSTED_KEY_ENV = "EXA_COMPAT_SELF_HOSTED_API_KEY";
const COMPLETION_CONTENT = `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}fixture done`;

type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

const blueprint: IAgentFileBlueprint = {
  name: AGENT_ROLE,
  model: `openai/${MODEL}`,
  provider: "openai-chat",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "You are a test agent.",
};

const context: IExecutionContext = {
  trace_id: "self-hosted-native-tool-choice-0001",
  request_id: "req-self-hosted-native-tool-choice-1",
  request: "Read one file",
  plan: "Inspect the source",
  portal: "test",
};

const agentRole = {
  agent_role: AGENT_ROLE,
  name: "Self Hosted Reader",
  description: "Reads one file",
  model: `openai/${MODEL}`,
  created: "2026-01-01",
  created_by: "test",
  version: "1.0.0",
  capabilities: [],
};

const readFileTool: ITool = {
  name: McpToolName.READ_FILE,
  description: "Read one file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

/** A tool entry as it appears on the compatible Chat Completions wire. */
interface IWireToolDefinition {
  type?: string;
  function?: { name?: string };
}

/** OpenAI's tool_choice wire shape: a mode string or a forced-tool object. */
type WireToolChoice = string | { type: string; function?: { name?: string } };

/** The parts of a compatible Chat Completions request body this fixture inspects. */
interface IFixtureRequestBody {
  tool_choice?: WireToolChoice;
  tools?: IWireToolDefinition[];
}

interface IToolChoiceFixture {
  endpoint: string;
  /** Every request body the fixture received, in order. */
  bodies: IFixtureRequestBody[];
  shutdown: () => Promise<void>;
}

/** Loopback fixture that rejects any request carrying tool_choice, and records what it got. */
function startToolChoiceFixture(): IToolChoiceFixture {
  const bodies: IFixtureRequestBody[] = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request) => {
    const body = await request.json().catch(() => ({})) as IFixtureRequestBody;
    bodies.push(body);
    if (body.tool_choice !== undefined) {
      return Response.json(
        { error: { type: "invalid_request_error", message: "tool_choice is not supported" } },
        { status: 400 },
      );
    }
    return Response.json({
      model: MODEL,
      choices: [{ message: { role: "assistant", content: COMPLETION_CONTENT }, finish_reason: "stop" }],
      usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
    });
  });
  const port = (server.addr as Deno.NetAddr).port;
  return {
    endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
    bodies,
    shutdown: () => server.shutdown(),
  };
}

/** Builds the provider from a self-hosted binding, exactly as the scenario runner does. */
async function providerFromBinding(endpoint: string, supportsToolChoice: boolean): Promise<IModelProvider> {
  const config = ConfigSchema.parse({ system: {}, paths: {}, ai: { provider: "mock", model: "boot-model" } });
  const binding: IResolvedBinding = {
    service: "local-gpu",
    model_provider: "openai",
    model: `openai/${MODEL}`,
    service_model_id: MODEL,
    transport: "local",
    interface: "api",
    adapter: "openai-chat",
    profile: "self-hosted",
    endpoint,
    allow_insecure_loopback: true,
    supports_tool_choice: supportsToolChoice,
    sources: {},
    fingerprint: "c".repeat(64),
  };
  return await ProviderFactory.createFromBinding(config, binding);
}

function makeExecutor(): ReActExecutor {
  return {
    logAgentOutput: () => Promise.resolve(),
    validateReviewResult: (result: IChangesetResult) => result,
    parseAgentResponse: (_response: string, ctx: IExecutionContext, startedAt: number): IChangesetResult => ({
      branch: "feat/test",
      commit_sha: "0".repeat(40),
      files_changed: [],
      description: ctx.plan,
      tool_calls: 0,
      execution_time_ms: Date.now() - startedAt,
    }),
    logGeneration: () => Promise.resolve(),
    toolRegistry: {
      execute: () => Promise.resolve({ success: true, data: {} }),
      getTools: () => [readFileTool],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };
}

/** Native path A: the ReAct loop's native generate options. */
async function runReActPath(provider: IModelProvider): Promise<void> {
  const strategy = new ReActLoopStrategy(makeExecutor(), provider);
  await strategy.execute(blueprint, context, {
    agent_role: AGENT_ROLE,
    portal: "test",
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 30_000,
    max_tool_calls: 5,
    audit_enabled: false,
    native_tools_enabled: true,
    permitted_tools: [McpToolName.READ_FILE],
  });
}

/** Native path B: the dynamic client's native decision. */
async function runDynamicPath(provider: IModelProvider): Promise<void> {
  const client = new LlmClient(undefined, provider);
  const tools = [{ name: McpToolName.READ_FILE, description: "Read one file", inputSchema: { type: "object" } }];
  const nativeConversation = await client.createNativeConversation({
    agentRole,
    stepObjective: "Inspect the source",
    originalInput: "Start with src/a.ts",
    availableTools: tools,
  });
  const decision = await client.reasonNextAction({
    agent_role: agentRole,
    stepObjective: "Inspect the source",
    accumulatedContext: "Start with src/a.ts",
    availableTools: tools,
    iteration: 1,
    maxIterations: 2,
    nativeToolsEnabled: true,
    nativeConversation,
  });
  assertEquals(decision.done, true);
  assertStringIncludes(decision.output ?? "", REACT_SUMMARY_PREFIX);
}

Deno.test("[phase203.e2e] a self-hosted service without tool-choice support completes both native paths", async () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();
  const fixture = startToolChoiceFixture();
  try {
    await withEnv({ [SELF_HOSTED_KEY_ENV]: null }, async () => {
      const provider = await providerFromBinding(fixture.endpoint, false);
      assertEquals(provider.callCapabilities?.supportsToolChoice, false);

      await runReActPath(provider);
      assertEquals(fixture.bodies.length > 0, true);

      await runDynamicPath(provider);

      assertEquals(fixture.bodies.every((body) => body.tool_choice === undefined), true);
      assertEquals(fixture.bodies.every((body) => Array.isArray(body.tools)), true);
    });
  } finally {
    await fixture.shutdown();
  }
});

Deno.test("[phase203.e2e] a self-hosted service that declares tool-choice support still sends it and fails", async () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();
  const fixture = startToolChoiceFixture();
  try {
    await withEnv({ [SELF_HOSTED_KEY_ENV]: null }, async () => {
      const provider = await providerFromBinding(fixture.endpoint, true);
      assertEquals("supportsToolChoice" in (provider.callCapabilities ?? {}), false);

      await assertRejects(() => runReActPath(provider));
      assertEquals(fixture.bodies.length > 0, true);

      const afterReAct = fixture.bodies.length;
      await assertRejects(() => runDynamicPath(provider));
      assertEquals(fixture.bodies.length > afterReAct, true);

      assertEquals(fixture.bodies.every((body) => body.tool_choice !== undefined), true);
    });
  } finally {
    await fixture.shutdown();
  }
});
