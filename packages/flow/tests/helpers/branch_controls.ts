/**
 * @module BranchControlTestHelpers
 * @path packages/flow/tests/helpers/branch_controls.ts
 * @description Builds routing fixtures and records prepared branch requests.
 * @architectural-layer Test
 * @dependencies [@exaix/flow, @exaix/schemas]
 * @related-files [packages/flow/tests/flow_runner_branch_routing_test.ts]
 */
import { FlowSchema, type IFlow } from "@exaix/schemas/flow.ts";
import type { IAgentExecutor, IFlowStepRequest } from "@exaix/flow";
import type { IAgentExecutionResult } from "@exaix/execution";

export const BRANCH_TRACE = "phase205-branch-trace";
export const BRANCH_OUTPUT = '{"category":"bug","items":[1,2]}';
export class BranchTestAgent implements IAgentExecutor {
  readonly requests: IFlowStepRequest[] = [];
  constructor(public output = BRANCH_OUTPUT) {}
  run(_role: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.requests.push(request);
    const content = request.flowStepId === "classify" ? this.output : `Output ${request.flowStepId}`;
    return Promise.resolve({ thought: "classified", content, raw: content });
  }
}
export function branchTestFlow(): IFlow {
  return FlowSchema.parse({
    id: "branch-routing",
    name: "Branch routing",
    version: "1.0.0",
    description: "Routes one classification",
    settings: { maxParallelism: 1 },
    steps: [
      {
        id: "classify",
        name: "Classify issue",
        type: "branch",
        agent_role: "code-analyst",
        branches: [
          { condition: "results.classify.data.category === 'bug'", goto: "bug" },
          { condition: "results.classify.data.category === 'feature'", goto: "feature" },
        ],
        default: "other",
      },
      ...["bug", "feature", "other"].map((id) => ({
        id,
        name: id,
        agent_role: "senior-coder",
        dependsOn: ["classify"],
        input: { source: "request" },
      })),
      ...["bug", "feature", "other"].map((id) => ({
        id: `${id}-child`,
        name: `${id} child`,
        agent_role: "senior-coder",
        dependsOn: [id],
        input: { source: "step", stepId: id },
      })),
      {
        id: "join",
        name: "Join",
        agent_role: "technical-writer",
        dependsOn: ["bug-child", "feature-child", "other-child"],
        input: { source: "aggregate" },
      },
    ],
    output: { from: "join" },
  });
}
