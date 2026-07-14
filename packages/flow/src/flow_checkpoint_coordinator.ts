/**
 * @module FlowCheckpointCoordinator
 * @path packages/flow/src/flow_checkpoint_coordinator.ts
 * @description Handles flow checkpoint lifecycle: load-and-restore on resume,
 * durability-store migration of restored steps, snapshot save after each wave,
 * and clear on successful flow completion. Extracted from FlowRunner
 * (god-object decomposition, .copilot/skills/refactor/SKILL.md step d) since
 * this logic depends only on checkpointService, stepDurabilityStore, and
 * eventLogger — no other FlowRunner field.
 * @architectural-layer Flows
 * @related-files ["packages/flow/src/flow_runner.ts"]
 */
import type { IFlow, IFlowCheckpoint, IFlowStepResultSnapshot } from "@exaix/schemas/flow.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import {
  FLOW_CHECKPOINT_SCHEMA_VERSION,
  FLOW_EVENT_CHECKPOINT_CLEARED,
  FLOW_EVENT_CHECKPOINT_LOADED,
  FLOW_EVENT_CHECKPOINT_SAVED,
  FLOW_EVENT_CHECKPOINT_STALE,
  StepAttemptClass,
  StepExecutionDisposition,
  StepSideEffectClass,
} from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { IFlowCheckpointService } from "./checkpoint_service.ts";
import type { IStepDurabilityStore, IStepExecutionRecord } from "./contracts/step_durability.ts";
import type { IFlowEventLogger, IStepResult } from "./flow_runner.ts";
import type { IAgentExecutionResult } from "@exaix/execution";

export interface IFlowCheckpointRequest {
  userPrompt: string;
  traceId?: string;
  requestId?: string;
  requestAnalysis?: IRequestAnalysis;
}

export interface IFlowCheckpointCoordinatorDeps {
  checkpointService?: IFlowCheckpointService;
  stepDurabilityStore: IStepDurabilityStore;
  eventLogger: IFlowEventLogger;
}

export interface IFlowCheckpointCoordinator {
  loadCheckpointIfAvailable(
    flow: IFlow,
    request: IFlowCheckpointRequest,
    flowRunId: string,
    flowContentHash: string,
    stepResults: Map<string, IStepResult>,
  ): Promise<void>;
  saveCheckpointIfEnabled(
    flow: IFlow,
    request: IFlowCheckpointRequest,
    flowRunId: string,
    flowContentHash: string,
    stepResults: Map<string, IStepResult>,
  ): Promise<void>;
  clearCheckpointOnSuccess(
    flow: IFlow,
    request: IFlowCheckpointRequest,
    flowRunId: string,
    success: boolean,
  ): Promise<void>;
}

export class FlowCheckpointCoordinator implements IFlowCheckpointCoordinator {
  private readonly checkpointService?: IFlowCheckpointService;
  private readonly stepDurabilityStore: IStepDurabilityStore;
  private readonly eventLogger: IFlowEventLogger;
  private readonly migratedCheckpointTraceIds = new Set<string>();

  constructor(deps: IFlowCheckpointCoordinatorDeps) {
    this.checkpointService = deps.checkpointService;
    this.stepDurabilityStore = deps.stepDurabilityStore;
    this.eventLogger = deps.eventLogger;
  }

  async loadCheckpointIfAvailable(
    flow: IFlow,
    request: IFlowCheckpointRequest,
    flowRunId: string,
    flowContentHash: string,
    stepResults: Map<string, IStepResult>,
  ): Promise<void> {
    if (!this.checkpointService || !request.traceId) {
      return;
    }

    const checkpoint = await this.checkpointService.load(request.traceId);
    if (!checkpoint) {
      return;
    }

    if (
      checkpoint.schemaVersion !== FLOW_CHECKPOINT_SCHEMA_VERSION ||
      checkpoint.flowContentHash !== flowContentHash
    ) {
      await this.eventLogger.log(FLOW_EVENT_CHECKPOINT_STALE, {
        flowRunId,
        flowId: flow.id,
        traceId: request.traceId,
        requestId: request.requestId,
      });
      await this.checkpointService.delete(request.traceId);
      for (const stepId of Object.keys(checkpoint.completedSteps)) {
        const recordId = `stale:${request.traceId}:${stepId}`;
        await this.stepDurabilityStore.invalidate(recordId, "stale-checkpoint");
        this.eventLogger.log(DomainEventType.FlowStepInvalidated, {
          traceId: request.traceId,
          requestId: request.requestId,
          flowRunId,
          stepId,
          recordId,
          reason: "stale-checkpoint",
        });
      }
      return;
    }

    const restoredSteps = this.restoreStepResultsFromCheckpoint(checkpoint);
    for (const [stepId, result] of Object.entries(restoredSteps)) {
      stepResults.set(stepId, result);
    }

    await this.migrateCheckpointToDurabilityStore(checkpoint, flow.id, request.traceId);

    await this.eventLogger.log(FLOW_EVENT_CHECKPOINT_LOADED, {
      flowRunId,
      flowId: flow.id,
      traceId: request.traceId,
      requestId: request.requestId,
      restoredSteps: Object.keys(restoredSteps).length,
    });
  }

  async saveCheckpointIfEnabled(
    flow: IFlow,
    request: IFlowCheckpointRequest,
    flowRunId: string,
    flowContentHash: string,
    stepResults: Map<string, IStepResult>,
  ): Promise<void> {
    if (!this.checkpointService || !request.traceId) {
      return;
    }

    const checkpoint = await this.checkpointService.save(
      request.traceId,
      flowContentHash,
      this.buildCheckpointSnapshot(stepResults),
    );

    await this.eventLogger.log(FLOW_EVENT_CHECKPOINT_SAVED, {
      flowRunId,
      flowId: flow.id,
      traceId: request.traceId,
      requestId: request.requestId,
      completedSteps: Object.keys(checkpoint.completedSteps).length,
    });
  }

  async clearCheckpointOnSuccess(
    flow: IFlow,
    request: IFlowCheckpointRequest,
    flowRunId: string,
    success: boolean,
  ): Promise<void> {
    if (!success || !this.checkpointService || !request.traceId) {
      return;
    }

    await this.checkpointService.delete(request.traceId);
    await this.eventLogger.log(FLOW_EVENT_CHECKPOINT_CLEARED, {
      flowRunId,
      flowId: flow.id,
      traceId: request.traceId,
      requestId: request.requestId,
    });
  }

  private async migrateCheckpointToDurabilityStore(
    checkpoint: IFlowCheckpoint,
    flowId: string,
    traceId: string,
  ): Promise<void> {
    if (this.migratedCheckpointTraceIds.has(traceId)) {
      return;
    }
    this.migratedCheckpointTraceIds.add(traceId);

    for (const [stepId, snapshot] of Object.entries(checkpoint.completedSteps)) {
      const record: IStepExecutionRecord = {
        recordId: crypto.randomUUID(),
        traceId,
        flowId,
        stepId,
        idempotencyKey: {
          traceId,
          flowId,
          stepId,
          attemptClass: StepAttemptClass.RESUME,
          inputHash: "",
        },
        disposition: StepExecutionDisposition.EXECUTED,
        startedAt: snapshot.startedAt as string,
        completedAt: snapshot.completedAt as string,
        inputHash: "",
        sideEffectClass: StepSideEffectClass.MIXED,
        replayEligible: false,
      };
      await this.stepDurabilityStore.save(record);
    }
  }

  private restoreStepResultsFromCheckpoint(checkpoint: IFlowCheckpoint): Record<string, IStepResult> {
    const restored: Record<string, IStepResult> = {};
    for (const [stepId, snapshot] of Object.entries(checkpoint.completedSteps)) {
      restored[stepId] = {
        ...snapshot,
        result: snapshot.result as IAgentExecutionResult | undefined,
        startedAt: new Date(snapshot.startedAt),
        completedAt: new Date(snapshot.completedAt),
      };
    }
    return restored;
  }

  private buildCheckpointSnapshot(stepResults: Map<string, IStepResult>): Record<string, IFlowStepResultSnapshot> {
    const snapshot: Record<string, IFlowStepResultSnapshot> = {};
    for (const [stepId, result] of stepResults.entries()) {
      if (!result.success) {
        continue;
      }

      snapshot[stepId] = {
        stepId: result.stepId,
        success: result.success,
        skipped: result.skipped,
        skipReason: result.skipReason,
        result: result.result,
        error: result.error,
        duration: result.duration,
        startedAt: result.startedAt.toISOString(),
        completedAt: result.completedAt.toISOString(),
      };
    }
    return snapshot;
  }
}
