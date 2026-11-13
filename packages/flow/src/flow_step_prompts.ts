/**
 * @module FlowStepPrompts
 * @path packages/flow/src/flow_step_prompts.ts
 * @description Pure helpers that decide which steps feed an aggregate step and which output contract a flow step must follow.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts, packages/flow/src/flow_step_io.ts]
 */

import type { IFlow, IFlowStep, IGateEvaluate } from "@exaix/schemas/flow.ts";
import { FLOW_BRANCH_JSON_OUTPUT_INSTRUCTION, FlowOutputFormat, FlowStepType, OutputContract } from "@exaix/core";
import type { IGateConfig } from "@exaix/core/types";

/** The steps an `aggregate` input draws from: an explicit `from`, else the step's `dependsOn`. An explicit `from`
 *  still wins, so a step may legitimately depend on more than it consumes. Returns empty when neither is
 *  specified, which the caller treats as an error rather than silently aggregating nothing. */
export function resolveAggregateSources(step: { input: { from?: string[] }; dependsOn?: string[] }): string[] {
  if (step.input.from?.length) return step.input.from;
  return step.dependsOn ?? [];
}

/** True for a strategy-routed step that is the terminal step of a plan-format flow. */
export function isFinalJsonStrategyStep(step: IFlowStep, flow: IFlow): boolean {
  const outputFrom = flow.output.from;
  return step.strategy !== undefined &&
    flow.output.format === FlowOutputFormat.JSON &&
    (outputFrom === step.id || (Array.isArray(outputFrom) && outputFrom.includes(step.id)));
}

/** Output-shape instruction appended to every AGENT step prompt. */
export function flowStepOutputInstruction(step: IFlowStep, flow: IFlow): string {
  if (step.type === FlowStepType.BRANCH) {
    return `\n\nClassify the input for ${step.name}. ${FLOW_BRANCH_JSON_OUTPUT_INSTRUCTION}\n` +
      `Routing contract: ${JSON.stringify({ branches: step.branches ?? [], default: step.default })}`;
  }
  const planShape = `{"subject": "Flow Step Output", "description": "Structured output for this step", ` +
    `"steps": [{"step": 1, "title": "Step title", "description": "What this step produced"}]}`;
  const from = flow.output?.from;
  const isFinalStep = from === step.id || (Array.isArray(from) && from.includes(step.id));
  const purpose = isFinalStep
    ? "You are the FINAL step of a multi-agent flow: your response's <content> block becomes " +
      "the flow's aggregated output and must parse as a plan."
    : "You are a step in a multi-agent flow: your response's <content> block is consumed " +
      "programmatically by the next step.";
  const overrides =
    `\n\n${purpose}\nThis flow-specific output contract supersedes the agent's default response format. ` +
    `Respond exactly in this format — no other text outside the tags:\n`;
  const jsonRule = `The <content> block MUST be valid JSON: the first character after <content> must be ` +
    `{ and the last before </content> must be }, with no prose, explanation, or markdown ` +
    `fences inside it.`;
  const specialised = step.output_contract !== undefined && step.output_contract !== OutputContract.PLAN;
  const shape = specialised
    ? `<content>\nThe single report object that your response-contract skill defines\n</content>\n`
    : `<content>\n${planShape}\n</content>\n` +
      (step.output_contract === undefined
        ? `If your response-contract skill defines a report shape for this deliverable, ` +
          `<content> holds that single report object instead of the plan shape.\n`
        : "");
  return `${overrides}<thought>\nBrief reasoning (1-3 sentences).\n</thought>\n\n${shape}${jsonRule}`;
}

/** Converts an IGateEvaluate (YAML-facing gate config) to a GateConfig (evaluator input),
 *  preserving all fields including `includeRequestCriteria`. */
export function toGateConfig(evaluate: IGateEvaluate): IGateConfig {
  return {
    agentRole: evaluate.agent_role,
    criteria: evaluate.criteria,
    threshold: evaluate.threshold,
    onFail: evaluate.onFail,
    maxRetries: evaluate.maxRetries ?? 3,
    includeRequestCriteria: evaluate.includeRequestCriteria,
  };
}
