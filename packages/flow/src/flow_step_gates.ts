/**
 * @module FlowStepGates
 * @path packages/flow/src/flow_step_gates.ts
 * @description Evaluates the run condition of a flow step, drives its gate loop and runs the step logic.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import { BranchStepHandler } from "./step_handlers/branch_step_handler.ts";
import { computeLoopBody } from "./loop_body.ts";
import { runGateLoop } from "./gate_loop_coordinator.ts";
import { finalizeStepResult } from "./step_result_finalizer.ts";
import type { RetryBudgetService } from "./retry_budget_service.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { ConditionEvaluator } from "./condition_evaluator.ts";
import {
  FLOW_EVENT_STEP_SKIPPED,
  FlowGateAction,
  FlowStepSkipCode,
  FlowStepType,
  MILESTONE_FLOW_STEP_SKIPPED,
} from "@exaix/core";
import type { IGateResult } from "@exaix/core/types";
import { gateEvaluationResult } from "./errors/flow_control_errors.ts";
import { GateStepHandler } from "./step_handlers/gate_step_handler.ts";
import { UnknownFlowStepError } from "./step_handlers/flow_step_error.ts";
import type { IStepExecutionContext } from "./step_handlers/step_handler.ts";
import type { FlowCheckpointCoordinator } from "./flow_checkpoint_coordinator.ts";
import type { FlowNamespaceCoordinator } from "./flow_namespace_coordinator.ts";
import { DomainEventType } from "@exaix/core/events";
import type { ExecuteFlowStep } from "./flow_types.ts";
import type {
  EmitFlowMilestone,
  IFlowEventLogger,
  IFlowOriginalRequest,
  IFlowStepRequest,
  IStepContext,
  IStepResult,
} from "./flow_types.ts";
import { getFlowLogBase } from "./flow_log_base.ts";
import type { FlowStepHandlerRegistry } from "./step_handlers/step_handler_registry.ts";
import type { FlowControlStateStore } from "./flow_control_state_store.ts";
import { toGateConfig } from "./flow_step_prompts.ts";

// unslop-ignore-next-line unused-type
/** What the condition and gate evaluation of one flow runner needs from it. */
export interface IFlowStepGatesDependencies {
  readonly checkpointCoordinator: FlowCheckpointCoordinator;
  readonly conditionEvaluator: ConditionEvaluator;
  readonly controlStateStore: FlowControlStateStore;
  readonly eventLogger: IFlowEventLogger;
  readonly namespaceCoordinator: FlowNamespaceCoordinator;
  readonly retryBudgetService: RetryBudgetService;
  readonly stepHandlerRegistry: FlowStepHandlerRegistry;
  readonly emitMilestone: EmitFlowMilestone;
  readonly executeStep: ExecuteFlowStep;
  readonly prepareStepRequest: (
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: IFlowOriginalRequest & { scenarioId?: string; stepId?: string },
    stepResults: Map<string, IStepResult>,
  ) => Promise<IFlowStepRequest>;
}

/** Evaluates the condition of a step and drives its gate loop. */
export class FlowStepGates {
  private readonly checkpointCoordinator: FlowCheckpointCoordinator;
  private readonly conditionEvaluator: ConditionEvaluator;
  private readonly controlStateStore: FlowControlStateStore;
  private readonly eventLogger: IFlowEventLogger;
  private readonly namespaceCoordinator: FlowNamespaceCoordinator;
  private readonly retryBudgetService: RetryBudgetService;
  private readonly stepHandlerRegistry: FlowStepHandlerRegistry;
  private readonly emitMilestone: EmitFlowMilestone;
  private readonly executeStep: ExecuteFlowStep;
  private readonly prepareStepRequest: IFlowStepGatesDependencies["prepareStepRequest"];

  constructor(dependencies: IFlowStepGatesDependencies) {
    this.checkpointCoordinator = dependencies.checkpointCoordinator;
    this.conditionEvaluator = dependencies.conditionEvaluator;
    this.controlStateStore = dependencies.controlStateStore;
    this.eventLogger = dependencies.eventLogger;
    this.namespaceCoordinator = dependencies.namespaceCoordinator;
    this.retryBudgetService = dependencies.retryBudgetService;
    this.stepHandlerRegistry = dependencies.stepHandlerRegistry;
    this.emitMilestone = dependencies.emitMilestone;
    this.executeStep = dependencies.executeStep;
    this.prepareStepRequest = dependencies.prepareStepRequest;
  }

  /**
   * Evaluate step condition and return skip result if condition fails
   */
  async evaluateStepCondition(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    stepResults: Map<string, IStepResult>,
    request: IFlowOriginalRequest,
    startedAt: Date,
  ): Promise<IStepResult | null> {
    if (!step.condition) {
      return null;
    }

    const conditionResult = this.conditionEvaluator.evaluateStepCondition(step, stepResults, request, flow);

    await this.eventLogger.log(DomainEventType.FlowStepConditionEvaluated, {
      flowRunId,
      stepId: step.id,
      condition: step.condition,
      shouldExecute: conditionResult.shouldExecute,
      error: conditionResult.error,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    if (!conditionResult.shouldExecute) {
      const completedAt = new Date();
      const duration = Math.max(0, completedAt.getTime() - startedAt.getTime());

      await this.eventLogger.log(FLOW_EVENT_STEP_SKIPPED, {
        flowRunId,
        stepId: step.id,
        condition: step.condition,
        skipCode: FlowStepSkipCode.CONDITION,
        reason: conditionResult.error || "Condition evaluated to false",
        traceId: request.traceId,
        requestId: request.requestId,
      });

      await this.emitMilestone(
        MILESTONE_FLOW_STEP_SKIPPED,
        request.traceId,
        `Step ${step.name || step.id} skipped: ${conditionResult.error || "Condition not met"}`,
      );

      return {
        stepId: step.id,
        success: true,
        skipped: true,
        skipCode: FlowStepSkipCode.CONDITION,
        skipReason: conditionResult.error || `Condition "${step.condition}" evaluated to false`,
        duration,
        startedAt,
        completedAt,
      };
    }

    return null;
  }

  private async executeGateLoop(
    ctx: IStepExecutionContext,
    handler: GateStepHandler,
    flow: IFlow,
    request: IFlowOriginalRequest,
    stepResults: Map<string, IStepResult>,
  ): Promise<IGateResult> {
    const bodyIds = computeLoopBody(flow, ctx.step);
    const run = this.controlStateStore.get(stepResults);
    const flowContentHash = run.flowContentHash;
    const restored = run.state.gates[ctx.step.id];
    if (restored?.phase === "settled" && restored.result) return restored.result;
    const save = () =>
      this.checkpointCoordinator.saveCheckpointIfEnabled(flow, request, ctx.flowRunId, flowContentHash, stepResults);
    return await runGateLoop(
      bodyIds,
      ctx.step.loop?.backTo ?? ctx.step.input.stepId,
      toGateConfig(ctx.step.evaluate!).maxRetries,
      {
        evaluate: async (attempt) => {
          const stepRequest = attempt === 1
            ? ctx.stepRequest
            : await this.prepareStepRequest(ctx.flowRunId, ctx.step, flow, request, stepResults);
          run.state.gates[ctx.step.id] = {
            gateId: ctx.step.id,
            bodyIds,
            evaluationCount: attempt,
            nextIteration: attempt,
            phase: "evaluating",
            ceiling: run.ceiling,
            fingerprint: await this.controlStateStore.fingerprint(flow, ctx.step, request, stepResults),
          };
          await save();
          const verdict = await handler.evaluateGate({ ...ctx, stepRequest }, attempt, run.ceiling);
          if (verdict.action !== FlowGateAction.RETRY) {
            Object.assign(run.state.gates[ctx.step.id], { phase: "settled", result: verdict });
            await save();
          }
          return verdict;
        },
        admit: async (iteration, verdict) => {
          await this.retryBudgetService.enforceRetryCostBudget(ctx.flowRunId, request);
          run.state.gates[ctx.step.id].phase = "rerunning";
          await save();
          await this.eventLogger.log(DomainEventType.FlowLoopIteration, {
            flowRunId: ctx.flowRunId,
            gateStepId: ctx.step.id,
            backTo: ctx.step.loop?.backTo ?? ctx.step.input.stepId ?? bodyIds[0],
            iteration,
            maxRetries: toGateConfig(ctx.step.evaluate!).maxRetries,
            bodyStepIds: bodyIds,
            previousScore: verdict.score,
            traceId: request.traceId,
            requestId: request.requestId,
          });
        },
        invalidate: () => {
          for (const id of bodyIds) stepResults.delete(id);
        },
        runMember: (id, iteration, feedback) =>
          this.executeStep(ctx.flowRunId, id, flow, request, stepResults, { iteration, feedback }),
        finalize: (result) =>
          finalizeStepResult(
            { flow, request, flowRunId: ctx.flowRunId, flowContentHash, stepResults },
            result,
            this.namespaceCoordinator,
            this.checkpointCoordinator,
          ),
      },
    );
  }

  /**
   * Execute step logic by dispatching to a registered IFlowStepHandler.
   */
  async executeStepLogic(
    stepContext: IStepContext,
    stepRequest: IFlowStepRequest,
  ): Promise<IAgentExecutionResult> {
    const { flowRunId, step, flow, request, startedAt, stepResults } = stepContext;
    const stepType = step.type ?? FlowStepType.AGENT;
    const handler = this.stepHandlerRegistry.get(stepType);
    if (!handler) {
      throw new UnknownFlowStepError(stepType, step.id, this.stepHandlerRegistry.keys());
    }
    const flowLogBase = getFlowLogBase(flow, request);
    const ctx: IStepExecutionContext = {
      stepType,
      step,
      flow: { id: flow.id, name: flow.name, version: flow.version, settings: flow.settings },
      conditionContext: this.conditionEvaluator.buildContext(stepResults, request, flow),
      request: {
        userPrompt: request.userPrompt,
        traceId: request.traceId,
        requestId: request.requestId,
        requestAnalysis: request.requestAnalysis,
        portal: request.portal,
        executionRoot: request.executionRoot,
        planContextRef: request.planContextRef,
      },
      stepRequest: {
        userPrompt: stepRequest.userPrompt,
        context: stepRequest.context ?? {},
        traceId: stepRequest.traceId,
        requestId: stepRequest.requestId,
        scenarioId: stepRequest.scenarioId,
        stepId: stepRequest.stepId,
        flowStepId: stepRequest.flowStepId,
        flowId: stepRequest.flowId,
        flowOutputKind: stepRequest.flowOutputKind,
        recording: stepRequest.recording,
        bindingSnapshot: stepRequest.bindingSnapshot,
        requestAnalysis: stepRequest.requestAnalysis,
        skills: stepRequest.skills,
        sharedNamespace: stepRequest.sharedNamespace,
        parallelGroupResults: stepRequest.parallelGroupResults,
        portal: stepRequest.portal,
        expectPlanJsonOutput: stepRequest.expectPlanJsonOutput,
        effort: stepRequest.effort,
        thinking: stepRequest.thinking,
      },
      flowRunId,
      startedAt,
      flowLogBase,
    };
    if (handler instanceof GateStepHandler) {
      const result = await this.executeGateLoop(ctx, handler, flow, request, stepResults);
      return gateEvaluationResult(step.id, step.evaluate!.threshold, result);
    }
    if (handler instanceof BranchStepHandler) {
      const result = await handler.decideBranch(ctx, ctx.conditionContext!);
      await this.controlStateStore.settleBranch(flow, step, request, stepResults, result);
      const run = this.controlStateStore.get(stepResults);
      await this.checkpointCoordinator.saveCheckpointIfEnabled(
        flow,
        request,
        flowRunId,
        run.flowContentHash,
        stepResults,
      );
      return result;
    }
    return await handler.execute(ctx);
  }
}
