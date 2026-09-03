/**
 * @module GateStepHandler
 * @path packages/flow/src/step_handlers/gate_step_handler.ts
 * @description IFlowStepHandler for GATE step type — extracted from flow_runner.ts executeGateStep.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/step_handlers/step_handler.ts, packages/flow/src/flow_runner.ts]
 */

import type { IFlowStepHandler, IStepExecutionContext } from "./step_handler.ts";
import type { IGateConfig, IGateEvaluator, IGateResult } from "@exaix/core/types";
import type { IWaitStateService } from "../wait_states/wait_state_service.ts";
import type { IMilestoneEmitter } from "@exaix/core/observability";
import type { IExecutionMilestone } from "@exaix/schemas";
import { DomainEventType } from "@exaix/core/events";
import { MILESTONE_APPROVAL_GATE_ENTERED } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { toGateConfig } from "../flow_runner.ts";

/** Mutable reference to pendingWaitStateId so GateStepHandler can set it on the
 *  FlowRunner instance without FlowRunner exposing the field as public. */
export interface IPendingWaitStateRef {
  current: string | undefined;
}

export interface IGateStepHandlerDeps {
  gateEvaluator: IGateEvaluator;
  eventLogger: {
    log(
      eventType: string,
      payload: {
        flowRunId?: string;
        stepId?: string;
        traceId?: string;
        requestId?: string;
        waitStateId?: string;
        resumeToken?: string;
        kind?: string;
      },
    ): void;
  };
  waitStateService?: IWaitStateService;
  milestoneEmitter?: IMilestoneEmitter;
  pendingWaitStateRef: IPendingWaitStateRef;
}

export class GateStepHandler implements IFlowStepHandler {
  readonly stepType = "gate";

  readonly #gateEvaluator: IGateEvaluator;
  readonly #eventLogger: IGateStepHandlerDeps["eventLogger"];
  readonly #waitStateService?: IWaitStateService;
  readonly #milestoneEmitter?: IMilestoneEmitter;
  readonly #pendingWaitStateRef: IPendingWaitStateRef;

  constructor(deps: IGateStepHandlerDeps) {
    this.#gateEvaluator = deps.gateEvaluator;
    this.#eventLogger = deps.eventLogger;
    this.#waitStateService = deps.waitStateService;
    this.#milestoneEmitter = deps.milestoneEmitter;
    this.#pendingWaitStateRef = deps.pendingWaitStateRef;
  }

  async execute(ctx: IStepExecutionContext): Promise<{ thought: string; content: string; raw: string }> {
    const { step, flow, request, stepRequest, flowRunId, startedAt: _startedAt } = ctx;
    if (!step.evaluate) {
      throw new Error("Gate step has no evaluate config");
    }

    const gateConfig = toGateConfig(step.evaluate);
    const effectiveInclude = gateConfig.includeRequestCriteria || flow.settings?.includeRequestCriteria;
    const effectiveGateConfig: IGateConfig = { ...gateConfig, includeRequestCriteria: effectiveInclude ?? false };

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
      0,
      stepRequest.requestAnalysis,
    );

    if (this.#waitStateService && gateResult.score < effectiveGateConfig.threshold && request.traceId) {
      try {
        const ws = await this.#waitStateService.create({
          kind: "plan_approval",
          traceId: request.traceId,
          artifactPath: `Workspace/WaitStates/${request.traceId}/${step.id}.json`,
          resumeToken: crypto.randomUUID(),
          requestedBy: step.agent_role,
          deadlineAt: undefined,
        });
        this.#pendingWaitStateRef.current = ws.waitStateId;
        await this.#eventLogger.log(DomainEventType.WaitStateCreated, {
          flowRunId,
          stepId: step.id,
          waitStateId: ws.waitStateId,
          resumeToken: ws.resumeToken,
          kind: ws.kind,
          traceId: request.traceId,
          ...ctx.flowLogBase,
        });

        await this.#emitMilestone(
          MILESTONE_APPROVAL_GATE_ENTERED,
          request.traceId,
          `Approval gate entered for step ${step.id}`,
          undefined,
          true,
          "Operator approval needed to continue",
        );
      } catch {
        this.#pendingWaitStateRef.current = undefined;
      }
    }

    return {
      thought: "",
      content: gateResult.evaluation.feedback,
      raw: JSON.stringify(gateResult.evaluation),
    };
  }

  async #emitMilestone(
    milestoneType: IExecutionMilestone["milestoneType"],
    traceId: Opt<string, Reason.TraceAbsent>,
    summary: string,
    progressHint?: Opt<IExecutionMilestone["progressHint"], Reason.OptionalContext>,
    requiresAttention = false,
    attentionReason?: Opt<string, Reason.OptionalContext>,
  ): Promise<void> {
    if (!this.#milestoneEmitter) return;
    await this.#milestoneEmitter.emit({
      milestoneId: crypto.randomUUID(),
      traceId: traceId ?? "",
      milestoneType,
      requiresAttention,
      attentionReason,
      progressHint,
      occurredAt: new Date().toISOString(),
      summary,
    });
  }
}
