/**
 * @module JudgeAgentRunnerTest
 * @path apps/daemon/tests/judge_agent_runner_test.ts
 * @description Verifies call-site, raw judge contract, and trace forwarding through the gate chain.
 */
import { assertEquals } from "@std/assert";
import { FlowGateOnFail } from "@exaix/core";
import type { IFlowJudgeCallMetadata } from "@exaix/core/types";
import { GateEvaluator, JudgeEvaluator } from "@exaix/flow";
import type { IModelOptions, IModelProvider } from "@exaix/ai";
import type { IGenerateResult } from "@exaix/ai/providers";
import { JudgeAgentRunner } from "../src/judge_agent_runner.ts";
class MetadataProvider implements IModelProvider {
  readonly id = "judge-metadata";
  options?: IModelOptions;
  generate(_prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    this.options = options;
    return Promise.resolve({
      content: JSON.stringify({ criteriaScores: { code_correctness: { score: 1 } }, feedback: "ok", suggestions: [] }),
      model: "fixture",
      provider: this.id,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
  }
}
Deno.test("[judge runner] gate metadata reaches provider options and raw judge criteria", async () => {
  const provider = new MetadataProvider();
  const metadata: IFlowJudgeCallMetadata = {
    traceId: "request-trace",
    callSite: { scenarioId: "gate-halt", stepId: "submit", flowStepId: "gate", callIndex: 0 },
  };
  const evaluator = new GateEvaluator(new JudgeEvaluator(new JudgeAgentRunner(provider)));
  await evaluator.evaluate({
    agentRole: "code-reviewer",
    criteria: ["CODE_CORRECTNESS"],
    threshold: 1,
    onFail: FlowGateOnFail.HALT,
    maxRetries: 1,
    includeRequestCriteria: false,
    callMetadata: metadata,
  }, "Output");
  assertEquals(provider.options?.traceId, metadata.traceId);
  assertEquals(provider.options?.callSite, metadata.callSite);
  assertEquals(provider.options?.responseContract, { kind: "judge-json", criteria: ["code_correctness"] });
});
Deno.test("[judge runner] non-flow callers keep unkeyed provider options", async () => {
  const provider = new MetadataProvider();
  await new JudgeAgentRunner(provider).run("code-reviewer", { userPrompt: "Grade this" });
  assertEquals(provider.options?.traceId, undefined);
  assertEquals(provider.options?.callSite, undefined);
});
