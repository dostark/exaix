/**
 * @module BranchStepHandler
 * @path packages/flow/src/step_handlers/branch_step_handler.ts
 * @description Classifies branch output and selects one target through safe conditions.
 * @architectural-layer Flows
 * @dependencies [@exaix/core]
 * @related-files [packages/flow/src/flow_runner.ts, packages/flow/src/condition_evaluator.ts]
 */
import { JSONValueSchema } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { repairJSON } from "@exaix/core/func";
import type { JSONValue } from "@exaix/core";
import type { IFlowEventLogger } from "../flow_runner.ts";
import type { IBranchExecutionResult } from "../contracts/flow_control_state.ts";
import { ConditionEvaluator, type IConditionContext } from "../condition_evaluator.ts";
import {
  BRANCH_CONDITION_ERROR_CODE,
  BRANCH_NO_MATCH_CODE,
  BRANCH_OUTPUT_UNPARSEABLE_CODE,
  FlowControlError,
} from "../errors/flow_control_errors.ts";
import type { AgentStepHandler } from "./agent_step_handler.ts";
import type { IFlowStepHandler, IStepExecutionContext } from "./step_handler.ts";

/** @visible Emits flow.branch.decided when classification selects a target. */
export class BranchStepHandler implements IFlowStepHandler {
  readonly stepType = "branch";
  constructor(private readonly agent: AgentStepHandler, private readonly logger: IFlowEventLogger) {}
  async execute(ctx: IStepExecutionContext): Promise<IBranchExecutionResult> {
    if (!ctx.conditionContext) {
      throw new FlowControlError(BRANCH_CONDITION_ERROR_CODE, "Branch requires a prepared condition context");
    }
    return await this.decideBranch(ctx, ctx.conditionContext);
  }
  async decideBranch(ctx: IStepExecutionContext, conditionContext: IConditionContext): Promise<IBranchExecutionResult> {
    const result = await this.agent.execute(ctx);
    const data = parseBranchOutput(result.content);
    const own = { success: true, content: result.content, data, duration: Date.now() - ctx.startedAt.getTime() };
    const context: IConditionContext = {
      ...conditionContext,
      results: { ...conditionContext.results, [ctx.step.id]: own },
      steps: [...conditionContext.steps.filter((step) => step.id !== ctx.step.id), { id: ctx.step.id, ...own }],
    };
    const evaluator = new ConditionEvaluator();
    let chosen: string | undefined;
    for (const branch of ctx.step.branches ?? []) {
      const evaluation = evaluator.evaluate(branch.condition, context);
      if (evaluation.error) {
        throw new FlowControlError(BRANCH_CONDITION_ERROR_CODE, `Branch '${ctx.step.id}': ${evaluation.error}`);
      }
      if (evaluation.shouldExecute) {
        chosen = branch.goto;
        break;
      }
    }
    chosen ??= ctx.step.default;
    if (!chosen) throw new FlowControlError(BRANCH_NO_MATCH_CODE, `Branch '${ctx.step.id}' has no matching target`);
    const notTaken = [
      ...new Set([
        ...(ctx.step.branches ?? []).map((branch) => branch.goto),
        ...(ctx.step.default ? [ctx.step.default] : []),
      ]),
    ].filter((target) => target !== chosen);
    const decision = { branchId: ctx.step.id, chosen, notTaken, data };
    await this.logger.log(DomainEventType.FlowBranchDecided, {
      flowRunId: ctx.flowRunId,
      stepId: ctx.step.id,
      chosen,
      notTaken,
      data,
      traceId: ctx.request.traceId,
      requestId: ctx.request.requestId,
    });
    return { ...result, decision };
  }
}
export function parseBranchOutput(content: string): JSONValue {
  const stripped = content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  try {
    return JSONValueSchema.parse(JSON.parse(stripped));
  } catch {
    try {
      return JSONValueSchema.parse(JSON.parse(repairJSON(stripped).repaired));
    } catch {
      throw new FlowControlError(BRANCH_OUTPUT_UNPARSEABLE_CODE, "Branch output must contain classification JSON");
    }
  }
}
