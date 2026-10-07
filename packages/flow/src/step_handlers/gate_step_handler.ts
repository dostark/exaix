/**
 * @module GateStepHandler
 * @path packages/flow/src/step_handlers/gate_step_handler.ts
 * @description IFlowStepHandler for GATE step type — extracted from flow_runner.ts executeGateStep.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/step_handlers/step_handler.ts, packages/flow/src/flow_runner.ts]
 */

import type { IFlowStepHandler, IStepExecutionContext } from "./step_handler.ts";
import type { IGateConfig, IGateEvaluator, IGateResult } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import type { IBindingGateContext, IBindingStepRef } from "@exaix/schemas";
import { STEP_KIND_GATE } from "@exaix/ai/bindings/binding_types.ts";
import { type IFlowEventLogger, toGateConfig } from "../flow_runner.ts";
import { gateEvaluationResult } from "../errors/flow_control_errors.ts";

/** Stores pending wait-state identity for non-gate flow handlers. */
export interface IPendingWaitStateRef {
  current: string | undefined;
}

export interface IGateStepHandlerDeps {
  gateEvaluator: IGateEvaluator;
  eventLogger: IFlowEventLogger;
}

/** Evaluates gate decisions and emits their trace events.
 * @visible
 */
export class GateStepHandler implements IFlowStepHandler {
  readonly stepType = "gate";

  readonly #gateEvaluator: IGateEvaluator;
  readonly #eventLogger: IGateStepHandlerDeps["eventLogger"];

  constructor(deps: IGateStepHandlerDeps) {
    this.#gateEvaluator = deps.gateEvaluator;
    this.#eventLogger = deps.eventLogger;
  }

  async execute(ctx: IStepExecutionContext): Promise<{ thought: string; content: string; raw: string }> {
    const result = await this.evaluateGate(ctx, 1);
    return gateEvaluationResult(ctx.step.id, ctx.step.evaluate!.threshold, result);
  }

  async evaluateGate(ctx: IStepExecutionContext, attempt: number): Promise<IGateResult> {
    const { step, flow, request, stepRequest, flowRunId } = ctx;
    if (!step.evaluate) {
      throw new Error("Gate step has no evaluate config");
    }

    const gateConfig = toGateConfig(step.evaluate);
    const effectiveInclude = gateConfig.includeRequestCriteria || flow.settings?.includeRequestCriteria;
    const effectiveGateConfig: IGateConfig = {
      ...gateConfig,
      includeRequestCriteria: effectiveInclude ?? false,
      callMetadata: {
        traceId: request.traceId,
        ...(stepRequest.scenarioId && stepRequest.stepId
          ? {
            callSite: {
              scenarioId: stepRequest.scenarioId,
              stepId: stepRequest.stepId,
              flowStepId: step.id,
              callIndex: attempt - 1,
            },
          }
          : {}),
      },
    };

    // A flow gate carries its own judge binding context.
    // It names the gate step and the evaluate.agent_role.
    // The judge runner then acquires the bound provider.
    if (stepRequest.bindingSnapshot) {
      const stepRef: IBindingStepRef = {
        flowId: stepRequest.flowId ?? flow.id,
        stepId: step.id,
        agentRole: step.evaluate.agent_role,
        kind: STEP_KIND_GATE,
        nativeTools: false,
      };
      effectiveGateConfig.bindingContext = {
        stepRef,
        snapshot: stepRequest.bindingSnapshot,
      } satisfies IBindingGateContext;
    }

    if (effectiveGateConfig.includeRequestCriteria && !stepRequest.requestAnalysis) {
      await this.#eventLogger.log(DomainEventType.FlowGateCriteriaNoAnalysis, {
        flowRunId,
        stepId: step.id,
        traceId: request.traceId,
        requestId: request.requestId,
      });
    }

    const gateResult: IGateResult = await this.#gateEvaluator.evaluate(
      effectiveGateConfig,
      stepRequest.userPrompt,
      stepRequest.userPrompt,
      attempt - 1,
      stepRequest.requestAnalysis,
    );

    await this.#eventLogger.log(DomainEventType.FlowGateEvaluated, {
      flowRunId,
      stepId: step.id,
      traceId: request.traceId,
      requestId: request.requestId,
      score: gateResult.score,
      threshold: effectiveGateConfig.threshold,
      passed: gateResult.passed,
      action: gateResult.action,
      attempt: gateResult.attempts,
    });
    return gateResult;
  }
}
