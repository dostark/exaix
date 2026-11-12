/**
 * @module FlowStepRecovery
 * @path packages/flow/src/flow_step_recovery.ts
 * @description Recovers a failed flow step: retry attempts, the fallback step, compensation and the terminal failure result.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import type { IFlowStep } from "@exaix/schemas/flow.ts";
import type { RetryBudgetService } from "./retry_budget_service.ts";
import type { CompensationService } from "./compensation_service.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import { getProviderFailureReason } from "@exaix/ai";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  DEFAULT_UNKNOWN_LABEL,
  FLOW_EVENT_STEP_FALLBACK,
  FLOW_EVENT_STEP_RETRY,
  FlowStepOnErrorAction,
  type StepAttemptClass,
} from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { FlowControlError, FlowGateHaltedError } from "./errors/flow_control_errors.ts";
import { ContextBudgetExceededError } from "@exaix/core/errors";
import type { ExecuteFlowStep } from "./flow_types.ts";
import type {
  IFlowEventLogger,
  IFlowOriginalRequest,
  IStepContext,
  IStepNamespaceWrites,
  IStepResult,
} from "./flow_types.ts";
import type { FlowStepIo } from "./flow_step_io.ts";
import { FlowAbortError } from "./flow_errors.ts";

// unslop-ignore-next-line unused-type
/** What the step failure recovery of one flow runner needs from it. */
export interface IFlowStepRecoveryDependencies {
  readonly compensationService: CompensationService;
  readonly eventLogger: IFlowEventLogger;
  readonly retryBudgetService: RetryBudgetService;
  readonly stepIo: FlowStepIo;
  readonly executeStep: ExecuteFlowStep;
  readonly runStepAttempt: (
    ctx: IStepContext,
    attemptClass?: Opt<StepAttemptClass, Reason.SensibleDefault>,
  ) => Promise<{ result: IAgentExecutionResult; namespaceWrites?: IStepNamespaceWrites }>;
}

/** Recovers a failed flow step through retries, fallbacks and compensation. */
export class FlowStepRecovery {
  private readonly compensationService: CompensationService;
  private readonly eventLogger: IFlowEventLogger;
  private readonly retryBudgetService: RetryBudgetService;
  private readonly stepIo: FlowStepIo;
  private readonly executeStep: ExecuteFlowStep;
  private readonly runStepAttempt: IFlowStepRecoveryDependencies["runStepAttempt"];

  constructor(dependencies: IFlowStepRecoveryDependencies) {
    this.compensationService = dependencies.compensationService;
    this.eventLogger = dependencies.eventLogger;
    this.retryBudgetService = dependencies.retryBudgetService;
    this.stepIo = dependencies.stepIo;
    this.executeStep = dependencies.executeStep;
    this.runStepAttempt = dependencies.runStepAttempt;
  }

  /**
   * Apply retry, fallback, or abort recovery policy after a step failure.
   */
  async handleStepFailureRecovery<TError>(
    ctx: IStepContext,
    initialError: TError,
  ): Promise<IStepResult> {
    const { flowRunId, step, request, startedAt } = ctx;
    if (initialError instanceof FlowGateHaltedError || initialError instanceof FlowControlError) {
      return this.stepIo.formatStepFailure(flowRunId, step, request, initialError, startedAt);
    }
    if (
      initialError instanceof ContextBudgetExceededError ||
      (initialError instanceof Error && getProviderFailureReason(initialError) !== undefined)
    ) {
      return await this.handleTerminalConfigurationFailure(ctx, initialError);
    }
    if (!step.onError) {
      return this.stepIo.formatStepFailure(flowRunId, step, request, initialError, startedAt);
    }

    if (step.onError.action === FlowStepOnErrorAction.RETRY) {
      return await this.retryStepAttempts(ctx, initialError);
    }

    if (step.onError.action === FlowStepOnErrorAction.FALLBACK) {
      return await this.runFallbackStep(ctx, initialError);
    }

    return await this.finishStepFailure(ctx, initialError);
  }

  private async runFallbackStep<TError>(
    ctx: IStepContext,
    originalError: TError,
  ): Promise<IStepResult> {
    const { flowRunId, step, flow, request, stepResults, startedAt } = ctx;
    const fallbackStepId = step.onError?.fallbackStep;
    const fallbackStep = fallbackStepId ? flow.steps.find((candidate) => candidate.id === fallbackStepId) : null;
    if (!fallbackStep) {
      return await this.finishStepFailure(
        ctx,
        new Error(`Fallback step not found for ${step.id}: ${fallbackStepId ?? DEFAULT_UNKNOWN_LABEL}`),
      );
    }
    await this.eventLogger.log(FLOW_EVENT_STEP_FALLBACK, {
      flowRunId,
      stepId: step.id,
      agentRole: step.agent_role,
      fallbackStepId: fallbackStep.id,
      fallbackAgentRole: fallbackStep.agent_role,
      error: originalError instanceof Error ? originalError.message : String(originalError),
      traceId: request.traceId,
      requestId: request.requestId,
    });
    try {
      const fallbackResult = await this.executeStep(flowRunId, fallbackStep.id, flow, request, stepResults);
      return this.mapFallbackResultToPrimaryResult(
        flowRunId,
        step,
        fallbackStep,
        request,
        fallbackResult,
        startedAt,
      );
    } catch (fallbackError) {
      if (fallbackError instanceof FlowAbortError) throw fallbackError;
      return await this.finishStepFailure(ctx, fallbackError);
    }
  }

  private async retryStepAttempts<TError>(
    ctx: IStepContext,
    initialError: TError,
  ): Promise<IStepResult> {
    const { flowRunId, step, request } = ctx;
    const maxRetries = step.onError?.maxRetries ?? 1;
    const retryBackoffMs = step.onError?.backoffMs ?? DEFAULT_FLOW_STEP_BACKOFF_MS;
    let readLastErrorMessage = () => initialError instanceof Error ? initialError.message : String(initialError);
    for (let retryAttempt = 1; retryAttempt <= maxRetries; retryAttempt++) {
      await this.retryBudgetService.enforceRetryCostBudget(flowRunId, request);
      await this.eventLogger.log(FLOW_EVENT_STEP_RETRY, {
        flowRunId,
        stepId: step.id,
        agentRole: step.agent_role,
        attempt: retryAttempt,
        maxRetries,
        error: readLastErrorMessage(),
        traceId: request.traceId,
        requestId: request.requestId,
      });
      await this.retryBudgetService.applyRetryBackoff(retryBackoffMs, retryAttempt);
      try {
        const retryOutcome = await this.runStepAttempt(ctx);
        return this.stepIo.formatStepSuccess(
          ctx,
          retryOutcome.result,
          { wasRetried: true, retryCount: retryAttempt },
          retryOutcome.namespaceWrites,
        );
      } catch (retryError) {
        if (
          retryError instanceof ContextBudgetExceededError ||
          (retryError instanceof Error && getProviderFailureReason(retryError) !== undefined) ||
          !(retryAttempt + 1 <= maxRetries)
        ) return await this.finishRetryFailure(ctx, retryError);
        readLastErrorMessage = () => retryError instanceof Error ? retryError.message : String(retryError);
      }
    }
    return await this.finishRetryFailure(ctx, initialError);
  }

  private async finishRetryFailure<TError>(ctx: IStepContext, error: TError): Promise<IStepResult> {
    if (
      error instanceof ContextBudgetExceededError ||
      (error instanceof Error && getProviderFailureReason(error) !== undefined)
    ) return await this.handleTerminalConfigurationFailure(ctx, error);
    return await this.finishStepFailure(ctx, error);
  }

  private async handleTerminalConfigurationFailure<TError>(
    ctx: IStepContext,
    error: TError,
  ): Promise<IStepResult> {
    return await this.finishStepFailure(ctx, error);
  }

  private async finishStepFailure<TError>(
    ctx: IStepContext,
    error: TError,
  ): Promise<IStepResult> {
    const { flowRunId, step, flow, request, stepResults, startedAt } = ctx;
    const failureResult = this.stepIo.formatStepFailure(flowRunId, step, request, error, startedAt);
    if (step.onError?.action === FlowStepOnErrorAction.COMPENSATE) {
      await this.compensationService.executeCompensatingTransactions(flowRunId, step, flow, request, stepResults);
    }
    if (step.onError?.action === FlowStepOnErrorAction.ABORT) {
      throw new FlowAbortError(
        step.id,
        failureResult.error ?? DEFAULT_UNKNOWN_ERROR_MESSAGE,
        flowRunId,
        failureResult,
      );
    }
    return failureResult;
  }

  private mapFallbackResultToPrimaryResult(
    flowRunId: string,
    step: IFlowStep,
    fallbackStep: IFlowStep,
    request: IFlowOriginalRequest,
    fallbackResult: IStepResult,
    startedAt: Date,
  ): IStepResult {
    if (!fallbackResult.success) {
      return this.stepIo.formatStepFailure(
        flowRunId,
        { ...step, agent_role: fallbackStep.agent_role },
        request,
        fallbackResult.error ?? DEFAULT_UNKNOWN_ERROR_MESSAGE,
        startedAt,
      );
    }

    if (fallbackResult.skipped || !fallbackResult.result) {
      return {
        ...fallbackResult,
        stepId: step.id,
        fallbackUsed: true,
      };
    }

    return this.stepIo.formatStepSuccess(
      { flowRunId, step: { ...step, agent_role: fallbackStep.agent_role }, request, startedAt },
      fallbackResult.result,
      {
        fallbackUsed: true,
        wasRetried: fallbackResult.wasRetried,
        retryCount: fallbackResult.retryCount,
      },
      fallbackResult.namespaceWrites,
    );
  }
}
