/**
 * @module ParallelGroupMergeService
 * @path packages/flow/src/parallel_group_merge_service.ts
 * @description Builds the merged parallelGroupResults context attached to a
 *   step's request when it declares mergeFromGroups (Phase 65 fan-in).
 *   Extracted from FlowRunner.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import type { IFlow, IFlowStep, IParallelMergeMode } from "@exaix/schemas/flow.ts";
import { mergeAsContext } from "@exaix/core/func";
import { FLOW_EVENT_PARALLEL_GROUP_MERGE_FAILED } from "@exaix/core";
import type { IFlowEventLogger, IFlowStepRequest, IParallelGroupSummary, IStepResult } from "./flow_runner.ts";
import { FlowExecutionError } from "./flow_runner.ts";

/** Builds fan-in parallelGroupResults for steps that declare mergeFromGroups. */
export class ParallelGroupMergeService {
  constructor(private eventLogger: IFlowEventLogger) {}

  attachParallelGroupResults(
    stepRequest: IFlowStepRequest,
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: { traceId?: string; requestId?: string },
    stepResults: Map<string, IStepResult>,
  ): IFlowStepRequest {
    if (!step.mergeFromGroups?.length) {
      return stepRequest;
    }

    const parallelGroupResults = this.buildParallelGroupSummaries(
      flowRunId,
      step,
      flow,
      originalRequest,
      stepResults,
    );

    return { ...stepRequest, parallelGroupResults };
  }

  private buildParallelGroupSummaries(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: { traceId?: string; requestId?: string },
    stepResults: Map<string, IStepResult>,
  ): Record<string, IParallelGroupSummary> {
    const summaries: Record<string, IParallelGroupSummary> = {};

    for (const groupId of step.mergeFromGroups ?? []) {
      summaries[groupId] = this.buildParallelGroupSummary(
        flowRunId,
        step,
        flow,
        groupId,
        originalRequest,
        stepResults,
      );
    }

    return summaries;
  }

  private buildParallelGroupSummary(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    groupId: string,
    originalRequest: { traceId?: string; requestId?: string },
    stepResults: Map<string, IStepResult>,
  ): IParallelGroupSummary {
    const memberStepIds = this.getParallelGroupMemberStepIds(flow, groupId);
    const mergeMode = this.getParallelGroupMergeMode(step, flow, groupId);
    const memberResults = memberStepIds.map((memberStepId) => {
      const memberResult = stepResults.get(memberStepId);
      if (!memberResult) {
        return this.throwParallelGroupMergeFailure(
          flowRunId,
          step,
          groupId,
          mergeMode,
          originalRequest,
          `Parallel group '${groupId}' is missing result data for step '${memberStepId}'`,
        );
      }
      return { memberStepId, memberResult };
    });

    const completedAt = new Date(
      Math.max(...memberResults.map(({ memberResult }) => memberResult.completedAt.getTime())),
    ).toISOString();
    const successfulResults = memberResults.filter(({ memberResult }) => {
      return memberResult.success && !!memberResult.result?.content;
    });
    const successCount = successfulResults.length;

    const mergedOutput = mergeMode === "manual" ? "" : this.buildAutomaticParallelMergeOutput(
      { flowRunId, step, flow },
      groupId,
      mergeMode,
      originalRequest,
      memberStepIds,
      successfulResults,
    );

    return {
      groupId,
      mergedOutput,
      memberCount: memberStepIds.length,
      successCount,
      completedAt,
    };
  }

  private buildAutomaticParallelMergeOutput(
    ctx: { flowRunId: string; step: IFlowStep; flow: IFlow },
    groupId: string,
    mergeMode: IParallelMergeMode,
    originalRequest: { traceId?: string; requestId?: string },
    memberStepIds: string[],
    successfulResults: Array<{ memberStepId: string; memberResult: IStepResult }>,
  ): string {
    const { flowRunId, step, flow } = ctx;
    if (successfulResults.length !== memberStepIds.length) {
      return this.throwParallelGroupMergeFailure(
        flowRunId,
        step,
        groupId,
        mergeMode,
        originalRequest,
        `Parallel group '${groupId}' cannot be merged automatically because not all members produced successful outputs`,
      );
    }

    const orderedStepIds = this.getOrderedParallelGroupMemberStepIds(flow, groupId, memberStepIds);
    const resultsByStepId = new Map(successfulResults.map((entry) => [entry.memberStepId, entry.memberResult]));
    const orderedOutputs = orderedStepIds.map((memberStepId) => {
      const result = resultsByStepId.get(memberStepId);
      if (!result?.result?.content) {
        return this.throwParallelGroupMergeFailure(
          flowRunId,
          step,
          groupId,
          mergeMode,
          originalRequest,
          `Parallel group '${groupId}' is missing merged output content for step '${memberStepId}'`,
        );
      }
      return result.result.content;
    });

    return mergeMode === "concat" ? orderedOutputs.join("\n\n") : mergeAsContext(orderedOutputs);
  }

  private getParallelGroupMemberStepIds(flow: IFlow, groupId: string): string[] {
    return flow.steps
      .filter((candidateStep) => candidateStep.parallel?.group === groupId)
      .map((candidateStep) => candidateStep.id);
  }

  private getParallelGroupMergeMode(
    step: IFlowStep,
    flow: IFlow,
    groupId: string,
  ): IParallelMergeMode {
    const groupStep = flow.steps.find((candidateStep) => candidateStep.parallel?.group === groupId);
    return (step.mergeMode ?? groupStep?.parallel?.mergeMode ?? "all") as IParallelMergeMode;
  }

  private getOrderedParallelGroupMemberStepIds(flow: IFlow, groupId: string, memberStepIds: string[]): string[] {
    const explicitOrder = flow.steps.find((candidateStep) => candidateStep.parallel?.group === groupId)?.parallel
      ?.order;
    if (explicitOrder?.length) {
      return [...explicitOrder];
    }

    return [...memberStepIds].sort((left, right) => left.localeCompare(right));
  }

  private throwParallelGroupMergeFailure(
    flowRunId: string,
    step: IFlowStep,
    groupId: string,
    mergeMode: string,
    originalRequest: { traceId?: string; requestId?: string },
    error: string,
  ): never {
    this.eventLogger.log(FLOW_EVENT_PARALLEL_GROUP_MERGE_FAILED, {
      flowRunId,
      stepId: step.id,
      groupId,
      mergeMode,
      error,
      traceId: originalRequest.traceId,
      requestId: originalRequest.requestId,
    });

    throw new FlowExecutionError(error, flowRunId);
  }
}
