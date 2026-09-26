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

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { MockStrategy, ProviderType } from "@exaix/core";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { ensureProviderRegistryInitialized } from "../src/provider_factory.ts";
import type { IProviderToolCall } from "../src/providers/common.ts";
import type { IProviderTurn } from "../src/types.ts";
import type { JSONValue } from "@exaix/core";
import {
  hashPrompt,
  type IRecordedResponse,
  MockLLMError,
  MockLLMProvider,
} from "../src/providers/mock_llm_provider.ts";

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
  const dir = await Deno.makeTempDir({ prefix: "mock-fixture-" });
  try {
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
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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
