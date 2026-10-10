/**
 * @module NativeToolRoundProviderTest
 * @path tests/integration/native_tool_round_provider_test.ts
 * @description Drives the registered Google provider through the real
 *   PlanningToolLoop. A stubbed transport returns a two-call Gemini response with signed parts,
 *   then records the follow-up request. The next request must replay every original model part
 *   and one functionResponse per call, in order. The boot metadata flag is read from
 *   bootstrapProviderRegistry(), not from a hand-built fixture.
 * @architectural-layer Test
 * @related-files [
 *   "packages/execution/src/planning_tool_loop.ts",
 *   "packages/ai-google/src/google_provider.ts",
 *   "apps/common/registry_bootstrap.ts"
 * ]
 */

import { assertEquals } from "@std/assert";
import { PlanningToolLoop } from "@exaix/execution";
import { GoogleProvider } from "@exaix/ai-google";
import { AnthropicProvider, PROVIDER_ANTHROPIC } from "@exaix/ai-anthropic";
import { NATIVE_NO_TOOLS_TEXT_INSTRUCTION } from "@exaix/ai/provider_common_utils.ts";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import { PROVIDER_GOOGLE } from "@exaix/ai-google";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";

const FIXTURE_PORTAL_ROOT = Deno.makeTempDirSync({ prefix: "native-tool-round-provider-" });

const READ_FILE_TOOL: ITool = {
  name: "read_file",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } } },
};

const SIGNED_ROUND_PARTS: Array<Record<string, JSONValue>> = [
  { functionCall: { name: "read_file", args: { path: "a.ts" } }, thoughtSignature: "sig-a" },
  { functionCall: { name: "read_file", args: { path: "b.ts" } } },
];

class RecordingToolRegistry implements IToolRegistry {
  public calls: string[] = [];
  getTools(): ITool[] {
    return [READ_FILE_TOOL];
  }
  execute(toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    this.calls.push(`${toolName}:${String(params.path)}`);
    return Promise.resolve({ success: true, data: { content: `BODY-${String(params.path)}` } });
  }
  getBaseDir(): string {
    return FIXTURE_PORTAL_ROOT;
  }
}

interface IGeminiContent {
  role: string;
  parts: Array<Record<string, JSONValue>>;
}

interface IGeminiRequest {
  contents: IGeminiContent[];
}

/** Serves scripted provider bodies in order and records each request body as TRequest. */
function scriptedFetch<TRequest>(
  bodies: Array<Record<string, JSONValue>>,
): { requests: TRequest[]; restore: () => void } {
  const captured: TRequest[] = [];
  const original = globalThis.fetch;
  let index = 0;
  globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
    captured.push(JSON.parse((init?.body as string) ?? "{}") as TRequest);
    const body = bodies[index++];
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return { requests: captured, restore: () => void (globalThis.fetch = original) };
}

Deno.test("[native_tool_round][google] the registered Google provider replays a signed two-call planning round in order", async () => {
  bootstrapProviderRegistry();
  const scripted = scriptedFetch<IGeminiRequest>([
    {
      candidates: [{ content: { parts: SIGNED_ROUND_PARTS } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    },
    {
      candidates: [{ content: { parts: [{ text: "plan" }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    },
  ]);
  try {
    assertEquals(
      ProviderRegistry.getMetadataForInstance(PROVIDER_GOOGLE)?.supportsParallelToolReplay,
      true,
      "boot registration must declare grouped replay for google",
    );
    const provider = new GoogleProvider({ apiKey: "test-key" });
    const registry = new RecordingToolRegistry();
    const loop = new PlanningToolLoop({
      toolRegistry: registry,
      tokenizer: {
        countTokens: (t: string) => Promise.resolve(Math.ceil(t.length / 4)),
        countTokensBatch: (ts: string[]) => Promise.resolve(ts.map((t) => Math.ceil(t.length / 4))),
      },
      modelId: "gemini-test",
      providerId: PROVIDER_GOOGLE,
      generate: (prompt: string, options: IModelOptions): Promise<IGenerateResult> =>
        provider.generate(prompt, options),
    });

    const result = await loop.run({
      prompt: "Plan the change.",
      baseOptions: {},
      nextCallSite: () => ({ scenarioId: "s", stepId: "t", callIndex: 0 }),
      portalAlias: "fixture",
      portalRoot: FIXTURE_PORTAL_ROOT,
      allowedTools: new Set(["read_file"]),
      maxRounds: 2,
      maxToolResultTokens: 2000,
      maxToolCallsPerRound: 10,
      traceId: "trace-native-round-google",
    });

    assertEquals(registry.calls, ["read_file:@fixture/a.ts", "read_file:@fixture/b.ts"]);
    assertEquals(scripted.requests.length, 2);
    const contents = scripted.requests[1].contents;
    assertEquals(contents[1].parts, SIGNED_ROUND_PARTS, "every original model part must replay verbatim");
    const responses = contents[2].parts.filter((part) => part.functionResponse !== undefined);
    assertEquals(responses.length, 2, "one functionResponse per call, grouped in one user message");
    assertEquals(result.final.content, "plan");
  } finally {
    scripted.restore();
    ProviderRegistry.clear();
  }
});

const ANTHROPIC_ROUND_CONTENT: Array<Record<string, JSONValue>> = [
  { type: "thinking", thinking: "Read both files first.", signature: "sig-thinking" },
  { type: "text", text: "I will read both files." },
  { type: "tool_use", id: "toolu_a", name: "read_file", input: { path: "a.ts" } },
  { type: "tool_use", id: "toolu_b", name: "read_file", input: { path: "b.ts" } },
];

interface IAnthropicMessage {
  role: string;
  content: JSONValue;
}

interface IAnthropicRequest {
  messages: IAnthropicMessage[];
  tool_choice?: JSONValue;
}

Deno.test("[native_tool_round][anthropic] the registered Anthropic provider replays a two-call planning round whole", async () => {
  bootstrapProviderRegistry();
  const scripted = scriptedFetch<IAnthropicRequest>([
    { content: ANTHROPIC_ROUND_CONTENT, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } },
    {
      content: [{ type: "text", text: "plan" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  ]);
  try {
    assertEquals(
      ProviderRegistry.getMetadataForInstance(PROVIDER_ANTHROPIC)?.supportsParallelToolReplay,
      true,
      "boot registration must declare grouped replay for anthropic",
    );
    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const registry = new RecordingToolRegistry();
    const loop = new PlanningToolLoop({
      toolRegistry: registry,
      tokenizer: {
        countTokens: (t: string) => Promise.resolve(Math.ceil(t.length / 4)),
        countTokensBatch: (ts: string[]) => Promise.resolve(ts.map((t) => Math.ceil(t.length / 4))),
      },
      modelId: "claude-test",
      providerId: PROVIDER_ANTHROPIC,
      generate: (prompt: string, options: IModelOptions): Promise<IGenerateResult> =>
        provider.generate(prompt, options),
    });

    const result = await loop.run({
      prompt: "Plan the change.",
      baseOptions: {},
      nextCallSite: () => ({ scenarioId: "s", stepId: "t", callIndex: 0 }),
      portalAlias: "fixture",
      portalRoot: FIXTURE_PORTAL_ROOT,
      allowedTools: new Set(["read_file"]),
      maxRounds: 2,
      maxToolResultTokens: 2000,
      maxToolCallsPerRound: 10,
      traceId: "trace-native-round-anthropic",
    });

    assertEquals(registry.calls, ["read_file:@fixture/a.ts", "read_file:@fixture/b.ts"]);
    assertEquals(scripted.requests.length, 2);
    const messages = scripted.requests[1].messages;
    assertEquals(messages[1].content, ANTHROPIC_ROUND_CONTENT, "every original block must replay verbatim");
    const blocks = messages[2].content as Array<Record<string, JSONValue>>;
    assertEquals(
      blocks.map((block) => block.type),
      ["tool_result", "tool_result", "text"],
      "one tool_result per call, all before the final round's control text, in one user message",
    );
    assertEquals(blocks.slice(0, 2).map((block) => block.tool_use_id), ["toolu_a", "toolu_b"]);
    assertEquals(result.final.content, "plan");
  } finally {
    scripted.restore();
    ProviderRegistry.clear();
  }
});

/** Runs the registered Anthropic provider through the planning loop with a scripted two-response transport. */
async function runAnthropicPlanning(
  responses: Array<Record<string, JSONValue>>,
  baseOptions: IModelOptions,
  maxRounds: number,
): Promise<{ registry: RecordingToolRegistry; requests: IAnthropicRequest[] }> {
  bootstrapProviderRegistry();
  const scripted = scriptedFetch<IAnthropicRequest>(responses);
  try {
    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const registry = new RecordingToolRegistry();
    const loop = new PlanningToolLoop({
      toolRegistry: registry,
      tokenizer: {
        countTokens: (t: string) => Promise.resolve(Math.ceil(t.length / 4)),
        countTokensBatch: (ts: string[]) => Promise.resolve(ts.map((t) => Math.ceil(t.length / 4))),
      },
      modelId: "claude-test",
      providerId: PROVIDER_ANTHROPIC,
      generate: (prompt: string, options: IModelOptions): Promise<IGenerateResult> =>
        provider.generate(prompt, options),
    });
    await loop.run({
      prompt: "Plan the change.",
      baseOptions,
      nextCallSite: () => ({ scenarioId: "s", stepId: "t", callIndex: 0 }),
      portalAlias: "fixture",
      portalRoot: FIXTURE_PORTAL_ROOT,
      allowedTools: new Set(["read_file"]),
      maxRounds,
      maxToolResultTokens: 2000,
      maxToolCallsPerRound: 10,
      traceId: "trace-native-round-anthropic-variant",
    });
    return { registry, requests: scripted.requests };
  } finally {
    scripted.restore();
    ProviderRegistry.clear();
  }
}

const ANTHROPIC_TEXT_RESPONSE = {
  content: [{ type: "text", text: "plan" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

Deno.test("[native_tool_round][anthropic] an alias call replays under the model's original name and input", async () => {
  const aliasRound = [
    { type: "text", text: "I will read both files." },
    { type: "tool_use", id: "toolu_a", name: "read_file", input: { path: "a.ts" } },
    { type: "tool_use", id: "toolu_b", name: "Read", input: { file_path: "b.ts" } },
  ];
  const { registry, requests } = await runAnthropicPlanning(
    [
      { content: aliasRound, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } },
      ANTHROPIC_TEXT_RESPONSE,
    ],
    {},
    2,
  );

  assertEquals(registry.calls, ["read_file:@fixture/a.ts", "read_file:@fixture/b.ts"]);
  assertEquals(requests[1].messages[1].content, aliasRound, "the alias name and input replay as the model sent them");
});

Deno.test("[native_tool_round][anthropic] a one-call round keeps the original policy and replays an exact golden follow-up", async () => {
  const oneCallRound = [
    { type: "thinking", thinking: "Read the file.", signature: "sig-thinking" },
    { type: "tool_use", id: "toolu_a", name: "read_file", input: { path: "a.ts" } },
  ];
  const policy = { toolChoice: { type: "auto" as const, disable_parallel_tool_use: true } };
  const { requests } = await runAnthropicPlanning(
    [
      { content: oneCallRound, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } },
      ANTHROPIC_TEXT_RESPONSE,
    ],
    policy,
    2,
  );

  assertEquals(
    requests[0].tool_choice,
    { type: "auto", disable_parallel_tool_use: true },
    "the first request keeps the policy",
  );
  const [prompt, ...replayed] = requests[1].messages;
  assertEquals(prompt.role, "user", "the prompt leads the follow-up");
  assertEquals(replayed, [
    { role: "assistant", content: oneCallRound },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_a", content: '{"content":"BODY-@fixture/a.ts"}', is_error: false },
        { type: "text", text: NATIVE_NO_TOOLS_TEXT_INSTRUCTION },
      ],
    },
  ]);
});
