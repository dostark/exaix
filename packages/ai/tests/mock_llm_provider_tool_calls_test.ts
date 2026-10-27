/**
 * @module MockLLMProviderToolCallsTest
 * @path packages/ai/tests/mock_llm_provider_tool_calls_test.ts
 * @description Phase 199 Step 5 — recorded fixtures can replay native tool calls: a
 *   call-site-keyed recording with toolCalls returns them on IGenerateResult.toolCalls when
 *   IModelOptions.tools is set (and is otherwise ignored, per the IGenerateResult contract),
 *   a malformed toolCalls entry is rejected at fixture load, and the mock provider metadata
 *   reports supportsNativeTools so a real daemon can drive a scripted planning tool round.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/mock_llm_provider.ts, packages/ai/src/provider_factory.ts, packages/execution/src/planning_tool_loop.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { MockStrategy, ProviderType } from "@exaix/core";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { ensureProviderRegistryInitialized } from "../src/provider_factory.ts";
import type { IProviderToolCall } from "../src/providers/common.ts";
import type { IProviderToolRound, IProviderTurn } from "../src/types.ts";
import type { JSONValue } from "@exaix/core";
import {
  hashPrompt,
  type IRecordedResponse,
  MockLLMError,
  MockLLMProvider,
} from "../src/providers/mock_llm_provider.ts";
import { withTempDir } from "@exaix/testing";

const ROUND_ONE_CALL_SITE = { scenarioId: "plan-tools", stepId: "round-1", callIndex: 0 };
const TOOL_CALL: IProviderToolCall = {
  id: "toolu_01",
  name: "read_file",
  input: { path: "src/main.ts" },
};

function roundOneRecording(): IRecordedResponse {
  return {
    promptHash: hashPrompt(PROMPT),
    promptPreview: "planning round 1",
    response: "",
    model: "mock:gpt-5.2-pro",
    tokens: { input: 100, output: 0 },
    recordedAt: "2026-09-23T00:00:00.000Z",
    callSite: ROUND_ONE_CALL_SITE,
    toolCalls: [TOOL_CALL],
  };
}

/** The tools the Planner actually sends on an exploration round (options.tools). */
const READ_TOOLS = [
  {
    name: "read_file",
    description: "Read a file",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
];

const PROMPT = "planning round 1 prompt";

Deno.test("[mock toolCalls] a recorded fixture with toolCalls replayed by callSite returns them when options.tools is set", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [roundOneRecording()] });

  const result = await provider.generate(PROMPT, { callSite: ROUND_ONE_CALL_SITE, tools: READ_TOOLS });

  assertEquals(result.toolCalls, [TOOL_CALL]);
  assertEquals(result.content, "");
});

Deno.test("[mock toolCalls] the same fixture without options.tools returns no toolCalls", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [roundOneRecording()] });

  const result = await provider.generate(PROMPT, { callSite: ROUND_ONE_CALL_SITE });

  assertEquals(result.toolCalls, undefined);
});

Deno.test("[mock toolCalls] a malformed toolCalls entry is rejected by the recording validator", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/recording.json`,
      JSON.stringify({
        promptHash: "x",
        promptPreview: "corrupt",
        response: "",
        model: "mock:gpt-5.2-pro",
        tokens: { input: 1, output: 1 },
        recordedAt: "2026-09-23T00:00:00.000Z",
        callSite: ROUND_ONE_CALL_SITE,
        toolCalls: [{ id: 5 }],
      }),
    );
    assertThrows(
      () => new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir }),
      MockLLMError,
      "Corrupt fixture file",
    );
  }, { prefix: "mock-fixture-" });
});

Deno.test("[mock toolCalls] mock provider metadata reports supportsNativeTools", () => {
  ensureProviderRegistryInitialized();
  assertEquals(ProviderRegistry.getProviderMetadata(ProviderType.MOCK)?.supportsNativeTools, true);
});

// expectedInput: assertions on the actual provider input, enforced before replay

const FINAL_CALL_SITE = { scenarioId: "plan-tools", stepId: "round-1", callIndex: 1 };

function finalRecording(expectedInput: IRecordedResponse["expectedInput"]): IRecordedResponse {
  return {
    promptHash: "stale-hash-drift-is-tolerated",
    promptPreview: "planning round 2",
    response: "the plan",
    model: "mock:gpt-5.2-pro",
    tokens: { input: 100, output: 10 },
    recordedAt: "2026-09-23T00:00:00.000Z",
    callSite: FINAL_CALL_SITE,
    expectedInput,
  };
}

function priorTurnWith(content: IProviderTurn["toolResultContent"]): IProviderTurn {
  return {
    toolUseId: "toolu_01",
    toolName: "read_file",
    toolInput: {},
    toolResultContent: content,
    toolResultIsError: false,
  };
}

async function writeFixture(fixture: JSONValue): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "mock-expected-input-" });
  await Deno.writeTextFile(`${dir}/recording.json`, JSON.stringify(fixture));
  return dir;
}

Deno.test("[recorded_mock] expectedInput passes when the actual prompt and priorTurn result satisfy every assertion", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [finalRecording({
      promptIncludes: ["MARKER_PROMPT"],
      promptExcludes: ["LEAKED"],
      priorTurnResultIncludes: ["MARKER_RESULT"],
      priorTurnResultExcludes: ["SENTINEL"],
    })],
  });

  const result = await provider.generate("prompt with MARKER_PROMPT", {
    callSite: FINAL_CALL_SITE,
    priorTurn: priorTurnWith('{"content":"MARKER_RESULT"}'),
  });

  assertEquals(result.content, "the plan");
});

Deno.test("[recorded_mock] expectedInput reads rich priorTurn content blocks", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [finalRecording({ priorTurnResultIncludes: ["MARKER_RESULT"] })],
  });

  const result = await provider.generate("p", {
    callSite: FINAL_CALL_SITE,
    priorTurn: priorTurnWith([{ type: "text", text: "MARKER_RESULT" }]),
  });

  assertEquals(result.content, "the plan");
});

Deno.test("[recorded_mock] a missing priorTurn fails a required result assertion despite prompt-hash drift", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [finalRecording({ priorTurnResultIncludes: ["MARKER_RESULT"] })],
    patterns: [{ pattern: /.*/, response: "pattern fallback must not answer" }],
  });

  await assertRejects(
    () => provider.generate("drifted prompt", { callSite: FINAL_CALL_SITE }),
    MockLLMError,
    "no priorTurn",
  );
});

Deno.test("[recorded_mock] a mismatched priorTurn result or prompt throws a fixture error", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [finalRecording({ priorTurnResultIncludes: ["MARKER_RESULT"], priorTurnResultExcludes: ["SENTINEL"] })],
  });
  await assertRejects(
    () => provider.generate("p", { callSite: FINAL_CALL_SITE, priorTurn: priorTurnWith("other") }),
    MockLLMError,
    "MARKER_RESULT",
  );
  await assertRejects(
    () => provider.generate("p", { callSite: FINAL_CALL_SITE, priorTurn: priorTurnWith("MARKER_RESULT SENTINEL") }),
    MockLLMError,
    "SENTINEL",
  );

  const promptProvider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [finalRecording({ promptIncludes: ["NEEDED"], promptExcludes: ["LEAKED"] })],
  });
  await assertRejects(() => promptProvider.generate("p", { callSite: FINAL_CALL_SITE }), MockLLMError, "NEEDED");
  await assertRejects(
    () => promptProvider.generate("NEEDED LEAKED", { callSite: FINAL_CALL_SITE }),
    MockLLMError,
    "LEAKED",
  );
});

Deno.test("[recorded_mock] malformed expectedInput fields are rejected at fixture load", async () => {
  const base = JSON.parse(JSON.stringify(finalRecording(undefined))) as Record<string, JSONValue>;
  const malformed: JSONValue[] = [["x"], { promptIncludes: "x" }, { promptIncludes: [5] }, { resultIncludes: ["x"] }];
  for (const expectedInput of malformed) {
    const dir = await writeFixture({ ...base, expectedInput });
    try {
      assertThrows(
        () => new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir }),
        MockLLMError,
        "expectedInput",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("[recorded_mock] a fixture without expectedInput replays unchanged", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [finalRecording(undefined)] });

  const result = await provider.generate("anything", { callSite: FINAL_CALL_SITE });

  assertEquals(result.content, "the plan");
});

Deno.test("[security] recorded mock cost rejects malformed or negative prices at fixture load", async () => {
  const base = JSON.parse(JSON.stringify(finalRecording(undefined))) as Record<string, JSONValue>;
  for (const cost_usd of [-0.01, "0", null]) {
    const dir = await writeFixture({ ...base, cost_usd });
    try {
      assertThrows(
        () => new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir }),
        MockLLMError,
        "cost_usd",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

// Grouped round replay: the artifact a replayed call returns, the round expectations, and the
// request's parallel flag.

const ROUND_CALL_SITE = { scenarioId: "plan-tools", stepId: "round-2", callIndex: 1 };

/** A completed round of read calls, as the planning loop replays it on the next request. */
function completedRound(calls: Array<{ id: string; path: string; result: string }>): IProviderToolRound {
  return {
    calls: calls.map((call, index) => ({
      toolUseId: call.id,
      index,
      toolName: "read_file",
      toolInput: { path: call.path },
      toolResultContent: call.result,
      toolResultIsError: false,
    })),
    assistant: {
      provider: "openai-chat",
      assistantContent: null,
      toolCalls: calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: "read_file", arguments: JSON.stringify({ path: call.path }) },
      })),
    },
  };
}

const THREE_READS = [
  { id: "toolu_a", path: "src/a.ts", result: '{"content":"MARK-A"}' },
  { id: "toolu_b", path: "src/b.ts", result: '{"content":"MARK-B"}' },
  { id: "toolu_c", path: "src/c.ts", result: '{"content":"MARK-C"}' },
];

function roundExpectation(
  calls: Array<{ id: string; index: number; path: string; marker: string }>,
): NonNullable<IRecordedResponse["expectedInput"]> {
  return {
    priorRoundCalls: calls.map((call) => ({
      toolUseId: call.id,
      index: call.index,
      toolName: "read_file",
      input: { path: call.path },
      resultIncludes: call.marker,
    })),
  };
}

function roundFinalRecording(expectedInput: IRecordedResponse["expectedInput"]): IRecordedResponse {
  return {
    promptHash: "stale-hash-drift-is-tolerated",
    promptPreview: "planning round 2",
    response: "the plan",
    model: "mock:gpt-5.2-pro",
    tokens: { input: 100, output: 10 },
    recordedAt: "2026-09-23T00:00:00.000Z",
    callSite: ROUND_CALL_SITE,
    expectedInput,
  };
}

Deno.test("[mock toolCalls] a replayed call returns the assistant artifact the provider sent, in wire shape", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [{ ...roundOneRecording(), toolCalls: [TOOL_CALL] }],
  });
  const result = await provider.generate(PROMPT, { callSite: ROUND_ONE_CALL_SITE, tools: READ_TOOLS });

  assertEquals(result.nativeAssistantReplay?.provider, "openai-chat");
  assertEquals(result.nativeAssistantReplay?.provider === "openai-chat" ? result.nativeAssistantReplay.toolCalls : [], [
    { id: "toolu_01", type: "function", function: { name: "read_file", arguments: '{"path":"src/main.ts"}' } },
  ]);
});

Deno.test("[mock toolCalls] the registered mock declares grouped round replay alongside native tools", () => {
  ensureProviderRegistryInitialized();
  const metadata = ProviderRegistry.getProviderMetadata(ProviderType.MOCK);
  assertEquals(metadata?.supportsParallelToolReplay, true);
  assertEquals(metadata?.supportsNativeConversation, undefined);
});

Deno.test("[recorded_mock] priorRoundCalls passes when the replayed round matches every call, in order", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [roundFinalRecording(roundExpectation([
      { id: "toolu_a", index: 0, path: "src/a.ts", marker: "MARK-A" },
      { id: "toolu_b", index: 1, path: "src/b.ts", marker: "MARK-B" },
      { id: "toolu_c", index: 2, path: "src/c.ts", marker: "MARK-C" },
    ]))],
  });
  const result = await provider.generate("round two prompt", {
    callSite: ROUND_CALL_SITE,
    priorRound: completedRound(THREE_READS),
  });
  assertEquals(result.content, "the plan");
});

Deno.test("[recorded_mock] priorRoundCalls names the first call whose result misses its marker", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [roundFinalRecording(roundExpectation([
      { id: "toolu_a", index: 0, path: "src/a.ts", marker: "MARK-A" },
      { id: "toolu_b", index: 1, path: "src/b.ts", marker: "MARK-MISSING" },
      { id: "toolu_c", index: 2, path: "src/c.ts", marker: "MARK-C" },
    ]))],
  });
  const error = await assertRejects(
    () => provider.generate("round two prompt", { callSite: ROUND_CALL_SITE, priorRound: completedRound(THREE_READS) }),
    MockLLMError,
  );
  assertStringIncludes(error.message, "round call 1 (toolu_b)");
  assertStringIncludes(error.message, "MARK-MISSING");
});

Deno.test("[recorded_mock] priorRoundCalls fails on a round of a different length", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [roundFinalRecording(roundExpectation([
      { id: "toolu_a", index: 0, path: "src/a.ts", marker: "MARK-A" },
      { id: "toolu_b", index: 1, path: "src/b.ts", marker: "MARK-B" },
    ]))],
  });
  await assertRejects(
    () => provider.generate("round two prompt", { callSite: ROUND_CALL_SITE, priorRound: completedRound(THREE_READS) }),
    MockLLMError,
    "the replayed round has 3 calls, expected 2",
  );
});

Deno.test("[recorded_mock] priorRoundCalls checks the exact input each call carried", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [roundFinalRecording(roundExpectation([
      { id: "toolu_a", index: 0, path: "src/other.ts", marker: "MARK-A" },
      { id: "toolu_b", index: 1, path: "src/b.ts", marker: "MARK-B" },
      { id: "toolu_c", index: 2, path: "src/c.ts", marker: "MARK-C" },
    ]))],
  });
  await assertRejects(
    () => provider.generate("round two prompt", { callSite: ROUND_CALL_SITE, priorRound: completedRound(THREE_READS) }),
    MockLLMError,
    "round call 0 (toolu_a)",
  );
});

Deno.test("[recorded_mock] priorRoundArtifactIds checks the replayed assistant artifact's call ids in order", async () => {
  const passing = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [roundFinalRecording({ priorRoundArtifactIds: ["toolu_a", "toolu_b", "toolu_c"] })],
  });
  assertEquals(
    (await passing.generate("p", { callSite: ROUND_CALL_SITE, priorRound: completedRound(THREE_READS) })).content,
    "the plan",
  );

  const failing = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [roundFinalRecording({ priorRoundArtifactIds: ["toolu_c", "toolu_b", "toolu_a"] })],
  });
  await assertRejects(
    () => failing.generate("p", { callSite: ROUND_CALL_SITE, priorRound: completedRound(THREE_READS) }),
    MockLLMError,
    "assistant artifact",
  );
});

Deno.test("[recorded_mock] expectedParallelDisabled checks the request's disable flag, both ways", async () => {
  const off = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [roundFinalRecording({ expectedParallelDisabled: true })],
  });
  assertEquals(
    (await off.generate("p", {
      callSite: ROUND_CALL_SITE,
      toolChoice: { type: "auto", disable_parallel_tool_use: true },
    })).content,
    "the plan",
  );

  const auto = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [roundFinalRecording({ expectedParallelDisabled: false })],
  });
  assertEquals(
    (await auto.generate("p", { callSite: ROUND_CALL_SITE, toolChoice: { type: "auto" } })).content,
    "the plan",
  );

  await assertRejects(
    () =>
      auto.generate("p", { callSite: ROUND_CALL_SITE, toolChoice: { type: "auto", disable_parallel_tool_use: true } }),
    MockLLMError,
    "parallel",
  );
});

Deno.test("[recorded_mock] a legacy priorTurnResult expectation checks the round's joined results when only a round replays", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [roundFinalRecording({ priorTurnResultIncludes: ["MARK-A", "MARK-C"] })],
  });
  assertEquals(
    (await provider.generate("p", { callSite: ROUND_CALL_SITE, priorRound: completedRound(THREE_READS) })).content,
    "the plan",
  );
});

Deno.test("[recorded_mock] malformed priorRoundCalls and artifact fields are rejected at fixture load", async () => {
  const bad: Array<IRecordedResponse["expectedInput"] | Record<string, JSONValue>> = [
    { priorRoundCalls: [{ toolUseId: "toolu_a" }] },
    { priorRoundCalls: "toolu_a" },
    { priorRoundArtifactIds: [1] },
    { expectedParallelDisabled: "yes" },
  ];
  for (const expectedInput of bad) {
    const dir = await writeFixture(JSON.parse(JSON.stringify({
      promptHash: "h",
      promptPreview: "p",
      response: "x",
      model: "m",
      tokens: { input: 1, output: 1 },
      recordedAt: "2026-09-23T00:00:00.000Z",
      callSite: ROUND_CALL_SITE,
      expectedInput,
    })));
    assertThrows(() => new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir }), MockLLMError);
  }
});
