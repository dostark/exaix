/**
 * @module GateControlTestHelpers
 * @path packages/flow/tests/helpers/gate_controls.ts
 * @description Builds gate fixtures and records execution for control tests.
 * @architectural-layer Test
 * @dependencies [@exaix/core, @exaix/flow, @exaix/schemas]
 * @related-files [packages/flow/tests/flow_runner_gate_halt_test.ts]
 */
import { FlowGateOnFail, FlowStepType } from "@exaix/core";
import type { EvaluationCriterion, EvaluationResult, IJudgeInvoker, JSONValue } from "@exaix/core/types";
import { FlowSchema, type IFlow } from "@exaix/schemas/flow.ts";
import type { IAgentExecutor, IFlowEventLogger, IFlowStepRequest, IStepExecutionContext } from "@exaix/flow";
import type { IAgentExecutionResult } from "@exaix/execution";

export const GATE_SCORE = 0.2;
export const GATE_THRESHOLD = 0.8;
export const GATE_FEEDBACK = "Required change is missing";
export const GATE_TRACE = "phase205-gate-trace";
export class GateTestLogger implements IFlowEventLogger {
  readonly events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];
  log(event: string, payload: Record<string, JSONValue | undefined>): void {
    this.events.push({ event, payload });
  }
}
export class GateTestAgent implements IAgentExecutor {
  readonly calls: string[] = [];
  run(role: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.calls.push(role);
    return Promise.resolve({ thought: "", content: "Downstream result", raw: "Downstream result" });
  }
}
export class GateTestJudge implements IJudgeInvoker {
  calls = 0;
  fail = false;
  evaluate(_role: string, _content: string, _criteria: EvaluationCriterion[]): Promise<EvaluationResult> {
    this.calls++;
    if (this.fail) return Promise.reject(new Error("Judge unavailable"));
    return Promise.resolve({
      overallScore: GATE_SCORE,
      criteriaScores: {
        CODE_CORRECTNESS: {
          name: "CODE_CORRECTNESS",
          score: GATE_SCORE,
          reasoning: GATE_FEEDBACK,
          issues: [],
          passed: false,
        },
      },
      pass: false,
      feedback: GATE_FEEDBACK,
      suggestions: ["Add the missing change"],
    });
  }
}
export function gateTestFlow(onFail: FlowGateOnFail = FlowGateOnFail.HALT): IFlow {
  return FlowSchema.parse({
    id: "phase205-gate",
    name: "Gate control test",
    description: "Tests terminal gate controls",
    steps: [
      {
        id: "gate",
        name: "Quality gate",
        agent_role: "code-reviewer",
        type: FlowStepType.GATE,
        input: { source: "request" },
        evaluate: { agent_role: "code-reviewer", criteria: ["CODE_CORRECTNESS"], threshold: GATE_THRESHOLD, onFail },
      },
      {
        id: "after",
        name: "After gate",
        agent_role: "senior-coder",
        dependsOn: ["gate"],
        input: { source: "step", stepId: "gate" },
      },
    ],
    output: { from: "after", format: "markdown" },
  });
}
export function gateTestContext(flow: IFlow = gateTestFlow()): IStepExecutionContext {
  return {
    stepType: FlowStepType.GATE,
    step: flow.steps[0],
    flow,
    request: { userPrompt: "Review this", traceId: GATE_TRACE },
    stepRequest: {
      userPrompt: "Review this",
      context: {},
      scenarioId: "gate-halt",
      stepId: "submit",
      flowStepId: "gate",
    },
    flowRunId: "phase205-run",
    startedAt: new Date(),
    flowLogBase: { flowId: flow.id },
  };
}
