/**
 * @module NativeToolRoundProviderTest
 * @path tests/integration/native_tool_round_provider_test.ts
 * @description Parametrized by provider and model. Every preset runs the same round contract through the
 *   registered provider: the planning loop binds the provider from the phase-204 catalog, a scripted transport
 *   answers in that provider's wire family, and the follow-up request must replay the assistant turn verbatim
 *   and one result per call in order. A preset that refuses unadvertised names must refuse an alias call instead.
 *   A local compatible fixture drives the registered openai-chat loop over real loopback HTTP.
 * @architectural-layer Test
 * @related-files [
 *   "tests/helpers/llm_bindings.ts",
 *   "tests/helpers/native_tool_round_harness.ts",
 *   "packages/execution/src/planning_tool_loop.ts"
 * ]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { type JSONValue, ProviderType, ToolsRoundMode } from "@exaix/core";
import type { IToolsRoundPolicy } from "@exaix/schemas";
import type { JSONObject } from "@exaix/ai/types.ts";
import { type IPromptBudget, PromptBudgetSection } from "@exaix/schemas/prompt_budget.ts";
import { OpenAICompatibleProviderFactory } from "@exaix/ai-openai/src/compatible_factory.ts";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";
import { createLlmProvider, LLM_TEST_PRESETS, llmKeyEnv, resolveLlmBinding } from "../helpers/llm_bindings.ts";
import {
  type IWireCall,
  type IWireRequest,
  runBoundRound,
  runPlanningRound,
  wireFamilyFor,
} from "../helpers/native_tool_round_harness.ts";

/** The parallel-call flags a captured request carries: a top-level field, and a tool choice's disable flag. */
interface IWireFlags {
  topLevel: JSONValue | undefined;
  disable: JSONValue | undefined;
}

const NO_WIRE_FLAGS: IWireFlags = { topLevel: undefined, disable: undefined };

/** The flags the off policy puts on the exploration request, per provider preset. Gemini and DeepSeek
 *  have no parallel field, so the loop's local enforcement is their only control. */
const OFF_EXPLORATION_FLAGS: Record<string, IWireFlags> = {
  google: NO_WIRE_FLAGS,
  anthropic: { topLevel: undefined, disable: true },
  openai: { topLevel: false, disable: undefined },
  openrouter: { topLevel: false, disable: undefined },
  deepseek: NO_WIRE_FLAGS,
};

/** The flags one captured request carries on the wire, read from its parsed body. */
function wireFlagsOf(request: IWireRequest): IWireFlags {
  const body: JSONObject = JSON.parse(JSON.stringify(request));
  const choice = body.tool_choice;
  const disable = typeof choice === "object" && choice !== null && !Array.isArray(choice)
    ? choice.disable_parallel_tool_use
    : undefined;
  return { topLevel: body.parallel_tool_calls, disable };
}

/** A round policy for one mode, with the caps the grouped loop reads. */
function roundPolicy(mode: ToolsRoundMode, executionCap: number): IToolsRoundPolicy {
  return {
    mode,
    executionCap,
    concurrency: 1,
    maxResponseCalls: 64,
    maxArgumentBytes: 65536,
    maxReplayBytes: 1048576,
    resultTokenCap: 2000,
  };
}

const TWO_CALLS: IWireCall[] = [
  { id: "toolu_a", name: "read_file", input: { path: "a.ts" } },
  { id: "toolu_b", name: "read_file", input: { path: "b.ts" } },
];
const ONE_CALL: IWireCall[] = [TWO_CALLS[0]!];
const ALIAS_CALLS: IWireCall[] = [
  { id: "toolu_a", name: "read_file", input: { path: "a.ts" } },
  { id: "toolu_b", name: "Read", input: { file_path: "b.ts" } },
];
const RESULT_A = '{"content":"BODY-@fixture/a.ts"}';
const RESULT_B = '{"content":"BODY-@fixture/b.ts"}';
const PORTAL_ROOT = Deno.makeTempDirSync({ prefix: "native-tool-round-provider-" });
const LOCAL_MODEL = "compat-fixture-v1";
const LOCAL_BUDGET: IPromptBudget = {
  model: LOCAL_MODEL,
  totalBudgetTokens: 100000,
  safetyBufferTokens: 0,
  sections: {
    [PromptBudgetSection.SYSTEM]: 5000,
    [PromptBudgetSection.PLAN]: 0,
    [PromptBudgetSection.PORTAL_KNOWLEDGE]: 0,
    [PromptBudgetSection.MEMORY]: 0,
    [PromptBudgetSection.SKILLS]: 0,
    [PromptBudgetSection.LOOP_HISTORY]: 50000,
  },
};

bootstrapProviderRegistry();

for (const preset of LLM_TEST_PRESETS) {
  const keyEnv = llmKeyEnv(preset.spec)!;
  const modelId = preset.spec.service_model_id ?? "";
  const name = (scenario: string) => `[native_tool_round][${preset.id}] ${scenario}`;

  Deno.test({
    name: name("the boot registration declares grouped replay for the bound provider"),
    ignore: !preset.groupedReplay,
    fn: async () => {
      await withEnv({ [keyEnv]: "test-key" }, async () => {
        const { provider } = await createLlmProvider(preset.spec);
        assertEquals(
          ProviderRegistry.getMetadataForInstance(provider.id)?.supportsParallelToolReplay,
          true,
          `${preset.id} must declare grouped replay at boot`,
        );
        ProviderRegistry.clear();
      });
    },
  });

  Deno.test({
    name: name("a two-call round replays its assistant turn verbatim, then one result per call in order"),
    ignore: !preset.groupedReplay,
    fn: async () => {
      await withEnv({ [keyEnv]: "test-key" }, async () => {
        const family = wireFamilyFor(resolveLlmBinding(preset.spec).adapter);
        const round = family.roundResponse(TWO_CALLS, modelId);
        const run = await runBoundRound({
          spec: preset.spec,
          apiKeyEnv: keyEnv,
          responses: [round.body, family.finalResponse("plan", modelId)],
          maxRounds: 2,
          portalRoot: PORTAL_ROOT,
          traceId: `trace-round-${preset.id}-two`,
        });
        assertEquals(run.registry.calls, ["read_file:@fixture/a.ts", "read_file:@fixture/b.ts"]);
        assertEquals(run.requests.length, 2);
        assertEquals(family.replayedAssistant(run.requests[1]!), round.assistant, "every original block replays once");
        assertEquals(family.replayedResults(run.requests[1]!), [RESULT_A, RESULT_B], "results keep call order");
        assertEquals(run.final, "plan");
      });
    },
  });

  Deno.test({
    name: name("a one-call round replays an exact golden follow-up"),
    ignore: !preset.groupedReplay,
    fn: async () => {
      await withEnv({ [keyEnv]: "test-key" }, async () => {
        const family = wireFamilyFor(resolveLlmBinding(preset.spec).adapter);
        const round = family.roundResponse(ONE_CALL, modelId);
        const run = await runBoundRound({
          spec: preset.spec,
          apiKeyEnv: keyEnv,
          responses: [round.body, family.finalResponse("plan", modelId)],
          baseOptions: { toolChoice: { type: "auto", disable_parallel_tool_use: true } },
          maxRounds: 2,
          portalRoot: PORTAL_ROOT,
          traceId: `trace-round-${preset.id}-one`,
        });
        assertEquals(family.replayedAssistant(run.requests[1]!), round.assistant);
        assertEquals(family.replayedResults(run.requests[1]!), [RESULT_A]);
      });
    },
  });

  Deno.test({
    name: name("the off policy puts the family's one-call flag on the exploration request, and none on the final"),
    ignore: !preset.groupedReplay,
    fn: async () => {
      await withEnv({ [keyEnv]: "test-key" }, async () => {
        const family = wireFamilyFor(resolveLlmBinding(preset.spec).adapter);
        const run = await runBoundRound({
          spec: preset.spec,
          apiKeyEnv: keyEnv,
          responses: [family.roundResponse(TWO_CALLS, modelId).body, family.finalResponse("plan", modelId)],
          maxRounds: 2,
          portalRoot: PORTAL_ROOT,
          traceId: `trace-round-${preset.id}-off`,
          toolsRoundPolicy: () => roundPolicy(ToolsRoundMode.OFF, 1),
        });
        assertEquals(wireFlagsOf(run.requests[0]!), OFF_EXPLORATION_FLAGS[preset.id], `${preset.id} exploration flags`);
        assertEquals(wireFlagsOf(run.requests[1]!), NO_WIRE_FLAGS, "the final request is toolChoice none");
      });
    },
  });

  Deno.test({
    name: name("the auto policy sends no parallel flag on the captured exploration or final request"),
    ignore: !preset.groupedReplay,
    fn: async () => {
      await withEnv({ [keyEnv]: "test-key" }, async () => {
        const family = wireFamilyFor(resolveLlmBinding(preset.spec).adapter);
        const run = await runBoundRound({
          spec: preset.spec,
          apiKeyEnv: keyEnv,
          responses: [family.roundResponse(TWO_CALLS, modelId).body, family.finalResponse("plan", modelId)],
          maxRounds: 2,
          portalRoot: PORTAL_ROOT,
          traceId: `trace-round-${preset.id}-auto`,
          toolsRoundPolicy: () => roundPolicy(ToolsRoundMode.AUTO, 4),
        });
        assertEquals(wireFlagsOf(run.requests[0]!), NO_WIRE_FLAGS, `${preset.id} exploration flags`);
        assertEquals(wireFlagsOf(run.requests[1]!), NO_WIRE_FLAGS, "the final request is toolChoice none");
        assertEquals(run.registry.calls, ["read_file:@fixture/a.ts", "read_file:@fixture/b.ts"]);
      });
    },
  });

  Deno.test({
    name: name("an alias call replays under the model's original name and input"),
    ignore: !preset.groupedReplay || preset.acceptsToolAliases === false,
    fn: async () => {
      await withEnv({ [keyEnv]: "test-key" }, async () => {
        const family = wireFamilyFor(resolveLlmBinding(preset.spec).adapter);
        const round = family.roundResponse(ALIAS_CALLS, modelId);
        const run = await runBoundRound({
          spec: preset.spec,
          apiKeyEnv: keyEnv,
          responses: [round.body, family.finalResponse("plan", modelId)],
          maxRounds: 2,
          portalRoot: PORTAL_ROOT,
          traceId: `trace-round-${preset.id}-alias`,
        });
        assertEquals(run.registry.calls, ["read_file:@fixture/a.ts", "read_file:@fixture/b.ts"]);
        assertEquals(family.replayedAssistant(run.requests[1]!), round.assistant, "the alias name replays as sent");
      });
    },
  });

  Deno.test({
    name: name("an alias the model was not offered is refused before any tool runs"),
    ignore: !preset.groupedReplay || preset.acceptsToolAliases !== false,
    fn: async () => {
      await withEnv({ [keyEnv]: "test-key" }, async () => {
        const family = wireFamilyFor(resolveLlmBinding(preset.spec).adapter);
        const round = family.roundResponse(ALIAS_CALLS, modelId);
        await assertRejects(
          () =>
            runBoundRound({
              spec: preset.spec,
              apiKeyEnv: keyEnv,
              responses: [round.body, family.finalResponse("plan", modelId)],
              maxRounds: 2,
              portalRoot: PORTAL_ROOT,
              traceId: `trace-round-${preset.id}-alias-refused`,
            }),
          Error,
          "Invalid compatible tool call",
        );
      });
    },
  });
}

Deno.test({
  name:
    "[native_tool_round][openai] the boot registration declares native conversation, so a ReAct turn replays every earlier turn",
  fn: () =>
    withEnv({ OPENAI_API_KEY: "test-key" }, async () => {
      const preset = LLM_TEST_PRESETS.find((candidate) => candidate.id === "openai");
      const { provider } = await createLlmProvider(preset!.spec);
      assertEquals(ProviderRegistry.getMetadataForInstance(provider.id)?.supportsNativeConversation, true);
      ProviderRegistry.clear();
    }),
});

Deno.test({
  name:
    "[native_tool_round][openrouter] the boot registration declares native conversation, so a ReAct turn replays every earlier turn",
  fn: () =>
    withEnv({ OPENROUTER_API_KEY: "test-key" }, async () => {
      const preset = LLM_TEST_PRESETS.find((candidate) => candidate.id === "openrouter");
      const { provider } = await createLlmProvider(preset!.spec);
      assertEquals(ProviderRegistry.getMetadataForInstance(provider.id)?.supportsNativeConversation, true);
      ProviderRegistry.clear();
    }),
});

Deno.test({
  name:
    "[native_tool_round][openai-chat local fixture] a registered planning loop replays each completed round whole and measures it",
  fn: () =>
    withEnv({ EXA_COMPAT_TEST_API_KEY: "local-fixture-key" }, async () => {
      bootstrapProviderRegistry();
      const family = wireFamilyFor("openai-chat");
      const round = family.roundResponse(TWO_CALLS, LOCAL_MODEL);
      const bodies: JSONValue[] = [round.body, family.finalResponse("plan", LOCAL_MODEL)];
      const requests: IWireRequest[] = [];
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request) => {
        requests.push(await request.json());
        return Response.json(bodies.shift() ?? null);
      });
      try {
        const endpoint = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/v1/chat/completions`;
        const provider = await new OpenAICompatibleProviderFactory().create({
          provider: ProviderType.OPENAI_CHAT,
          model: LOCAL_MODEL,
          timeoutMs: 5000,
          compatible: {
            profile: "local-test",
            endpoint,
            model: LOCAL_MODEL,
            allow_insecure_loopback: true,
            max_response_bytes: 65536,
            max_tool_argument_bytes: 512,
            max_history_bytes: 1048576,
          },
        });
        const measure = provider.measureInputTokens?.bind(provider);
        assert(measure !== undefined, "the compatible provider must measure its own projection");
        let measured = 0;
        const run = await runPlanningRound(provider, {
          modelId: LOCAL_MODEL,
          maxRounds: 2,
          portalRoot: PORTAL_ROOT,
          traceId: "trace-round-openai-chat-local",
          promptBudget: LOCAL_BUDGET,
          measureInputTokens: (prompt, options) => {
            measured++;
            return measure(prompt, options);
          },
        });
        assertEquals(run.registry.calls, ["read_file:@fixture/a.ts", "read_file:@fixture/b.ts"]);
        assertEquals(requests.length, 2);
        assertEquals(family.replayedAssistant(requests[1]!), round.assistant, "the whole round replays once");
        assertEquals(family.replayedResults(requests[1]!), [RESULT_A, RESULT_B], "results keep call order");
        assertEquals(run.final, "plan");
        assertEquals(measured, 2, "every round is measured before its generate call");
      } finally {
        await server.shutdown();
        ProviderRegistry.clear();
      }
    }),
});
