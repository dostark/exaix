/**
 * @module FlowStepIo
 * @path packages/flow/src/flow_step_io.ts
 * @description Builds the prompt and input of a flow step and formats its success and failure result.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import type { ParallelGroupMergeService } from "./parallel_group_merge_service.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { JSONValue } from "@exaix/core";
import { FlowInputSource, FlowStepSkipCode, FlowStepType } from "@exaix/core";
import type { IPendingWaitStateRef } from "./step_handlers/gate_step_handler.ts";
import type { StepOutputFormatter } from "./step_output_formatter.ts";
import type { FlowNamespaceCoordinator } from "./flow_namespace_coordinator.ts";
import { getProviderFailureReason } from "@exaix/ai";
import { DomainEventType } from "@exaix/core/events";
import { DEFAULT_UNKNOWN_LABEL, MILESTONE_FLOW_STEP_COMPLETED } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type {
  IFlowEventLogger,
  IFlowOriginalRequest,
  IFlowStepRequest,
  IFormatStepSuccessContext,
  IStepNamespaceWrites,
  IStepRecoveryMetadata,
  IStepResult,
} from "./flow_types.ts";
import type { EmitFlowMilestone } from "./flow_types.ts";
import { flowStepOutputInstruction, isFinalJsonStrategyStep, resolveAggregateSources } from "./flow_step_prompts.ts";

// unslop-ignore-next-line unused-type
/** What the step input and output handling of one flow runner needs from it. */
export interface IFlowStepIoDependencies {
  readonly eventLogger: IFlowEventLogger;
  readonly namespaceCoordinator: FlowNamespaceCoordinator;
  readonly parallelGroupMergeService: ParallelGroupMergeService;
  readonly pendingWaitStateRef: IPendingWaitStateRef;
  readonly stepOutputFormatter: StepOutputFormatter;
  readonly emitMilestone: EmitFlowMilestone;
}

/** Builds the request of each step and formats its success and failure results. */
export class FlowStepIo {
  private readonly eventLogger: IFlowEventLogger;
  private readonly namespaceCoordinator: FlowNamespaceCoordinator;
  private readonly parallelGroupMergeService: ParallelGroupMergeService;
  private readonly pendingWaitStateRef: IPendingWaitStateRef;
  private readonly stepOutputFormatter: StepOutputFormatter;
  private readonly emitMilestone: EmitFlowMilestone;

  constructor(dependencies: IFlowStepIoDependencies) {
    this.eventLogger = dependencies.eventLogger;
    this.namespaceCoordinator = dependencies.namespaceCoordinator;
    this.parallelGroupMergeService = dependencies.parallelGroupMergeService;
    this.pendingWaitStateRef = dependencies.pendingWaitStateRef;
    this.stepOutputFormatter = dependencies.stepOutputFormatter;
    this.emitMilestone = dependencies.emitMilestone;
  }

  /**
   * Format successful step result
   */
  formatStepSuccess(
    ctx: IFormatStepSuccessContext,
    result: IAgentExecutionResult,
    recoveryMetadata?: Opt<IStepRecoveryMetadata, Reason.OptionalInput>,
    namespaceWrites?: Opt<IStepNamespaceWrites, Reason.OptionalInput>,
  ): IStepResult {
    const { flowRunId, step, request, startedAt } = ctx;
    const completedAt = new Date();
    // Clock corrections must not invalidate nonnegative checkpoint durations.
    const duration = Math.max(0, completedAt.getTime() - startedAt.getTime());

    this.eventLogger.log(DomainEventType.FlowStepCompleted, {
      flowRunId,
      stepId: step.id,
      agentRole: step.agent_role,
      success: true,
      duration,
      outputLength: result.content.length,
      hasThought: !!result.thought,
      strategy: step.strategy,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    void this.emitMilestone(MILESTONE_FLOW_STEP_COMPLETED, request.traceId, `Step ${step.name || step.id} completed`, {
      currentStepLabel: step.name || step.id,
    });

    const waitStateId = this.pendingWaitStateRef.current;
    this.pendingWaitStateRef.current = undefined;

    return {
      stepId: step.id,
      success: true,
      result,
      duration,
      startedAt,
      completedAt,
      namespaceWrites,
      waitStateId,
      ...recoveryMetadata,
    };
  }

  /**
   * Format failed step result
   */
  formatStepFailure<TError>(
    flowRunId: string,
    step: IFlowStep,
    request: IFlowOriginalRequest,
    error: TError,
    startedAt: Date,
  ): IStepResult {
    const completedAt = new Date();
    const duration = Math.max(0, completedAt.getTime() - startedAt.getTime());
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.constructor.name : DEFAULT_UNKNOWN_LABEL;
    const providerReasonCode = error instanceof Error ? getProviderFailureReason(error) : undefined;

    this.eventLogger.log(DomainEventType.FlowStepFailed, {
      flowRunId,
      stepId: step.id,
      agentRole: step.agent_role,
      error: errorMessage,
      errorType,
      duration,
      ...(providerReasonCode ? { providerReasonCode } : {}),
      traceId: request.traceId,
      requestId: request.requestId,
    });

    return {
      stepId: step.id,
      success: false,
      error: errorMessage,
      errorCode: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined,
      ...(providerReasonCode ? { providerReasonCode } : {}),
      duration,
      startedAt,
      completedAt,
    };
  }

  /**
   * Prepare the request for a step execution
   */
  async prepareStepRequest(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: IFlowOriginalRequest & { scenarioId?: string; stepId?: string },
    stepResults: Map<string, IStepResult>,
  ): Promise<IFlowStepRequest> {
    const inputData = this.collectStepInputData(step, originalRequest, stepResults);
    const userPrompt = await this.buildStepUserPrompt(flowRunId, step, flow, originalRequest, inputData);

    // Merge skills: step-level skills override flow-level defaults
    const skills = step.skills ?? flow.defaultSkills;

    // Log input.prepared event for test visibility
    await this.eventLogger.log(DomainEventType.FlowStepInputPrepared, {
      flowRunId,
      stepId: step.id,
      hasSkills: !!skills && Array.isArray(skills) ? skills.length > 0 : !!skills,
      traceId: originalRequest.traceId,
      requestId: originalRequest.requestId,
    });

    const stepRequest: IFlowStepRequest = {
      userPrompt,
      context: {},
      traceId: originalRequest.traceId,
      requestId: originalRequest.requestId,
      scenarioId: originalRequest.scenarioId,
      stepId: originalRequest.stepId,
      flowStepId: step.id,
      ...(originalRequest.recording ? { recording: originalRequest.recording } : {}),
      flowOutputKind: step.type === FlowStepType.BRANCH ? "branch-json" : undefined,
      outputContract: step.output_contract,
      flowId: originalRequest.flowId ?? flow.id,
      bindingSnapshot: originalRequest.bindingSnapshot,
      skills,
      requestAnalysis: originalRequest.requestAnalysis,
      portal: originalRequest.portal,
      expectPlanJsonOutput: isFinalJsonStrategyStep(step, flow),
      effort: step.effort,
      thinking: step.thinking,
    };

    const stepRequestWithParallelGroups = this.parallelGroupMergeService.attachParallelGroupResults(
      stepRequest,
      flowRunId,
      step,
      flow,
      originalRequest,
      stepResults,
    );

    return await this.namespaceCoordinator.attachSharedNamespace(
      stepRequestWithParallelGroups,
      flowRunId,
      step,
      flow,
      originalRequest,
    );
  }

  private collectStepInputData(
    step: IFlowStep,
    originalRequest: { userPrompt: string },
    stepResults: Map<string, IStepResult>,
  ): string {
    switch (step.input.source) {
      case FlowInputSource.REQUEST:
        return originalRequest.userPrompt;

      case FlowInputSource.STEP:
        return this.getStepResultContent(step, step.input.stepId, stepResults);

      case "aggregate":
        return this.getAggregatedStepInput(step, stepResults);

      default:
        throw new Error(`Invalid input source: ${step.input.source}`);
    }
  }

  private getStepResultContent(
    step: IFlowStep,
    sourceStepId: Opt<string, Reason.OptionalInput>,
    stepResults: Map<string, IStepResult>,
  ): string {
    if (!sourceStepId) {
      throw new Error(`Step ${step.id} has source "step" but no stepId specified`);
    }

    const sourceResult = stepResults.get(sourceStepId);
    if (!sourceResult?.result) {
      throw new Error(`Step ${step.id} depends on ${sourceStepId} which has no result`);
    }

    return sourceResult.result.content;
  }

  private getAggregatedStepInput(
    step: IFlowStep,
    stepResults: Map<string, IStepResult>,
  ): string {
    const from = resolveAggregateSources(step);

    if (from.length === 0) {
      throw new Error(
        `Step ${step.id} has source "aggregate" but neither "from" nor "dependsOn" names a step to aggregate`,
      );
    }

    const aggregatedInputs = from.filter((id) => stepResults.get(id)?.skipCode !== FlowStepSkipCode.BRANCH_NOT_TAKEN)
      .map((stepId) => this.getStepResultContent(step, stepId, stepResults));
    return aggregatedInputs.length === 1 ? aggregatedInputs[0] : aggregatedInputs.join("\n\n");
  }

  private async buildStepUserPrompt(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: { userPrompt: string; traceId?: string; requestId?: string },
    inputData: string,
  ): Promise<string> {
    const transformStart = Date.now();
    const basePrompt = step.input.transform
      ? this.stepOutputFormatter.applyTransform(
        inputData,
        step.input.transform as string | ((input: string) => string),
        step.input.transformArgs as JSONValue | undefined,
        originalRequest.userPrompt,
      )
      : inputData;

    if (step.input.transform) {
      await this.eventLogger.log(DomainEventType.FlowStepTransformApplied, {
        flowRunId,
        stepId: step.id,
        transformName: typeof step.input.transform === "string" ? step.input.transform : "custom",
        inputSize: inputData.length,
        outputSize: basePrompt.length,
        duration: Math.max(0, Date.now() - transformStart),
        traceId: originalRequest.traceId,
        requestId: originalRequest.requestId,
      });
    }

    const isFinalJsonStep = isFinalJsonStrategyStep(step, flow);

    // Strategy steps normally keep their action-oriented prompt.
    const userPrompt = step.type === FlowStepType.GATE || (step.strategy && !isFinalJsonStep)
      ? basePrompt
      : `${basePrompt}${flowStepOutputInstruction(step, flow)}`;

    return userPrompt;
  }
}
