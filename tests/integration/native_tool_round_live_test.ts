/**
 * @module NativeToolRoundLiveTest
 * @path tests/integration/native_tool_round_live_test.ts
 * @description Live qualification of the openai-chat grouped replay against the DeepSeek API by default.
 *   Binds the provider through the phase-204 catalog (EXA_TEST_BIND, default the DeepSeek preset). Three cases
 *   run against the real provider. The round case runs the real PlanningToolLoop over three distinct files that
 *   each carry a random marker, and the follow-up content must contain every marker. The thinking case replays
 *   DeepSeek's reasoning with its tool calls. The call case checks that a live response passes the compatible
 *   contract. Opt-in only: without EXA_TEST_ENABLE_PAID_LLM=1 and the bound service's key a case is reported as
 *   ignored (NOT RUN) and never counts as a pass.
 * @architectural-layer Test
 * @related-files [
 *   "tests/integration/native_tool_round_provider_test.ts",
 *   "tests/helpers/llm_bindings.ts",
 *   "packages/ai-openai/src/compatible_chat.ts",
 *   "packages/execution/src/planning_tool_loop.ts"
 * ]
 */

import { assert, assertEquals } from "@std/assert";
import { PlanningToolLoop } from "@exaix/execution";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";
import { createLlmProvider, liveReplayLlmSpec, llmKeyPresent } from "../helpers/llm_bindings.ts";

const LIVE_FILES = ["a.txt", "b.txt", "c.txt"] as const;
const PAID_OPT_IN_ENV = "EXA_TEST_ENABLE_PAID_LLM";
const DEEPSEEK_SERVICE = "deepseek";
const ANTHROPIC_SERVICE = "anthropic";
/** A prompt that makes Claude Haiku 5.5 think before its three reads: adaptive thinking decides per request. */
const THINKING_PROMPT =
  "Three files a.txt, b.txt and c.txt each hold one number. Work out whether the product of the numbers in a.txt and b.txt, modulo the number in c.txt, equals 1, and why. Then read all three with read_file in this one response, and report the marker in each file.";
const PORTAL_ALIAS = "live";

const liveSpec = liveReplayLlmSpec();
const liveEnabled = Deno.env.get(PAID_OPT_IN_ENV) === "1" && llmKeyPresent(liveSpec);
const liveName = liveSpec.service ?? "unbound";

const READ_FILE_TOOL: ITool = {
  name: "read_file",
  description: "Read a file inside the portal",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

/** Serves real file bodies from the temporary portal. The marker is reachable only by reading. */
class PortalFileRegistry implements IToolRegistry {
  constructor(private readonly root: string) {}
  getTools(): ITool[] {
    return [READ_FILE_TOOL];
  }
  async execute(_toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    // The loop enriches a relative path with the portal alias, so the registry strips it again.
    const relative = String(params.path).replace(`@${PORTAL_ALIAS}/`, "");
    const body = await Deno.readTextFile(`${this.root}/${relative}`);
    return { success: true, data: { content: body } };
  }
  getBaseDir(): string {
    return this.root;
  }
}

/** A round's prompt and an observer of each provider response. Both are optional. */
interface IRoundObservation {
  prompt?: string;
  observe?: (result: IGenerateResult, options: IModelOptions) => void;
}

/** Runs the three-file round through the real planning loop. The base options carry only what the case sets. */
async function runThreeFileRound(baseOptions: IModelOptions, round: IRoundObservation = {}): Promise<void> {
  bootstrapProviderRegistry();
  const root = Deno.makeTempDirSync({ prefix: "native-tool-round-live-" });
  const markers = LIVE_FILES.map((file) => {
    const marker = `MARK-${crypto.randomUUID().slice(0, 8)}`;
    Deno.writeTextFileSync(`${root}/${file}`, `secret for ${file}: ${marker}\n`);
    return marker;
  });
  try {
    const { binding, provider } = await createLlmProvider(liveSpec);
    assert(
      ProviderRegistry.getMetadataForInstance(provider.id)?.supportsParallelToolReplay === true,
      `${binding.service} declares no grouped replay at boot; choose a grouped-replay service in EXA_TEST_BIND`,
    );
    const loop = new PlanningToolLoop({
      toolRegistry: new PortalFileRegistry(root),
      tokenizer: {
        countTokens: (t: string) => Promise.resolve(Math.ceil(t.length / 4)),
        countTokensBatch: (ts: string[]) => Promise.resolve(ts.map((t) => Math.ceil(t.length / 4))),
      },
      modelId: binding.service_model_id,
      providerId: provider.id,
      generate: async (prompt: string, options: IModelOptions): Promise<IGenerateResult> => {
        const result = await provider.generate(prompt, options);
        round.observe?.(result, options);
        return result;
      },
    });
    const result = await loop.run({
      prompt: round.prompt ??
        `Read files ${LIVE_FILES.join(", ")} with read_file, then reply with the three secret markers.`,
      baseOptions,
      nextCallSite: () => ({ scenarioId: "live-native-round", stepId: "replay", callIndex: 0 }),
      portalAlias: PORTAL_ALIAS,
      portalRoot: root,
      allowedTools: new Set(["read_file"]),
      maxRounds: 3,
      maxToolResultTokens: 2000,
      maxToolCallsPerRound: 10,
      traceId: "trace-live-native-round",
    });
    const outcome = `after ${result.rounds} rounds, ${result.toolCalls} tool calls, stop ${result.stopReason}; ` +
      `final answer: ${JSON.stringify(result.final.content)}`;
    for (const marker of markers) assert(result.final.content.includes(marker), `missing marker ${marker} ${outcome}`);
    assertEquals(result.toolCalls >= LIVE_FILES.length, true, outcome);
  } finally {
    ProviderRegistry.clear();
    Deno.removeSync(root, { recursive: true });
  }
}

Deno.test({
  name: `[native_tool_round][live] the bound provider replays three reads and answers with every marker (${liveName})`,
  ignore: !liveEnabled,
  fn: () => runThreeFileRound({}),
});

Deno.test({
  name:
    `[native_tool_round][live] thinking mode replays its reasoning with the tool calls and answers with every marker (${liveName})`,
  ignore: !liveEnabled || liveSpec.service !== DEEPSEEK_SERVICE,
  fn: () => runThreeFileRound({ thinking: true }),
});

Deno.test({
  name: `[native_tool_round][live] a tool-enabled call returns a call the compatible contract accepts (${liveName})`,
  ignore: !liveEnabled,
  fn: async () => {
    bootstrapProviderRegistry();
    try {
      const { provider } = await createLlmProvider(liveSpec);
      const result = await provider.generate("Read the file a.txt with read_file before you answer.", {
        tools: [{
          name: READ_FILE_TOOL.name,
          description: READ_FILE_TOOL.description,
          inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        }],
        toolChoice: { type: "auto", disable_parallel_tool_use: true },
      });
      const call = result.toolCalls?.[0];
      assertEquals(call?.name, "read_file");
      assert(typeof call?.input.path === "string", "the call must carry a string path");
      assert(result.usage.promptTokens > 0 && result.usage.completionTokens > 0, "usage must be reported");
    } finally {
      ProviderRegistry.clear();
    }
  },
});

Deno.test({
  name:
    `[native_tool_round][live] Anthropic returns signed thinking blocks with its tool calls, and the follow-up carries them back (${liveName})`,
  ignore: !liveEnabled || liveSpec.service !== ANTHROPIC_SERVICE,
  fn: async () => {
    const responses: IGenerateResult[] = [];
    const replayedSigned: number[] = [];
    await runThreeFileRound({}, {
      prompt: THINKING_PROMPT,
      observe: (result, options) => {
        responses.push(result);
        const assistant = options.priorRound?.assistant;
        if (assistant?.provider === "anthropic") {
          replayedSigned.push(
            assistant.blocks.filter((block) =>
              block.type === "thinking" && typeof block.signature === "string" && block.signature.length > 0
            ).length,
          );
        }
      },
    });
    const returned = responses
      .flatMap((result) => result.toolCalls ?? [])
      .flatMap((call) => call.thinkingBlocks ?? [])
      .filter((block) => block.signature.length > 0);
    assert(returned.length > 0, "no signed thinking block came back with a tool call, so replay was not exercised");
    assert(
      replayedSigned.some((count) => count > 0),
      "the follow-up request carried no signed thinking block; the replay dropped it",
    );
  },
});
