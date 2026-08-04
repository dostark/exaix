/**
 * @module WaveOrchestrator
 * @path packages/flow/src/wave_orchestrator.ts
 * @description Groups a flow's steps into dependency waves and executes each
 *   wave (including same-wave parallel groups), processing settled results
 *   into IStepResult entries and deciding whether the flow can continue.
 *   Extracted from FlowRunner.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import type { IFlow } from "@exaix/schemas/flow.ts";
import { DependencyResolver } from "@exaix/flow";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import { DomainEventType, type IEventRegistry } from "@exaix/core/events";
import {
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  FLOW_EVENT_PARALLEL_GROUP_COMPLETED,
  FLOW_EVENT_PARALLEL_GROUP_STARTED,
  MILESTONE_APPROVAL_GATE_RESOLVED,
  MILESTONE_FLOW_STARTED,
} from "@exaix/core";
import type { IFlowCheckpointCoordinator } from "./flow_checkpoint_coordinator.ts";
import type { IFlowNamespaceCoordinator } from "./flow_namespace_coordinator.ts";
import type { IExecutionMilestone } from "@exaix/schemas";
import type { Opt, Reason } from "@exaix/core/types";
import {
  FlowAbortError,
  FlowExecutionError,
  type IFlowEventLogBase,
  type IFlowEventLogger,
  type IStepResult,
} from "./flow_runner.ts";

type IWaveRequest = {
  userPrompt: string;
  traceId?: string;
  requestId?: string;
  requestAnalysis?: IRequestAnalysis;
  portal?: string;
};

interface IWaveProcessingOutcome {
  successCount: number;
  failureCount: number;
  failed: boolean;
  waveError?: { stepId: string; error: Error | string };
}

/** Shared context for wave-level processing (reduces parameter count across wave methods). */
interface IWaveContext {
  flow: IFlow;
  request: IWaveRequest;
  flowRunId: string;
  flowContentHash: string;
  stepResults: Map<string, IStepResult>;
  failFast: boolean;
}

interface IWaveExecutionUnit {
  stepIds: string[];
  groupId?: string;
}

interface IWaveExecutionResult {
  stepIds: string[];
  results: PromiseSettledResult<IStepResult>[];
}

/** Callbacks WaveOrchestrator needs from FlowRunner: step execution, logging helpers, and milestones. */
export interface IWaveOrchestratorCallbacks {
  executeStepSafe(
    flowRunId: string,
    stepId: string,
    flow: IFlow,
    request: IWaveRequest,
    stepResults: Map<string, IStepResult>,
  ): Promise<IStepResult>;
  getIFlowLogBase(flow: IFlow, request: { traceId?: string; requestId?: string }): IFlowEventLogBase;
  emitMilestone(
    milestoneType: IExecutionMilestone["milestoneType"],
    traceId: Opt<string, Reason.TraceAbsent>,
    summary: string,
    progressHint?: Opt<
      { stepsCompleted?: number; stepsTotal?: number; currentStepLabel?: string },
      Reason.OptionalContext
    >,
  ): Promise<void>;
}

/** Groups steps into dependency waves and executes each wave to completion. */
export class WaveOrchestrator {
  constructor(
    private eventLogger: IFlowEventLogger,
    private checkpointCoordinator: IFlowCheckpointCoordinator,
    private namespaceCoordinator: IFlowNamespaceCoordinator,
    private callbacks: IWaveOrchestratorCallbacks,
    private eventRegistry?: Opt<IEventRegistry, Reason.OptionalDependency>,
  ) {}

  private isPromiseRejectedResult(result: PromiseSettledResult<IStepResult>): result is PromiseRejectedResult {
    return result.status === "rejected";
  }

  private isPromiseFulfilledResult(
    result: PromiseSettledResult<IStepResult>,
  ): result is PromiseFulfilledResult<IStepResult> {
    return result.status === "fulfilled";
  }

  /**
   * Execute waves sequentially with parallel step execution
   */
  async executeWaves(
    flow: IFlow,
    request: IWaveRequest,
    flowRunId: string,
    flowContentHash: string,
    stepResults: Map<string, IStepResult>,
  ): Promise<void> {
    // Log flow start
    await this.eventLogger.log(DomainEventType.FlowStarted, {
      flowRunId,
      maxParallelism: flow.settings?.maxParallelism ?? 3,
      failFast: flow.settings?.failFast ?? true,
      ...this.callbacks.getIFlowLogBase(flow, request),
      stepCount: flow.steps.length,
    });

    await this.callbacks.emitMilestone(MILESTONE_FLOW_STARTED, request.traceId, `Flow ${flow.id} started`, {
      stepsCompleted: 0,
      stepsTotal: flow.steps.length,
    });

    // Resolve dependency graph
    await this.eventLogger.log(DomainEventType.FlowDependenciesResolving, {
      flowRunId,
      ...this.callbacks.getIFlowLogBase(flow, request),
    });

    const resolver = new DependencyResolver(flow.steps);
    const waves = resolver.groupIntoWaves();

    await this.eventLogger.log(DomainEventType.FlowDependenciesResolved, {
      flowRunId,
      waveCount: waves.length,
      totalSteps: flow.steps.length,
      ...this.callbacks.getIFlowLogBase(flow, request),
    });

    const failFast = flow.settings?.failFast ?? true;

    // Execute waves sequentially
    for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
      const wave = waves[waveIndex];
      await this.executeWave({ flow, request, flowRunId, flowContentHash, stepResults, failFast }, wave, waveIndex);

      // If any step created a wait state in this wave, break the loop so the flow
      // can be paused and resumed later. Checkpoint is saved so state is preserved.
      const pendingStepResults = [...stepResults.values()].filter((r) => r.waitStateId);
      const hasPendingWait = pendingStepResults.length > 0;
      if (hasPendingWait) {
        const waitPayload = {
          flowRunId,
          waitStateId: pendingStepResults[0].waitStateId!,
          traceId: request.traceId ?? "",
          stepIds: pendingStepResults.map((r) => r.stepId),
          ...this.callbacks.getIFlowLogBase(flow, request),
        };
        if (this.eventRegistry) {
          await this.eventRegistry.emit("flow_runner", DomainEventType.WaitStateResolved, waitPayload);
        } else {
          await this.eventLogger.log(DomainEventType.WaitStateResolved, waitPayload);
        }
        await this.callbacks.emitMilestone(
          MILESTONE_APPROVAL_GATE_RESOLVED,
          request.traceId,
          `Approval gate resolved for flow ${flow.id}`,
        );
        await this.checkpointCoordinator.saveCheckpointIfEnabled(
          flow,
          request,
          flowRunId,
          flowContentHash,
          stepResults,
        );
        break;
      }
    }
  }

  /**
   * Execute a single wave of steps in parallel
   */
  private async executeWave(
    ctx: IWaveContext,
    wave: string[],
    waveIndex: number,
  ): Promise<void> {
    const waveNumber = waveIndex + 1;

    await this.logWaveStart(ctx.flowRunId, ctx.request, waveNumber, wave);

    const pendingStepIds = wave.filter((stepId) => !ctx.stepResults.has(stepId));

    if (pendingStepIds.length !== wave.length) {
      await this.logSkippedWaveSteps(ctx.flowRunId, ctx.request, waveNumber, wave, ctx.stepResults);
    }

    if (pendingStepIds.length === 0) {
      await this.logCompletedEmptyWave(ctx.flowRunId, ctx.request, waveNumber, wave.length);
      return;
    }

    const waveResults = await this.collectWaveResults(
      ctx.flow,
      ctx.request,
      ctx.flowRunId,
      pendingStepIds,
      ctx.stepResults,
      waveNumber,
    );

    const waveFailed = await this.processWaveResults(
      ctx,
      pendingStepIds,
      waveNumber,
      waveResults,
    );

    this.throwIfWaveCannotContinue(ctx.flowRunId, pendingStepIds, waveResults, waveFailed, ctx.failFast);
  }

  private async logWaveStart(
    flowRunId: string,
    request: { traceId?: string; requestId?: string },
    waveNumber: number,
    wave: string[],
  ): Promise<void> {
    await this.eventLogger.log(DomainEventType.FlowWaveStarted, {
      flowRunId,
      waveNumber,
      waveSize: wave.length,
      stepIds: wave,
      traceId: request.traceId,
      requestId: request.requestId,
    });
  }

  private async logSkippedWaveSteps(
    flowRunId: string,
    request: { traceId?: string; requestId?: string },
    waveNumber: number,
    wave: string[],
    stepResults: Map<string, IStepResult>,
  ): Promise<void> {
    await this.eventLogger.log(DomainEventType.FlowWaveResumeSkipped, {
      flowRunId,
      waveNumber,
      skippedStepIds: wave.filter((stepId) => stepResults.has(stepId)),
      traceId: request.traceId,
      requestId: request.requestId,
    });
  }

  private async logCompletedEmptyWave(
    flowRunId: string,
    request: { traceId?: string; requestId?: string },
    waveNumber: number,
    waveSize: number,
  ): Promise<void> {
    await this.eventLogger.log(DomainEventType.FlowWaveCompleted, {
      flowRunId,
      waveNumber,
      waveSize,
      successCount: waveSize,
      failureCount: 0,
      failed: false,
      traceId: request.traceId,
      requestId: request.requestId,
    });
  }

  private async collectWaveResults(
    flow: IFlow,
    request: IWaveRequest,
    flowRunId: string,
    pendingStepIds: string[],
    stepResults: Map<string, IStepResult>,
    waveNumber: number,
  ): Promise<PromiseSettledResult<IStepResult>[]> {
    const executionUnits = this.buildWaveExecutionUnits(flow, pendingStepIds);
    const executionResults = await Promise.all(
      executionUnits.map((unit) => this.executeWaveUnit(unit, flowRunId, flow, request, stepResults, waveNumber)),
    );
    const waveResultsByStepId = new Map<string, PromiseSettledResult<IStepResult>>();

    for (const executionResult of executionResults) {
      for (let index = 0; index < executionResult.stepIds.length; index++) {
        waveResultsByStepId.set(executionResult.stepIds[index], executionResult.results[index]);
      }
    }

    return pendingStepIds.map((stepId) => {
      const waveResult = waveResultsByStepId.get(stepId);
      if (!waveResult) {
        throw new FlowExecutionError(`Missing execution result for step ${stepId}`, flowRunId);
      }
      return waveResult;
    });
  }

  private throwIfWaveCannotContinue(
    flowRunId: string,
    pendingStepIds: string[],
    waveResults: PromiseSettledResult<IStepResult>[],
    waveFailed: boolean,
    failFast: boolean,
  ): void {
    const abortResult = waveResults.find(
      (result): result is PromiseRejectedResult => {
        return this.isPromiseRejectedResult(result) && result.reason instanceof FlowAbortError;
      },
    );

    if (abortResult) {
      throw abortResult.reason;
    }

    if (!waveFailed || !failFast) {
      return;
    }

    const failedStepIndex = pendingStepIds.findIndex((_stepId, index) => {
      const result = waveResults[index];
      return this.isPromiseRejectedResult(result) ||
        (this.isPromiseFulfilledResult(result) && !result.value.success);
    });
    const failedStepId = pendingStepIds[failedStepIndex];
    const failedResult = waveResults[failedStepIndex];
    const errorMessage = this.getWaveFailureMessage(failedResult);
    throw new FlowExecutionError(`Step ${failedStepId} failed: ${errorMessage}`, flowRunId);
  }

  private getWaveFailureMessage(failedResult: PromiseSettledResult<IStepResult>): string {
    if (this.isPromiseFulfilledResult(failedResult)) {
      return failedResult.value.error || DEFAULT_UNKNOWN_ERROR_MESSAGE;
    }

    if (this.isPromiseRejectedResult(failedResult) && failedResult.reason instanceof Error) {
      return failedResult.reason.message;
    }

    return String((failedResult as PromiseRejectedResult).reason ?? DEFAULT_UNKNOWN_ERROR_MESSAGE);
  }

  private buildWaveExecutionUnits(flow: IFlow, pendingStepIds: string[]): IWaveExecutionUnit[] {
    const stepsById = new Map(flow.steps.map((step) => [step.id, step]));
    const units: IWaveExecutionUnit[] = [];
    const groupedMembers = new Map<string, string[]>();
    const groupOrder: string[] = [];

    for (const stepId of pendingStepIds) {
      const step = stepsById.get(stepId);
      const groupId = step?.parallel?.group;
      if (!groupId) {
        units.push({ stepIds: [stepId] });
        continue;
      }

      const members = groupedMembers.get(groupId);
      if (members) {
        members.push(stepId);
        continue;
      }

      groupedMembers.set(groupId, [stepId]);
      groupOrder.push(groupId);
    }

    for (const groupId of groupOrder) {
      const members = groupedMembers.get(groupId) ?? [];
      if (members.length <= 1) {
        units.push({ stepIds: members });
        continue;
      }
      units.push({ stepIds: members, groupId });
    }

    return units;
  }

  private async executeWaveUnit(
    unit: IWaveExecutionUnit,
    flowRunId: string,
    flow: IFlow,
    request: IWaveRequest,
    stepResults: Map<string, IStepResult>,
    waveNumber: number,
  ): Promise<IWaveExecutionResult> {
    if (!unit.groupId) {
      const result = await Promise.allSettled([
        this.callbacks.executeStepSafe(flowRunId, unit.stepIds[0], flow, request, stepResults),
      ]);
      return { stepIds: unit.stepIds, results: result };
    }

    const groupStartedAt = performance.now();

    await this.eventLogger.log(FLOW_EVENT_PARALLEL_GROUP_STARTED, {
      flowRunId,
      waveNumber,
      groupId: unit.groupId,
      stepIds: unit.stepIds,
      startedAt: groupStartedAt,
      isoStartedAt: new Date().toISOString(),
      traceId: request.traceId,
      requestId: request.requestId,
    });

    const groupStep = flow.steps.find((s) => s.parallel?.group === unit.groupId);
    const groupTimeoutMs = groupStep?.parallel?.timeout_ms;
    const continueOnError = groupStep?.parallel?.continue_on_error ?? false;

    const executionPromise = Promise.allSettled(
      unit.stepIds.map((stepId) => this.callbacks.executeStepSafe(flowRunId, stepId, flow, request, stepResults)),
    );

    const results = groupTimeoutMs
      ? await Promise.race([
        executionPromise,
        new Promise<PromiseSettledResult<IStepResult>[]>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Parallel group '${unit.groupId}' timed out after ${groupTimeoutMs}ms`)),
            groupTimeoutMs,
          )
        ),
      ])
      : await executionPromise;

    const processed = continueOnError
      ? results.map((result) => {
        if (this.isPromiseFulfilledResult(result) && !result.value.success) {
          return {
            ...result,
            value: { ...result.value, success: true, error: undefined },
          } as PromiseFulfilledResult<IStepResult>;
        }
        return result;
      })
      : results;

    const successCount = processed.filter((result) => this.isPromiseFulfilledResult(result) && result.value.success)
      .length;
    const failureCount = processed.length - successCount;

    await this.eventLogger.log(FLOW_EVENT_PARALLEL_GROUP_COMPLETED, {
      flowRunId,
      waveNumber,
      groupId: unit.groupId,
      stepIds: unit.stepIds,
      successCount,
      failureCount,
      failed: failureCount > 0,
      duration: performance.now() - groupStartedAt,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    return { stepIds: unit.stepIds, results: processed };
  }

  /**
   * Process results from a completed wave
   */
  private async processWaveResults(
    ctx: IWaveContext,
    wave: string[],
    waveNumber: number,
    waveResults: PromiseSettledResult<IStepResult>[],
  ): Promise<boolean> {
    let waveFailed = false;
    let waveSuccessCount = 0;
    let waveFailureCount = 0;
    const waveErrors: Array<{ stepId: string; error: Error | string }> = [];
    const namespaceId = this.namespaceCoordinator.getNamespaceId(ctx.request, ctx.flowRunId);

    for (let i = 0; i < wave.length; i++) {
      const outcome = await this.processWaveResultEntry(
        ctx,
        wave[i],
        waveNumber,
        waveResults[i],
        namespaceId,
      );

      waveSuccessCount += outcome.successCount;
      waveFailureCount += outcome.failureCount;
      waveFailed = waveFailed || outcome.failed;
      if (outcome.waveError) {
        waveErrors.push(outcome.waveError);
      }
    }

    // Log wave completion
    await this.eventLogger.log(DomainEventType.FlowWaveCompleted, {
      flowRunId: ctx.flowRunId,
      waveNumber,
      waveSize: wave.length,
      successCount: waveSuccessCount,
      failureCount: waveFailureCount,
      failed: waveFailed,
      traceId: ctx.request.traceId,
      requestId: ctx.request.requestId,
    });

    // Log any wave-level errors
    if (waveErrors.length > 0) {
      await this.eventLogger.log(DomainEventType.FlowWaveErrors, {
        flowRunId: ctx.flowRunId,
        waveNumber,
        errorCount: waveErrors.length,
        errors: waveErrors.map(({ stepId, error }) => ({
          stepId,
          error: error instanceof Error ? error.message : String(error),
        })),
        traceId: ctx.request.traceId,
        requestId: ctx.request.requestId,
      });
    }

    return waveFailed;
  }

  private async processWaveResultEntry(
    ctx: IWaveContext,
    stepId: string,
    waveNumber: number,
    promiseResult: PromiseSettledResult<IStepResult>,
    namespaceId: string,
  ): Promise<IWaveProcessingOutcome> {
    try {
      if (this.isPromiseFulfilledResult(promiseResult)) {
        return await this.handleFulfilledWaveResult(
          ctx,
          stepId,
          waveNumber,
          promiseResult.value,
          namespaceId,
        );
      }

      return this.handleRejectedWaveResult(stepId, waveNumber, promiseResult, ctx.stepResults, ctx.failFast);
    } catch (processingError) {
      return await this.handleWaveProcessingError(
        ctx.flowRunId,
        ctx.request,
        stepId,
        processingError,
        ctx.stepResults,
        ctx.failFast,
      );
    }
  }

  private async handleFulfilledWaveResult(
    ctx: IWaveContext,
    stepId: string,
    waveNumber: number,
    promiseValue: IStepResult,
    namespaceId: string,
  ): Promise<IWaveProcessingOutcome> {
    const result = {
      ...promiseValue,
      waveIndex: waveNumber,
    } satisfies IStepResult;
    ctx.stepResults.set(stepId, result);

    if (!result.success) {
      return { successCount: 0, failureCount: 1, failed: ctx.failFast };
    }

    await this.namespaceCoordinator.persistWaveNamespaceWrites(
      result,
      ctx.request,
      stepId,
      namespaceId,
      ctx.flow.namespace?.enabled === true,
    );
    await this.checkpointCoordinator.saveCheckpointIfEnabled(
      ctx.flow,
      ctx.request,
      ctx.flowRunId,
      ctx.flowContentHash,
      ctx.stepResults,
    );

    return { successCount: 1, failureCount: 0, failed: false };
  }

  private handleRejectedWaveResult(
    stepId: string,
    waveNumber: number,
    promiseResult: PromiseRejectedResult,
    stepResults: Map<string, IStepResult>,
    failFast: boolean,
  ): IWaveProcessingOutcome {
    const error: Error | string = promiseResult.reason instanceof Error
      ? promiseResult.reason
      : String(promiseResult.reason);
    const abortError = promiseResult.reason instanceof FlowAbortError ? promiseResult.reason : null;
    const errorIStepResult: IStepResult = abortError?.failureResult ?? {
      stepId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: 0,
      startedAt: new Date(),
      completedAt: new Date(),
      waveIndex: waveNumber,
    };

    if (abortError?.failureResult) {
      errorIStepResult.waveIndex = waveNumber;
    }

    stepResults.set(stepId, errorIStepResult);
    return {
      successCount: 0,
      failureCount: 1,
      failed: failFast,
      waveError: { stepId, error },
    };
  }

  private async handleWaveProcessingError(
    flowRunId: string,
    request: { traceId?: string; requestId?: string },
    stepId: string,
    processingError: Error | string | unknown,
    stepResults: Map<string, IStepResult>,
    failFast: boolean,
  ): Promise<IWaveProcessingOutcome> {
    const processingErrorMessage = processingError instanceof Error ? processingError.message : String(processingError);
    const previousResult = stepResults.get(stepId);
    if (previousResult?.success) {
      stepResults.set(stepId, {
        ...previousResult,
        success: false,
        result: undefined,
        error: processingErrorMessage,
        namespaceWrites: undefined,
      });
    }

    await this.eventLogger.log(DomainEventType.FlowStepProcessingError, {
      flowRunId,
      stepId,
      error: processingErrorMessage,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    return { successCount: 0, failureCount: 1, failed: failFast };
  }
}
