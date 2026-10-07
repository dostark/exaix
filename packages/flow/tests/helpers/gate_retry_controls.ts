/**
 * @module GateRetryTestHelpers
 * @path packages/flow/tests/helpers/gate_retry_controls.ts
 * @description Builds bounded gate retry fixtures and records body inputs.
 * @architectural-layer Test
 * @dependencies [@exaix/core, @exaix/flow, @exaix/schemas]
 * @related-files [packages/flow/tests/helpers/gate_controls.ts]
 */
import { FlowGateOnFail, FlowInputSource } from "@exaix/core";
import type { EvaluationCriterion, EvaluationResult } from "@exaix/core/types";
import type { IFlowStepRequest } from "@exaix/flow";
import type { IAgentExecutionResult } from "@exaix/execution";
import { FlowSchema, type IFlow } from "@exaix/schemas/flow.ts";
import { GateTestAgent, gateTestFlow, GateTestJudge } from "./gate_controls.ts";

export function gateRetryFlow(maxRetries = 3): IFlow {
  const flow = gateTestFlow(FlowGateOnFail.RETRY);
  flow.steps[0].dependsOn = ["draft"];
  flow.steps[0].input = { source: FlowInputSource.STEP, stepId: "draft", transform: "passthrough" };
  flow.steps[0].evaluate!.maxRetries = maxRetries;
  const gate = { ...flow.steps[0], loop: { backTo: "draft" } };
  const draft = {
    ...flow.steps[1],
    id: "draft",
    dependsOn: [],
    input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
  };
  return FlowSchema.parse({ ...flow, steps: [draft, gate, flow.steps[1]] });
}

export class RetryTestJudge extends GateTestJudge {
  readonly contents: string[] = [];
  constructor(private readonly scores: number[]) {
    super();
  }
  override async evaluate(role: string, content: string, criteria: EvaluationCriterion[]): Promise<EvaluationResult> {
    this.contents.push(content);
    const result = await super.evaluate(role, content, criteria);
    const score = this.scores[Math.min(this.calls - 1, this.scores.length - 1)];
    return {
      ...result,
      overallScore: score,
      pass: score >= 0.8,
      criteriaScores: Object.fromEntries(
        criteria.map((
          criterion,
        ) => [criterion.name, {
          name: criterion.name,
          reasoning: result.feedback,
          issues: [],
          score,
          passed: score >= 0.8,
        }]),
      ),
    };
  }
}

export class RetryTestAgent extends GateTestAgent {
  readonly requests: IFlowStepRequest[] = [];
  override run(role: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.calls.push(role);
    this.requests.push(request);
    const content = `draft ${this.calls.length}`;
    return Promise.resolve({ thought: "", content, raw: content });
  }
}

export function twoMemberRetryFlow(): IFlow {
  const flow = gateRetryFlow();
  const draft = flow.steps[0];
  const middle = { ...draft, id: "middle", dependsOn: [draft.id] };
  flow.steps.splice(1, 0, middle);
  flow.steps[2].dependsOn = [middle.id];
  flow.steps[2].input.stepId = middle.id;
  return flow;
}
