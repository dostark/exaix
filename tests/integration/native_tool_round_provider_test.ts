/**
 * @module NativeToolRoundProviderTest
 * @path tests/integration/native_tool_round_provider_test.ts
 * @description Parametrized by provider and model. Every preset with grouped replay runs the same
 *   round contract through the registered provider: the planning loop binds the provider from the
 *   phase-204 catalog, a scripted transport answers in that provider's wire family, and the follow-up
 *   request must replay the assistant turn verbatim and one result per call in order. A preset whose
 *   boot registration lacks grouped replay is reported as ignored with the step that adds it.
 * @architectural-layer Test
 * @related-files [
 *   "tests/helpers/llm_bindings.ts",
 *   "tests/helpers/native_tool_round_harness.ts",
 *   "packages/execution/src/planning_tool_loop.ts"
 * ]
 */

import { assertEquals } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";
import { createLlmProvider, LLM_TEST_PRESETS, llmKeyEnv, resolveLlmBinding } from "../helpers/llm_bindings.ts";
import { type IWireCall, runBoundRound, wireFamilyFor } from "../helpers/native_tool_round_harness.ts";

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

bootstrapProviderRegistry();

for (const preset of LLM_TEST_PRESETS) {
  const keyEnv = llmKeyEnv(preset.spec)!;
  const name = (scenario: string) => `[native_tool_round][${preset.id}] ${scenario}`;
  const pending = preset.pendingReplay ? ` (ignored: ${preset.pendingReplay})` : "";

  Deno.test({
    name: name("the boot registration declares grouped replay for the bound provider") + pending,
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
    name: name("a two-call round replays its assistant turn verbatim, then one result per call in order") + pending,
    ignore: !preset.groupedReplay,
    fn: async () => {
      await withEnv({ [keyEnv]: "test-key" }, async () => {
        const family = wireFamilyFor(resolveLlmBinding(preset.spec).adapter);
        const round = family.roundResponse(TWO_CALLS);
        const run = await runBoundRound({
          spec: preset.spec,
          apiKeyEnv: keyEnv,
          responses: [round.body, family.finalResponse("plan")],
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
    name: name("a one-call round replays an exact golden follow-up") + pending,
    ignore: !preset.groupedReplay,
    fn: async () => {
      await withEnv({ [keyEnv]: "test-key" }, async () => {
        const family = wireFamilyFor(resolveLlmBinding(preset.spec).adapter);
        const round = family.roundResponse(ONE_CALL);
        const run = await runBoundRound({
          spec: preset.spec,
          apiKeyEnv: keyEnv,
          responses: [round.body, family.finalResponse("plan")],
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
    name: name("an alias call replays under the model's original name and input") + pending,
    ignore: !preset.groupedReplay,
    fn: async () => {
      await withEnv({ [keyEnv]: "test-key" }, async () => {
        const family = wireFamilyFor(resolveLlmBinding(preset.spec).adapter);
        const round = family.roundResponse(ALIAS_CALLS);
        const run = await runBoundRound({
          spec: preset.spec,
          apiKeyEnv: keyEnv,
          responses: [round.body, family.finalResponse("plan")],
          maxRounds: 2,
          portalRoot: PORTAL_ROOT,
          traceId: `trace-round-${preset.id}-alias`,
        });
        assertEquals(run.registry.calls, ["read_file:@fixture/a.ts", "read_file:@fixture/b.ts"]);
        assertEquals(family.replayedAssistant(run.requests[1]!), round.assistant, "the alias name replays as sent");
      });
    },
  });
}
