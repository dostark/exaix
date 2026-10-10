/**
 * @module NativeToolRoundSecurityTest
 * @path packages/execution/tests/native_tool_round_security_test.ts
 * @description Security tests for the native tool-round bounds in PlanningToolLoop. A response that
 *   exceeds the resolved response ceiling, carries an oversized argument, or repeats or omits a call id
 *   executes no tool, even when a valid sibling call is present. A replayable invalid argument gets an
 *   error outcome for every call, and only the valid calls execute.
 * @architectural-layer Test
 * @related-files [packages/execution/src/planning_tool_loop.ts, packages/execution/src/native_tool_turns.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { PlanningToolLoop } from "../src/planning_tool_loop.ts";
import type { IPlanningToolLoopDeps, IPlanningToolLoopOptions } from "../src/planning_tool_loop.ts";
import type { ICallSite, IModelOptions, IProviderAssistantReplay } from "@exaix/ai/types.ts";
import type { IGenerateResult, IProviderToolCall } from "@exaix/ai/providers";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { ProviderProtocolError } from "@exaix/ai/errors.ts";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import { PricingTier, ProviderCostTier, ToolsRoundMode } from "@exaix/core";
import type { IToolsRoundPolicy } from "@exaix/schemas";

const GROUPED_PROVIDER_ID = "native-round-security-grouped";

/** A real portal: the confinement guard resolves each path, so the files must exist. */
const PORTAL_ROOT = Deno.makeTempDirSync({ prefix: "native-round-security-" });
for (const name of ["a.ts", "b.ts", "c.ts"]) Deno.writeTextFileSync(`${PORTAL_ROOT}/${name}`, "export {};\n");
globalThis.addEventListener("unload", () => Deno.removeSync(PORTAL_ROOT, { recursive: true }));

class RecordingRegistry implements IToolRegistry {
  calls: Array<{ name: string; params: Record<string, JSONValue> }> = [];
  getTools(): ITool[] {
    return [{ name: "read_file", description: "Read", parameters: { type: "object", properties: {} } }];
  }
  execute(name: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    this.calls.push({ name, params });
    return Promise.resolve({ success: true, data: { ok: true } });
  }
  getBaseDir(): string {
    return "/tmp/native-round-security";
  }
}

const TOKENIZER = {
  countTokens: (text: string) => Promise.resolve(Math.ceil(text.length / 4)),
  countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((t) => Math.ceil(t.length / 4))),
};

function policy(overrides: Partial<IToolsRoundPolicy> = {}): IToolsRoundPolicy {
  return {
    mode: ToolsRoundMode.AUTO,
    executionCap: 10,
    concurrency: 4,
    maxResponseCalls: 64,
    maxArgumentBytes: 65536,
    maxReplayBytes: 1048576,
    resultTokenCap: 2000,
    ...overrides,
  };
}

function readCall(id: string, path: string): IProviderToolCall {
  return { id, name: "read_file", input: { path } };
}

/** The OpenAI-family carrier a compatible provider returns for these calls, arguments as sent. */
function carrier(calls: Array<{ id: string; args: string }>): IProviderAssistantReplay {
  return {
    provider: "openai-chat",
    assistantContent: null,
    toolCalls: calls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: "read_file", arguments: call.args },
    })),
  };
}

function response(toolCalls: IProviderToolCall[], nativeAssistantReplay?: IProviderAssistantReplay): IGenerateResult {
  return {
    content: "",
    toolCalls,
    ...(nativeAssistantReplay ? { nativeAssistantReplay } : {}),
    usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
    model: "security-model",
    provider: GROUPED_PROVIDER_ID,
  };
}

class ScriptedGenerate {
  calls: Array<{ prompt: string; options: IModelOptions }> = [];
  private index = 0;
  constructor(private readonly responses: IGenerateResult[]) {}
  generate = (prompt: string, options: IModelOptions): Promise<IGenerateResult> => {
    this.calls.push({ prompt, options });
    const next = this.responses[this.index++];
    if (!next) throw new Error(`no scripted response for call ${this.index}`);
    return Promise.resolve(next);
  };
}

function loop(
  generate: ScriptedGenerate,
  registry: RecordingRegistry,
  toolsRoundPolicy: IToolsRoundPolicy,
  providerId?: string,
) {
  const deps: IPlanningToolLoopDeps = {
    toolRegistry: registry,
    tokenizer: TOKENIZER,
    modelId: "security-model",
    generate: generate.generate,
    toolsRoundPolicy: () => toolsRoundPolicy,
    ...(providerId ? { providerId } : {}),
  };
  return new PlanningToolLoop(deps);
}

function options(): IPlanningToolLoopOptions {
  return {
    prompt: "Plan the change.",
    baseOptions: {},
    nextCallSite: (): ICallSite | undefined => undefined,
    portalAlias: "security",
    portalRoot: PORTAL_ROOT,
    allowedTools: new Set(["read_file"]),
    maxRounds: 2,
    maxToolResultTokens: 2000,
    maxToolCallsPerRound: 10,
    traceId: "trace-native-round-security",
  };
}

function registerGroupedProvider(): void {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata(GROUPED_PROVIDER_ID, new MockProviderFactory(), {
    name: GROUPED_PROVIDER_ID,
    description: "Grouped-replay security fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsNativeConversation: true,
    supportsParallelToolReplay: true,
    chatFormat: "openai",
  });
}

Deno.test("[security] a response over the response ceiling executes no tool, without a grouped provider", async () => {
  const registry = new RecordingRegistry();
  const generate = new ScriptedGenerate([
    response([readCall("a", "a.ts"), readCall("b", "b.ts"), readCall("c", "c.ts")]),
  ]);
  await assertRejects(
    () => loop(generate, registry, policy({ maxResponseCalls: 2 })).run(options()),
    ProviderProtocolError,
  );
  assertEquals(registry.calls.length, 0);
});

Deno.test("[security] a call over the argument byte ceiling executes no tool, without a grouped provider", async () => {
  const registry = new RecordingRegistry();
  const huge = "x".repeat(2000);
  const generate = new ScriptedGenerate([response([readCall("a", "a.ts"), readCall("b", huge)])]);
  await assertRejects(
    () => loop(generate, registry, policy({ maxArgumentBytes: 1024 })).run(options()),
    ProviderProtocolError,
  );
  assertEquals(registry.calls.length, 0);
});

Deno.test("[security] a grouped round over the response ceiling executes no tool, though the calls are valid", async () => {
  registerGroupedProvider();
  const registry = new RecordingRegistry();
  const calls = [readCall("a", "a.ts"), readCall("b", "b.ts"), readCall("c", "c.ts")];
  const generate = new ScriptedGenerate([
    response(calls, carrier(calls.map((call) => ({ id: call.id, args: JSON.stringify(call.input) })))),
  ]);
  await assertRejects(
    () => loop(generate, registry, policy({ maxResponseCalls: 2 }), GROUPED_PROVIDER_ID).run(options()),
    ProviderProtocolError,
  );
  assertEquals(registry.calls.length, 0);
});

Deno.test("[security] a grouped round with a huge argument executes no tool, though a sibling is valid", async () => {
  registerGroupedProvider();
  const registry = new RecordingRegistry();
  const calls = [readCall("a", "a.ts"), readCall("b", "x".repeat(2000))];
  const generate = new ScriptedGenerate([
    response(calls, carrier(calls.map((call) => ({ id: call.id, args: JSON.stringify(call.input) })))),
  ]);
  await assertRejects(
    () => loop(generate, registry, policy({ maxArgumentBytes: 1024 }), GROUPED_PROVIDER_ID).run(options()),
    ProviderProtocolError,
  );
  assertEquals(registry.calls.length, 0);
});

Deno.test("[security] a grouped round with a duplicate call id executes no tool, though a sibling is valid", async () => {
  registerGroupedProvider();
  const registry = new RecordingRegistry();
  const calls = [readCall("dup", "a.ts"), readCall("dup", "b.ts")];
  const generate = new ScriptedGenerate([
    response(calls, carrier(calls.map((call) => ({ id: call.id, args: JSON.stringify(call.input) })))),
  ]);
  await assertRejects(
    () => loop(generate, registry, policy(), GROUPED_PROVIDER_ID).run(options()),
    ProviderProtocolError,
  );
  assertEquals(registry.calls.length, 0);
});

Deno.test("[security] a grouped round with an empty call id executes no tool, though a sibling is valid", async () => {
  registerGroupedProvider();
  const registry = new RecordingRegistry();
  const calls = [readCall("", "a.ts"), readCall("b", "b.ts")];
  const generate = new ScriptedGenerate([
    response(calls, carrier(calls.map((call) => ({ id: call.id, args: JSON.stringify(call.input) })))),
  ]);
  await assertRejects(
    () => loop(generate, registry, policy(), GROUPED_PROVIDER_ID).run(options()),
    ProviderProtocolError,
  );
  assertEquals(registry.calls.length, 0);
});

Deno.test("[security] a replayable invalid argument gets an error outcome, and only the valid call executes", async () => {
  registerGroupedProvider();
  const registry = new RecordingRegistry();
  const valid = readCall("ok", "a.ts");
  const malformed: IProviderToolCall = { id: "bad", name: "read_file", input: {}, rawArguments: "{not json" };
  const generate = new ScriptedGenerate([
    response(
      [valid, malformed],
      carrier([
        { id: "ok", args: JSON.stringify(valid.input) },
        { id: "bad", args: "{not json" },
      ]),
    ),
    response([], undefined),
  ]);
  await loop(generate, registry, policy(), GROUPED_PROVIDER_ID).run(options());

  assertEquals(registry.calls.length, 1);
  const replayed = generate.calls[1].options.nativeConversation?.rounds ?? [];
  assertEquals(replayed.length, 1);
  assertEquals(replayed[0].calls.map((entry) => [entry.toolUseId, entry.toolResultIsError]), [
    ["ok", false],
    ["bad", true],
  ]);
});

Deno.test("[security] a response with thousands of calls executes nothing, grouped or not", async () => {
  const many = Array.from({ length: 3000 }, (_, index) => readCall(`call-${index}`, "a.ts"));
  registerGroupedProvider();

  const legacy = new RecordingRegistry();
  await assertRejects(
    () => loop(new ScriptedGenerate([response(many)]), legacy, policy({ maxResponseCalls: 64 })).run(options()),
    ProviderProtocolError,
  );
  assertEquals(legacy.calls.length, 0);

  const grouped = new RecordingRegistry();
  await assertRejects(
    () =>
      loop(
        new ScriptedGenerate([
          response(many, carrier(many.map((call) => ({ id: call.id, args: JSON.stringify(call.input) })))),
        ]),
        grouped,
        policy({ maxResponseCalls: 64 }),
        GROUPED_PROVIDER_ID,
      ).run(options()),
    ProviderProtocolError,
  );
  assertEquals(grouped.calls.length, 0);
});
