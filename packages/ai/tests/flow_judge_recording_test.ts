/**
 * @module FlowJudgeRecordingTest
 * @path packages/ai/tests/flow_judge_recording_test.ts
 * @description Verifies raw judge capture validation and keyed replay.
 */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { MockStrategy } from "@exaix/core";
import { CaptureRecordingError, CaptureRecordingProvider } from "../src/providers/capture_recording_provider.ts";
import { MockLLMProvider } from "../src/providers/mock_llm_provider.ts";
import type { IModelOptions, IModelProvider } from "@exaix/ai";

import type { IGenerateResult } from "@exaix/ai/providers";

const JUDGE_JSON = JSON.stringify({
  criteriaScores: { CODE_CORRECTNESS: { score: 0.2, reasoning: "Missing change", issues: [] } },
  feedback: "Missing change",
  suggestions: ["Fix it"],
});
const SITE = { scenarioId: "gate-halt", stepId: "submit", flowStepId: "gate", callIndex: 0 };
class FixedJudgeProvider implements IModelProvider {
  readonly id = "judge-fixture";
  constructor(private readonly response: string) {}
  generate(_prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
    return Promise.resolve({
      content: this.response,
      model: "fixture",
      provider: this.id,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
  }
}
Deno.test("[judge recording] raw criterion JSON captures and strict keyed replay preserves bytes", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const capture = new CaptureRecordingProvider(new FixedJudgeProvider(JUDGE_JSON), { dir, maxAttempts: 1 });
    await capture.generate("Judge the output", {
      callSite: SITE,
      responseContract: { kind: "judge-json", criteria: ["CODE_CORRECTNESS"] },
    });
    const replay = new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir, strictRecordings: true });
    assertEquals((await replay.generate("Changed wording", { callSite: SITE })).content, JUDGE_JSON);
    await assertRejects(() => replay.generate("Changed wording", { callSite: { ...SITE, callIndex: 1 } }));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
for (
  const response of [
    "{}",
    JSON.stringify({ criteriaScores: { CODE_CORRECTNESS: { score: 2 } }, feedback: "bad", suggestions: [] }),
    JSON.stringify({ criteriaScores: {}, feedback: "bad", suggestions: [] }),
    "<thought>ok</thought><content>{}</content>",
  ]
) {
  Deno.test(`[security] [judge recording] rejects invalid judge shape ${response}`, async () => {
    const dir = await Deno.makeTempDir();
    try {
      const capture = new CaptureRecordingProvider(new FixedJudgeProvider(response), { dir, maxAttempts: 1 });
      await assertRejects(
        () => capture.generate("Judge", { responseContract: { kind: "judge-json", criteria: ["CODE_CORRECTNESS"] } }),
        CaptureRecordingError,
      );
      assertEquals(Array.from(Deno.readDirSync(dir)), []);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}
Deno.test("[judge recording] ordinary agent capture still requires XML tags", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await assertRejects(
      () =>
        new CaptureRecordingProvider(new FixedJudgeProvider(JUDGE_JSON), { dir, maxAttempts: 1 }).generate(
          "Write a plan",
        ),
      CaptureRecordingError,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

const LOW = JSON.stringify({
  criteriaScores: { code_correctness: { score: 0.3, reasoning: "First draft lacks the guard", issues: [] } },
  feedback: "First draft lacks the guard",
  suggestions: ["Add the guard"],
});
const HIGH = JSON.stringify({
  criteriaScores: { code_correctness: { score: 0.95, reasoning: "Guard added", issues: [] } },
  feedback: "Guard added",
  suggestions: [],
});
const JUDGE_SITE = { scenarioId: "self-correcting", stepId: "submit", flowStepId: "quality-gate--judge" };
const JUDGE_CONTRACT = { kind: "judge-json" as const, criteria: ["code_correctness"] };

async function withRecordings(
  recordings: Array<
    {
      callSite?: typeof SITE;
      response: string;
      promptHash?: string;
      promptPreview?: string;
      expectedInput?: { promptIncludes: string[] };
    }
  >,
  test: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    for (const [index, recording] of recordings.entries()) {
      await Deno.writeTextFile(
        `${dir}/${index}.json`,
        JSON.stringify({
          promptHash: recording.promptHash ?? "0".repeat(64),
          promptPreview: recording.promptPreview ?? "unused preview",
          model: "fixture",
          tokens: { input: 1, output: 1 },
          recordedAt: "2026-10-07T00:00:00.000Z",
          ...recording,
        }),
      );
    }
    await test(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("[judge recording] identical judge prompts replay distinct keyed low then high verdicts", async () => {
  await withRecordings([
    { callSite: { ...JUDGE_SITE, callIndex: 0 }, response: LOW },
    { callSite: { ...JUDGE_SITE, callIndex: 1 }, response: HIGH },
  ], async (dir) => {
    const replay = new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir, strictRecordings: true });
    const prompt = "Evaluate the identical aggregate";
    const first = await replay.generate(prompt, {
      callSite: { ...JUDGE_SITE, callIndex: 0 },
      responseContract: JUDGE_CONTRACT,
    });
    const second = await replay.generate(prompt, {
      callSite: { ...JUDGE_SITE, callIndex: 1 },
      responseContract: JUDGE_CONTRACT,
    });
    assertEquals([first.content, second.content], [LOW, HIGH]);
  });
});

Deno.test("[security] [judge recording] a duplicate keyed recording is fatal under strict replay", async () => {
  await withRecordings([
    { callSite: { ...JUDGE_SITE, callIndex: 0 }, response: LOW },
    { callSite: { ...JUDGE_SITE, callIndex: 0 }, response: HIGH },
  ], (dir) => {
    assertThrows(
      () => new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir, strictRecordings: true }),
      Error,
      "Duplicate keyed recording",
    );
    return Promise.resolve();
  });
});

Deno.test("[security] [judge recording] a missing keyed index never falls back to a hash or preview match", async () => {
  const prompt = "Evaluate the identical aggregate";
  await withRecordings([
    { callSite: { ...JUDGE_SITE, callIndex: 0 }, response: LOW },
    { promptPreview: prompt, response: HIGH },
  ], async (dir) => {
    const replay = new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir, strictRecordings: true });
    await assertRejects(
      () => replay.generate(prompt, { callSite: { ...JUDGE_SITE, callIndex: 1 }, responseContract: JUDGE_CONTRACT }),
      Error,
      "No recording for call site",
    );
  });
});

Deno.test("[security] [judge recording] a keyed prompt mismatch is fatal", async () => {
  await withRecordings([
    {
      callSite: { ...JUDGE_SITE, callIndex: 0 },
      response: LOW,
      expectedInput: { promptIncludes: ["Implementation v2"] },
    },
  ], async (dir) => {
    const replay = new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir, strictRecordings: true });
    await assertRejects(() =>
      replay.generate("Implementation v1", {
        callSite: { ...JUDGE_SITE, callIndex: 0 },
        responseContract: JUDGE_CONTRACT,
      })
    );
  });
});

Deno.test("[security] [judge recording] an agent-dialect response on a judge call is fatal", async () => {
  await withRecordings([
    { callSite: { ...JUDGE_SITE, callIndex: 0 }, response: "<thought>ok</thought><content>{}</content>" },
    { callSite: { ...JUDGE_SITE, callIndex: 1 }, response: LOW.replace("code_correctness", "has_tests") },
  ], async (dir) => {
    const replay = new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir, strictRecordings: true });
    for (const callIndex of [0, 1]) {
      await assertRejects(
        () => replay.generate("Evaluate", { callSite: { ...JUDGE_SITE, callIndex }, responseContract: JUDGE_CONTRACT }),
        Error,
        "judge",
      );
    }
  });
});
