/**
 * @module FlowCompletion
 * @path packages/flow/src/flow_completion.ts
 * @description Validates a flow before it runs and finishes it: output aggregation, token usage, checkpoint clearing and the execution error result.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import type { IFlow } from "@exaix/schemas/flow.ts";
import type { FlowRuntimeValidator } from "./flow_runtime_validator.ts";
import { FlowCapabilityUnavailableError } from "./flow_capabilities.ts";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import {
  DEFAULT_UNKNOWN_LABEL,
  FLOW_EVENT_COMPLETED,
  FLOW_EVENT_VALIDATION_FAILED,
  MILESTONE_FLOW_COMPLETED,
  MILESTONE_FLOW_FAILED,
} from "@exaix/core";
import type { IExecutionMemoryStore } from "@exaix/core/execution-memory";
import type { FlowCheckpointCoordinator } from "./flow_checkpoint_coordinator.ts";
import type { StepOutputFormatter } from "./step_output_formatter.ts";
import type { FlowNamespaceCoordinator } from "./flow_namespace_coordinator.ts";
import { DomainEventType } from "@exaix/core/events";
import type {
  EmitFlowMilestone,
  IAgentExecutor,
  IFlowEventLogger,
  IFlowOriginalRequest,
  IFlowResult,
  IStepResult,
} from "./flow_types.ts";
import type { FlowTokenUsage } from "./flow_token_usage.ts";
import { getFlowLogBase } from "./flow_log_base.ts";
import { FlowExecutionError } from "./flow_errors.ts";

// unslop-ignore-next-line unused-type
/** What the flow validation and completion of one flow runner needs from it. */
export interface IFlowCompletionDependencies {
  readonly agentExecutor: IAgentExecutor;
  readonly eventLogger: IFlowEventLogger;
  readonly runtimeValidator: FlowRuntimeValidator;
  readonly checkpointCoordinator: FlowCheckpointCoordinator;
  readonly db: IDatabaseService | undefined;
  readonly namespaceCoordinator: FlowNamespaceCoordinator;
  readonly namespaceService: IExecutionMemoryStore | undefined;
  readonly stepOutputFormatter: StepOutputFormatter;
  readonly tokenUsage: FlowTokenUsage;
  readonly emitMilestone: EmitFlowMilestone;
}

/** Validates a flow before it runs and aggregates, journals and checkpoints its result when it ends. */
export class FlowCompletion {
  private readonly agentExecutor: IAgentExecutor;
  private readonly eventLogger: IFlowEventLogger;
  private readonly runtimeValidator: FlowRuntimeValidator;
  private readonly checkpointCoordinator: FlowCheckpointCoordinator;
  private readonly db: IDatabaseService | undefined;
  private readonly namespaceCoordinator: FlowNamespaceCoordinator;
  private readonly namespaceService: IExecutionMemoryStore | undefined;
  private readonly stepOutputFormatter: StepOutputFormatter;
  private readonly tokenUsage: FlowTokenUsage;
  private readonly emitMilestone: EmitFlowMilestone;

  constructor(dependencies: IFlowCompletionDependencies) {
    this.agentExecutor = dependencies.agentExecutor;
    this.eventLogger = dependencies.eventLogger;
    this.runtimeValidator = dependencies.runtimeValidator;
    this.checkpointCoordinator = dependencies.checkpointCoordinator;
    this.db = dependencies.db;
    this.namespaceCoordinator = dependencies.namespaceCoordinator;
    this.namespaceService = dependencies.namespaceService;
    this.stepOutputFormatter = dependencies.stepOutputFormatter;
    this.tokenUsage = dependencies.tokenUsage;
    this.emitMilestone = dependencies.emitMilestone;
  }

  /**
   * Validate the flow before execution
   */
  async validateIFlow(
    flow: IFlow,
    request: IFlowOriginalRequest,
    flowRunId: string,
    ceiling: number,
  ): Promise<void> {
    // Log flow validation start
    await this.eventLogger.log(DomainEventType.FlowValidating, {
      ...getFlowLogBase(flow, request, { includeStepCount: true }),
    });

    // Validate flow has steps
    if (flow.steps.length === 0) {
      await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
        error: "IFlow must have at least one step",
        ...getFlowLogBase(flow, request),
      });
      throw new FlowExecutionError("IFlow must have at least one step", flowRunId);
    }

    const fallbackCycle = this.runtimeValidator.findCyclicFallbackChain(flow);
    if (fallbackCycle) {
      const errorMessage = `Cyclic fallback chain detected: ${fallbackCycle.join(" -> ")}`;
      await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
        error: errorMessage,
        ...getFlowLogBase(flow, request),
      });
      throw new FlowExecutionError(errorMessage, flowRunId);
    }

    const parallelValidationError = this.runtimeValidator.validateParallelGroups(flow);
    if (parallelValidationError) {
      await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
        error: parallelValidationError,
        ...getFlowLogBase(flow, request),
      });
      throw new FlowExecutionError(parallelValidationError, flowRunId);
    }

    const gatePolicyError = this.runtimeValidator.validateGatePolicies(flow, ceiling);
    if (gatePolicyError) throw new FlowExecutionError(gatePolicyError, flowRunId);

    const strategyValidationError = this.runtimeValidator.validateStepStrategy(flow);
    if (strategyValidationError) {
      await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
        error: strategyValidationError,
        ...getFlowLogBase(flow, request),
      });
      throw new FlowExecutionError(strategyValidationError, flowRunId);
    }

    if (this.agentExecutor.hasBlueprint) {
      const agentRoleValidationError = await this.runtimeValidator.validateStepAgentRoles(
        flow,
        (agentRole) => this.agentExecutor.hasBlueprint!(agentRole),
      );
      if (agentRoleValidationError) {
        await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
          error: agentRoleValidationError,
          ...getFlowLogBase(flow, request),
        });
        throw new FlowExecutionError(agentRoleValidationError, flowRunId);
      }
    }

    // Log flow validation success
    await this.eventLogger.log(DomainEventType.FlowValidated, {
      maxParallelism: flow.settings?.maxParallelism ?? 3,
      failFast: flow.settings?.failFast ?? true,
      ...getFlowLogBase(flow, request, { includeStepCount: true }),
    });
  }

  /**
   * Aggregate output and create final flow result
   */
  async aggregateAndFinalize(
    flow: IFlow,
    request: IFlowOriginalRequest,
    flowRunId: string,
    stepResults: Map<string, IStepResult>,
    startedAt: Date,
  ): Promise<IFlowResult> {
    // Aggregate output
    await this.eventLogger.log(DomainEventType.FlowOutputAggregating, {
      flowRunId,
      flowId: flow.id,
      outputFrom: flow.output?.from,
      outputFormat: flow.output?.format,
      totalSteps: stepResults.size,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    const output = this.stepOutputFormatter.aggregateOutput(flow.output, stepResults);

    await this.eventLogger.log(DomainEventType.FlowOutputAggregated, {
      flowRunId,
      flowId: flow.id,
      outputLength: output.length,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    const completedAt = new Date();
    const duration = Math.max(0, completedAt.getTime() - startedAt.getTime());

    // Determine overall success
    const success = Array.from(stepResults.values()).every((result) => result.success);
    const successfulSteps = Array.from(stepResults.values()).filter((r) => r.success).length;
    const failedSteps = stepResults.size - successfulSteps;

    await this.checkpointCoordinator.clearCheckpointOnSuccess(flow, request, flowRunId, success);

    // Log flow completion
    await this.eventLogger.log(FLOW_EVENT_COMPLETED, {
      flowRunId,
      flowId: flow.id,
      success,
      duration,
      stepsCompleted: stepResults.size,
      successfulSteps,
      failedSteps,
      outputLength: output.length,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    await this.emitMilestone(
      MILESTONE_FLOW_COMPLETED,
      request.traceId,
      success ? "Flow completed successfully" : "Flow completed with failures",
      {
        stepsCompleted: stepResults.size,
        stepsTotal: flow.steps.length,
      },
    );

    // Aggregate and log token usage summary
    const tokenSummary = (this.db && request.traceId)
      ? await this.tokenUsage.aggregateAndLogTokenUsage(flowRunId, flow.id, request.traceId, request.requestId)
      : null;
    const namespaceArtifactPath = this.namespaceService && flow.namespace?.enabled
      ? this.namespaceService.getNamespacePath(this.namespaceCoordinator.getNamespaceId(request, flowRunId))
      : undefined;

    return {
      flowRunId,
      success,
      stepResults,
      output,
      duration,
      startedAt,
      completedAt,
      namespaceArtifactPath,
      tokenSummary: tokenSummary ?? undefined,
    };
  }

  /**
   * Handle execution errors and create error result
   */
  async handleExecutionError<TError>(
    flow: IFlow,
    request: IFlowOriginalRequest,
    flowRunId: string,
    stepResults: Map<string, IStepResult>,
    startedAt: Date,
    error: TError,
  ): Promise<never> {
    const completedAt = new Date();
    const duration = Math.max(0, completedAt.getTime() - startedAt.getTime());

    // Determine partial results
    const successfulSteps = Array.from(stepResults.values()).filter((r) => r.success).length;
    const failedSteps = stepResults.size - successfulSteps;

    // Log flow failure
    await this.eventLogger.log("flow.failed", {
      flowRunId,
      flowId: flow.id,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : DEFAULT_UNKNOWN_LABEL,
      reasonCode: error instanceof FlowExecutionError || error instanceof FlowCapabilityUnavailableError
        ? error.reasonCode
        : undefined,
      duration,
      stepsAttempted: stepResults.size,
      successfulSteps,
      failedSteps,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    await this.emitMilestone(
      MILESTONE_FLOW_FAILED,
      request.traceId,
      `Flow failed: ${error instanceof Error ? error.message : String(error)}`,
      { stepsCompleted: stepResults.size, stepsTotal: flow.steps.length },
      true,
      "Flow execution encountered an unrecoverable error",
    );

    throw error;
  }
}
