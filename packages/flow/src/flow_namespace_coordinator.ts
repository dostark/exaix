/**
 * @module FlowNamespaceCoordinator
 * @path packages/flow/src/flow_namespace_coordinator.ts
 * @description Handles the flow namespace lifecycle: namespace ID derivation,
 * lazy initialization, shared-namespace read attachment onto outgoing step
 * requests, and deferred write persistence after a wave settles. Extracted
 * from FlowRunner (god-object decomposition, .copilot/skills/refactor/SKILL.md
 * step d) since this logic depends only on namespaceService and eventLogger —
 * no other FlowRunner field.
 * @architectural-layer Flows
 * @related-files ["packages/flow/src/flow_runner.ts"]
 */
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import { FLOW_EVENT_NAMESPACE_INITIALIZED, FLOW_EVENT_NAMESPACE_READ, FLOW_EVENT_NAMESPACE_WRITE } from "@exaix/core";
import type { IFlowNamespaceService } from "./namespace_service.ts";
import type { IFlowEventLogger, IFlowStepRequest, IStepResult } from "./flow_runner.ts";

export interface IFlowNamespaceOriginalRequest {
  userPrompt: string;
  traceId?: string;
  requestId?: string;
  requestAnalysis?: IRequestAnalysis;
}

export interface IFlowNamespaceCoordinatorDeps {
  namespaceService?: IFlowNamespaceService;
  eventLogger: IFlowEventLogger;
}

export interface IFlowNamespaceCoordinator {
  getNamespaceId(request: { traceId?: string }, flowRunId: string): string;
  initializeNamespace(namespaceId: string, flow: IFlow): Promise<void>;
  attachSharedNamespace(
    stepRequest: IFlowStepRequest,
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: IFlowNamespaceOriginalRequest,
  ): Promise<IFlowStepRequest>;
  persistWaveNamespaceWrites(
    result: IStepResult,
    request: { traceId?: string; requestId?: string },
    stepId: string,
    namespaceId: string,
    namespaceEnabled: boolean,
  ): Promise<void>;
}

export class FlowNamespaceCoordinator implements IFlowNamespaceCoordinator {
  private readonly namespaceService?: IFlowNamespaceService;
  private readonly eventLogger: IFlowEventLogger;

  constructor(deps: IFlowNamespaceCoordinatorDeps) {
    this.namespaceService = deps.namespaceService;
    this.eventLogger = deps.eventLogger;
  }

  getNamespaceId(request: { traceId?: string }, flowRunId: string): string {
    return request.traceId ?? flowRunId;
  }

  async initializeNamespace(namespaceId: string, flow: IFlow): Promise<void> {
    if (!this.namespaceService || !flow.namespace?.enabled) {
      return;
    }

    await this.namespaceService.initialize(namespaceId);
    await this.eventLogger.log(FLOW_EVENT_NAMESPACE_INITIALIZED, {
      namespaceId,
      flowId: flow.id,
    });
  }

  async attachSharedNamespace(
    stepRequest: IFlowStepRequest,
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: IFlowNamespaceOriginalRequest,
  ): Promise<IFlowStepRequest> {
    if (!this.namespaceService || !flow.namespace?.enabled || !step.namespace?.reads?.length) {
      return stepRequest;
    }

    const namespaceId = this.getNamespaceId(originalRequest, flowRunId);
    const readKeys = step.namespace.reads.map((read) => read.key);
    const resolvedNamespace = await this.namespaceService.readKeys(namespaceId, readKeys);
    const missingRequiredKeys = step.namespace.reads
      .filter((read) => read.required && resolvedNamespace[read.key] === undefined)
      .map((read) => read.key);

    if (missingRequiredKeys.length > 0) {
      throw new Error(
        `Step ${step.id} is missing required namespace keys: ${missingRequiredKeys.join(", ")}`,
      );
    }

    await this.eventLogger.log(FLOW_EVENT_NAMESPACE_READ, {
      namespaceId,
      stepId: step.id,
      keys: readKeys,
      traceId: originalRequest.traceId,
      requestId: originalRequest.requestId,
    });

    const sharedNamespaceEntries = Object.entries(resolvedNamespace)
      .filter((entry): entry is [string, string] => entry[1] !== undefined);
    if (sharedNamespaceEntries.length > 0) {
      stepRequest.sharedNamespace = Object.fromEntries(sharedNamespaceEntries);
    }

    return stepRequest;
  }

  async persistWaveNamespaceWrites(
    result: IStepResult,
    request: { traceId?: string; requestId?: string },
    stepId: string,
    namespaceId: string,
    namespaceEnabled: boolean,
  ): Promise<void> {
    if (!result.namespaceWrites || !this.namespaceService || !namespaceEnabled) {
      return;
    }

    await this.namespaceService.writeEntries(
      namespaceId,
      stepId,
      result.namespaceWrites.writes,
      result.namespaceWrites.stepOutput,
    );
    await this.eventLogger.log(FLOW_EVENT_NAMESPACE_WRITE, {
      namespaceId,
      stepId,
      keys: result.namespaceWrites.writes.map((write) => write.key),
      traceId: request.traceId,
      requestId: request.requestId,
    });
  }
}
