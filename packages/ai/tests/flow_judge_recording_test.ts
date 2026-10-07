/**
 * @module FlowJudgeRecordingTest
 * @path packages/ai/tests/flow_judge_recording_test.ts
 * @description Verifies raw judge capture validation and keyed replay.
 */
import { assertEquals, assertRejects } from "@std/assert";
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
