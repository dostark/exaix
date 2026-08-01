/**
 * @module CaptureContractValidationTest
 * @path packages/ai/tests/providers/capture_contract_validation_test.ts
 * @description Phase 157 Step 2 — capture validates a response against its call site's SHAPE
 *   contract, not its quality (Design Decision 3). A malformed response, and one of the wrong
 *   shape for its call site, are both refused; a well-formed but mediocre response is accepted.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/capture_recording_provider.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { CaptureRecordingError, CaptureRecordingProvider } from "../../src/providers/capture_recording_provider.ts";
import type { ICallSite, IModelOptions, IModelProvider } from "../../src/types.ts";
import type { IGenerateResult } from "../../src/providers/common.ts";

const FLOW_STEP_PROMPT = "## Step 1\nContext from the prior step.";
const REACT_LOOP_PROMPT = "IDENTITY: default\nAVAILABLE TOOLS: write_file, read_file";

function okResult(content: string): IGenerateResult {
  return {
    content,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: "claude-test-model",
    provider: "stub",
  };
}

class FixedResponseProvider implements IModelProvider {
  readonly id = "stub";
  constructor(private readonly response: string) {}
  generate(_prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
    return Promise.resolve(okResult(this.response));
  }
}

Deno.test("[capture_contract_validation] a malformed response (missing required markers) is refused", async () => {
  const dir = await Deno.makeTempDir();
  const capture = new CaptureRecordingProvider(new FixedResponseProvider("just some prose, no tags at all"), {
    dir,
    maxAttempts: 1,
  });
  const callSite: ICallSite = { scenarioId: "flows", stepId: "a", callIndex: 0 };

  await assertRejects(
    async () => await capture.generate(FLOW_STEP_PROMPT, { callSite }),
    CaptureRecordingError,
  );
});

Deno.test("[capture_contract_validation] a response of the wrong shape for its call site is refused", async () => {
  const dir = await Deno.makeTempDir();
  // A ReAct-dialect completion answered to a flow-step prompt — wrong dialect entirely.
  const capture = new CaptureRecordingProvider(
    new FixedResponseProvider("THOUGHT: done\nSTATUS: COMPLETE\nSUMMARY: done"),
    { dir, maxAttempts: 1 },
  );
  const callSite: ICallSite = { scenarioId: "flows", stepId: "a", callIndex: 0 };

  await assertRejects(
    async () => await capture.generate(FLOW_STEP_PROMPT, { callSite }),
    CaptureRecordingError,
  );
});

Deno.test("[capture_contract_validation] a well-formed but mediocre response is accepted — quality is not a capture criterion", async () => {
  const dir = await Deno.makeTempDir();
  const vagueButValid = `<content>\n{"subject": "vague plan", "steps": []}\n</content>`;
  const capture = new CaptureRecordingProvider(new FixedResponseProvider(vagueButValid), { dir, maxAttempts: 1 });
  const callSite: ICallSite = { scenarioId: "flows", stepId: "a", callIndex: 0 };

  const result = await capture.generate(FLOW_STEP_PROMPT, { callSite });
  assertEquals(result.content, vagueButValid);
});

Deno.test("[capture_contract_validation] a ReAct-loop prompt accepts STATUS: COMPLETE", async () => {
  const dir = await Deno.makeTempDir();
  const capture = new CaptureRecordingProvider(
    new FixedResponseProvider("THOUGHT: done\nSTATUS: COMPLETE\nSUMMARY: done"),
    { dir, maxAttempts: 1 },
  );
  const callSite: ICallSite = { scenarioId: "flows", stepId: "b", callIndex: 0 };

  const result = await capture.generate(REACT_LOOP_PROMPT, { callSite });
  assertEquals(result.content.includes("STATUS: COMPLETE"), true);
});

Deno.test("[capture_contract_validation] a ReAct-loop prompt accepts a toml action block", async () => {
  const dir = await Deno.makeTempDir();
  const response = 'THOUGHT: writing\n```toml\n[[actions]]\ntool = "write_file"\n```';
  const capture = new CaptureRecordingProvider(new FixedResponseProvider(response), { dir, maxAttempts: 1 });
  const callSite: ICallSite = { scenarioId: "flows", stepId: "c", callIndex: 0 };

  const result = await capture.generate(REACT_LOOP_PROMPT, { callSite });
  assertEquals(result.content, response);
});
