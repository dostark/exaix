/**
 * @module CaptureWritesFixturesTest
 * @path packages/ai/tests/providers/capture_writes_fixtures_test.ts
 * @description Phase 157 Step 2 — a run through `CaptureRecordingProvider` writes one fixture
 *   file per call site, carrying provenance (model, recordedAt, promptHash), and re-capturing
 *   the same call site overwrites the addressed fixture rather than accumulating variants.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/capture_recording_provider.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { CaptureRecordingProvider } from "../../src/providers/capture_recording_provider.ts";
import type { ICallSite, IModelOptions, IModelProvider } from "../../src/types.ts";
import type { IGenerateResult } from "../../src/providers/common.ts";
import { hashPrompt, type IRecordedResponse } from "../../src/providers/mock_llm_provider.ts";

const FLOW_STEP_PROMPT = "## Step 1\nContext from the prior step.";

function okResult(content: string): IGenerateResult {
  return {
    content,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: "claude-test-model",
    provider: "stub",
  };
}

const WELL_FORMED_FLOW_RESPONSE = `<content>
{"subject": "x", "steps": []}
</content>`;

class StubProvider implements IModelProvider {
  readonly id = "stub";
  calls: string[] = [];
  constructor(private readonly response: string) {}
  generate(prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
    this.calls.push(prompt);
    return Promise.resolve(okResult(this.response));
  }
}

async function readFixtures(dir: string): Promise<IRecordedResponse[]> {
  const out: IRecordedResponse[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      out.push(JSON.parse(await Deno.readTextFile(`${dir}/${entry.name}`)));
    }
  }
  return out;
}

Deno.test("[capture_writes_fixtures] one fixture per call site, with provenance", async () => {
  const dir = await Deno.makeTempDir();
  const stub = new StubProvider(WELL_FORMED_FLOW_RESPONSE);
  const capture = new CaptureRecordingProvider(stub, { dir });

  const siteA: ICallSite = { scenarioId: "flows", stepId: "a", callIndex: 0 };
  const siteB: ICallSite = { scenarioId: "flows", stepId: "b", callIndex: 0 };
  await capture.generate(FLOW_STEP_PROMPT, { callSite: siteA });
  await capture.generate(FLOW_STEP_PROMPT, { callSite: siteB });

  const fixtures = await readFixtures(dir);
  assertEquals(fixtures.length, 2);
  for (const fixture of fixtures) {
    assertEquals(fixture.response, WELL_FORMED_FLOW_RESPONSE);
    assertEquals(fixture.model, "claude-test-model");
    assertEquals(fixture.promptHash, hashPrompt(FLOW_STEP_PROMPT));
    assertExists(fixture.recordedAt);
    assertExists(fixture.callSite);
  }
});

Deno.test("[capture_writes_fixtures] re-capturing the same call site overwrites, not accumulates", async () => {
  const dir = await Deno.makeTempDir();
  const siteA: ICallSite = { scenarioId: "flows", stepId: "a", callIndex: 0 };

  const first = new CaptureRecordingProvider(new StubProvider(WELL_FORMED_FLOW_RESPONSE), { dir });
  await first.generate(FLOW_STEP_PROMPT, { callSite: siteA });

  const secondResponse = `<content>\n{"subject": "y", "steps": []}\n</content>`;
  const second = new CaptureRecordingProvider(new StubProvider(secondResponse), { dir });
  await second.generate(FLOW_STEP_PROMPT, { callSite: siteA });

  const fixtures = await readFixtures(dir);
  assertEquals(fixtures.length, 1, "re-capturing the same call site must overwrite, not add a second file");
  assertEquals(fixtures[0].response, secondResponse);
});
