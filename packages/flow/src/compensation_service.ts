/**
 * @module CompensationService
 * @path packages/flow/src/compensation_service.ts
 * @description Runs onError.compensate tool calls against previously
 *   completed steps when a step fails with the COMPENSATE recovery action.
 *   Extracted from FlowRunner.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import type { JSONValue } from "@exaix/core";
import { FLOW_EVENT_STEP_COMPENSATED, FLOW_EVENT_STEP_COMPENSATION_FAILED } from "@exaix/core";
import type { IMcpClient } from "@exaix/mcp";
import type { Opt, Reason } from "@exaix/core/types";
import type { IFlowEventLogger, IStepResult } from "./flow_runner.ts";

/** Runs compensating tool calls against completed steps after a COMPENSATE failure. */
export class CompensationService {
  constructor(
    private eventLogger: IFlowEventLogger,
    private mcpClient?: Opt<IMcpClient, Reason.OptionalDependency>,
  ) {}

  async executeCompensatingTransactions(
    flowRunId: string,
    failedStep: IFlowStep,
    flow: IFlow,
    request: {
      userPrompt: string;
      traceId?: string;
      requestId?: string;
      portal?: string;
    },
    stepResults: Map<string, IStepResult>,
  ): Promise<void> {
    if (!this.mcpClient) {
      return;
    }

    const completedStepIds = Array.from(stepResults.values())
      .filter((result) => result.success)
      .sort((left, right) => {
        const waveDiff = (right.waveIndex ?? -1) - (left.waveIndex ?? -1);
        if (waveDiff !== 0) {
          return waveDiff;
        }

        const completedAtDiff = right.completedAt.getTime() - left.completedAt.getTime();
        if (completedAtDiff !== 0) {
          return completedAtDiff;
        }

        const leftFlowIndex = flow.steps.findIndex((candidate) => candidate.id === left.stepId);
        const rightFlowIndex = flow.steps.findIndex((candidate) => candidate.id === right.stepId);
        return rightFlowIndex - leftFlowIndex;
      })
      .map((result) => result.stepId);

    for (const completedStepId of completedStepIds) {
      const completedStep = flow.steps.find((candidate) => candidate.id === completedStepId);
      const compensations = completedStep?.onError?.compensate ?? [];

      if (compensations.length > 0) {
        const completedResult = stepResults.get(completedStepId);
        if (completedResult) {
          stepResults.set(completedStepId, {
            ...completedResult,
            compensationRan: true,
          });
        }
      }

      for (const compensation of compensations) {
        const compensationArgs = (compensation.args ?? compensation.params ?? {}) as Record<string, JSONValue>;
        const args: Record<string, JSONValue> = {
          ...(request.portal ? { portal: request.portal } : {}),
          identity_id: completedStep?.identity ?? failedStep.identity,
          ...compensationArgs,
        };

        try {
          const result = await this.mcpClient.callTool(compensation.tool, args);

          await this.eventLogger.log(FLOW_EVENT_STEP_COMPENSATED, {
            flowRunId,
            failedStepId: failedStep.id,
            sourceStepId: completedStepId,
            tool: compensation.tool,
            args,
            success: true,
            result,
            traceId: request.traceId,
            requestId: request.requestId,
          });
        } catch (error) {
          await this.eventLogger.log(FLOW_EVENT_STEP_COMPENSATED, {
            flowRunId,
            failedStepId: failedStep.id,
            sourceStepId: completedStepId,
            tool: compensation.tool,
            args,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            traceId: request.traceId,
            requestId: request.requestId,
          });

          await this.eventLogger.log(FLOW_EVENT_STEP_COMPENSATION_FAILED, {
            flowRunId,
            failedStepId: failedStep.id,
            sourceStepId: completedStepId,
            tool: compensation.tool,
            args,
            error: error instanceof Error ? error.message : String(error),
            traceId: request.traceId,
            requestId: request.requestId,
          });
        }
      }
    }
  }
}
