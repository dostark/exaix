/**
 * @module FlowRunner
 * @path src/flows/flow_runner.ts
 * @description Core orchestrator for multi-agent flow execution.
 * @architectural-layer Flows
 * * @related-files [src/flows/flow_loader.ts, src/services/request/request_router.ts, src/services/flow/flow_reporter.ts]
 */

import { IFlow, IFlowStep, IGateEvaluate } from "../shared/schemas/flow.ts";
import { join } from "@std/path";
import { DependencyResolver } from "./dependency_resolver.ts";
import { IAgentExecutionResult } from "../services/agent/agent_runner.ts";
import { ConditionEvaluator } from "./condition_evaluator.ts";
import { appendToRequest, extractSection, mergeAsContext, passthrough, templateFill } from "./transforms.ts";
import { jsonExtract, JSONValue } from "../shared/types/json.ts";
import type { IDatabaseService } from "../services/core/db.ts";
import { IRequestAnalysis } from "../shared/schemas/request_analysis.ts";
import type { IPortalKnowledge } from "../shared/schemas/portal_knowledge.ts";
import type { IBlueprintFrontmatter } from "../shared/schemas/blueprint.ts";
import { createGitServiceStub, createProviderStub } from "../shared/helpers/stub_factories.ts";
import { FlowStepType, StepExecutionMode } from "../shared/enums.ts";
import { DynamicStepExecutor } from "./dynamic_step_executor.ts";
import { ActivityJournal } from "../journal/activity_journal.ts";
import { McpClient } from "../mcp/mcp_client.ts";
import { LlmClient } from "../ai/llm_client.ts";
import { ToolHandler } from "../mcp/tool_handler.ts";
import { Config } from "../shared/schemas/config.ts";
import { BlueprintLoader } from "../services/blueprint/blueprint_loader.ts";
import { IApplicationContext } from "../shared/interfaces/i_application_context.ts";
import { IGateConfig, IGateEvaluator, IGateResult } from "../shared/interfaces/i_gate_evaluator.ts";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "../shared/constants.ts";

/**
 * Interface for agent executors (AgentRunner or similar)
 */
export interface IAgentExecutor {
  run(identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult>;
}

/**
 * Interface for the flow runner service
 */
export interface IFlowRunner {
  execute(
    flow: IFlow,
    request: {
      userPrompt: string;
      traceId?: string;
      requestId?: string;
      requestAnalysis?: IRequestAnalysis;
      portalKnowledge?: IPortalKnowledge;
    },
  ): Promise<IFlowResult>;
}

/**
 * Request details for a single step execution
 */
export interface IFlowStepRequest {
  userPrompt: string;
  context: Record<string, JSONValue>;
  traceId?: string;
  requestId?: string;
  /** Skills to apply for this step execution (Phase 17) */
  skills?: string[];
  /** Structured request analysis from Step 11 */
  requestAnalysis?: IRequestAnalysis;
}

/**
 * Configuration for FlowRunner
 */
export interface IFlowRunnerConfig {
  agentExecutor: IAgentExecutor;
  eventLogger: IFlowEventLogger;
  context?: IApplicationContext;
  db?: IDatabaseService;
  gateEvaluator?: IGateEvaluator;
  config?: Config;
  mcpHandlers?: ToolHandler[];
}

/**
 * Result of executing a single flow step
 */
export interface IStepResult {
  /** Step ID */
  stepId: string;
  /** Whether the step succeeded */
  success: boolean;
  /** Whether the step was skipped due to condition */
  skipped?: boolean;
  /** The condition that caused skipping (if skipped) */
  skipReason?: string;
  /** Execution result if successful */
  result?: IAgentExecutionResult;
  /** Error message if failed */
  error?: string;
  /** Execution duration in milliseconds */
  duration: number;
  /** When the step started */
  startedAt: Date;
  /** When the step completed */
  completedAt: Date;
}

/**
 * Result of executing a complete flow
 */
export interface IFlowResult {
  /** Unique flow run identifier */
  flowRunId: string;
  /** Whether the overall flow succeeded */
  success: boolean;
  /** Results for each step */
  stepResults: Map<string, IStepResult>;
  /** Final aggregated output */
  output: string;
  /** Total execution duration */
  duration: number;
  /** When the flow started */
  startedAt: Date;
  /** When the flow completed */
  completedAt: Date;
  /** Optional token usage summary for the flow */
  tokenSummary?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    token_provider?: string;
    token_model?: string;
    token_cost_usd?: number;
  };
}

/**
 * Interface for logging flow events
 */
export interface IFlowEventLogger {
  log(event: string, payload: Record<string, JSONValue | undefined>): void;
}

/**
 * Error thrown when flow execution fails
 */
export class FlowExecutionError extends Error {
  constructor(message: string, public readonly flowRunId?: string) {
    super(message);
    this.name = "FlowExecutionError";
  }
}

type BuiltInTransformHandler = (ctx: {
  input: string;
  transformArgs?: JSONValue;
  originalRequest?: string;
}) => string;

function applyMergeAsContextTransform(input: string, transformArgs: JSONValue | undefined): string {
  if (Array.isArray(transformArgs)) {
    // Filter to strings only — mergeAsContext requires string[]
    const strings = transformArgs.filter((v): v is string => typeof v === "string");
    return mergeAsContext(strings);
  }

  try {
    const inputs = JSON.parse(input);
    if (Array.isArray(inputs)) {
      return mergeAsContext(inputs);
    }
  } catch {
    const inputs = input.split("\n\n").filter((s) => s.trim());
    return mergeAsContext(inputs);
  }

  throw new Error("mergeAsContext requires an array of strings");
}

function applyExtractSectionTransform(input: string, transformArgs: JSONValue | undefined): string {
  if (typeof transformArgs === "string") return extractSection(input, transformArgs);
  throw new Error("extractSection requires a section name as transformArgs");
}

function applyAppendToRequestTransform(input: string, originalRequest: string | undefined): string {
  if (originalRequest) return appendToRequest(originalRequest, input);
  throw new Error("appendToRequest requires original request to be available");
}

function applyJsonExtractTransform(input: string, transformArgs: JSONValue | undefined): string {
  if (typeof transformArgs === "string") return String(jsonExtract(input, transformArgs));
  throw new Error("jsonExtract requires a field path as transformArgs");
}

function applyTemplateFillTransform(input: string, transformArgs: JSONValue | undefined): string {
  if (typeof transformArgs === "object" && transformArgs !== null && !Array.isArray(transformArgs)) {
    return templateFill(input, transformArgs as Record<string, string | number | boolean>);
  }
  throw new Error("templateFill requires a context object as transformArgs");
}

const BUILT_IN_TRANSFORM_HANDLERS: Record<string, BuiltInTransformHandler> = {
  passthrough: ({ input }) => passthrough(input),
  mergeAsContext: ({ input, transformArgs }) => applyMergeAsContextTransform(input, transformArgs),
  extractSection: ({ input, transformArgs }) => applyExtractSectionTransform(input, transformArgs),
  appendToRequest: ({ input, originalRequest }) => applyAppendToRequestTransform(input, originalRequest),
  jsonExtract: ({ input, transformArgs }) => applyJsonExtractTransform(input, transformArgs),
  templateFill: ({ input, transformArgs }) => applyTemplateFillTransform(input, transformArgs),
};

/**
 * Convert an IGateEvaluate (YAML-facing gate config) to a GateConfig (evaluator
 * input), preserving all fields including `includeRequestCriteria`.
 */
export function toGateConfig(evaluate: IGateEvaluate): IGateConfig {
  return {
    identity: evaluate.identity,
    criteria: evaluate.criteria,
    threshold: evaluate.threshold,
    onFail: evaluate.onFail,
    maxRetries: evaluate.maxRetries,
    includeRequestCriteria: evaluate.includeRequestCriteria,
  };
}

/**
 * FlowRunner - Orchestrates multi-agent flow execution
 * Implements Step 7.4 of the Exaix Implementation Plan
 */
export class FlowRunner implements IFlowRunner {
  private conditionEvaluator: ConditionEvaluator;
  private dynamicStepExecutor?: DynamicStepExecutor;
  private agentExecutor: IAgentExecutor;
  private eventLogger: IFlowEventLogger;
  private db?: IDatabaseService;
  private gateEvaluator?: IGateEvaluator;
  private config?: Config;

  constructor(
    private readonly options: IFlowRunnerConfig,
  ) {
    this.conditionEvaluator = new ConditionEvaluator();
    this.agentExecutor = options.agentExecutor;
    this.eventLogger = options.eventLogger;
    this.db = options.context?.db || options.db;
    this.gateEvaluator = options.context?.gateEvaluator || options.gateEvaluator;
    this.config = options.context?.config.get() || options.config;

    const config = this.config;
    const db = this.db;
    const mcpHandlers = options.mcpHandlers;

    if (config && mcpHandlers && this.eventLogger) {
      const activityJournal = new ActivityJournal(this.eventLogger);

      // Use existing context if available, otherwise build a minimal one for McpClient
      const context = options.context || {
        config: {
          get: () => config,
          getAll: () => config,
          getConfigPath: () => "",
          reload: () => config,
          getSchemaVersion: () => "1.0.0",
          getPortals: () => [],
          getPortal: (_alias: string) => undefined,
          addPortal: (_alias: string, _path: string) => Promise.resolve(),
          removePortal: (_alias: string) => Promise.resolve(),
        },
        db: db!,
        provider: createProviderStub(),
        display: {
          info: () => Promise.resolve(),
          warn: () => Promise.resolve(),
          error: () => Promise.resolve(),
          debug: () => Promise.resolve(),
          fatal: () => Promise.resolve(),
        },
        git: createGitServiceStub(),
      } as IApplicationContext;

      const mcpClient = new McpClient(context, mcpHandlers);
      const llmClient = new LlmClient(config);
      this.dynamicStepExecutor = new DynamicStepExecutor(mcpClient, llmClient, activityJournal);
    }
  }

  private getIFlowLogBase(
    flow: IFlow,
    request: { traceId?: string; requestId?: string },
    options: { includeStepCount?: boolean } = {},
  ): Record<string, JSONValue | undefined> {
    return {
      flowId: flow.id,
      ...(options.includeStepCount ? { stepCount: flow.steps.length } : {}),
      traceId: request.traceId,
      requestId: request.requestId,
    };
  }

  /**
   * Execute a flow with the given request
   */
  async execute(
    flow: IFlow,
    request: {
      userPrompt: string;
      traceId?: string;
      requestId?: string;
      requestAnalysis?: IRequestAnalysis;
    },
  ): Promise<IFlowResult> {
    const flowRunId = crypto.randomUUID();
    const startedAt = new Date();

    // Validate flow
    await this.validateIFlow(flow, request, flowRunId);

    const stepResults = new Map<string, IStepResult>();

    try {
      // Execute waves and aggregate results
      await this.executeWaves(flow, request, flowRunId, stepResults);

      // Aggregate output and finalize
      return await this.aggregateAndFinalize(flow, request, flowRunId, stepResults, startedAt);
    } catch (error) {
      return await this.handleExecutionError(flow, request, flowRunId, stepResults, startedAt, error);
    }
  }

  /**
   * Validate the flow before execution
   */
  private async validateIFlow(
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    flowRunId: string,
  ): Promise<void> {
    // Log flow validation start
    await this.eventLogger.log("flow.validating", {
      ...this.getIFlowLogBase(flow, request, { includeStepCount: true }),
    });

    // Validate flow has steps
    if (flow.steps.length === 0) {
      await this.eventLogger.log("flow.validation.failed", {
        error: "IFlow must have at least one step",
        ...this.getIFlowLogBase(flow, request),
      });
      throw new FlowExecutionError("IFlow must have at least one step", flowRunId);
    }

    // Log flow validation success
    await this.eventLogger.log("flow.validated", {
      maxParallelism: flow.settings?.maxParallelism ?? 3,
      failFast: flow.settings?.failFast ?? true,
      ...this.getIFlowLogBase(flow, request, { includeStepCount: true }),
    });
  }

  /**
   * Execute waves sequentially with parallel step execution
   */
  private async executeWaves(
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    flowRunId: string,
    stepResults: Map<string, IStepResult>,
  ): Promise<void> {
    // Log flow start
    await this.eventLogger.log("flow.started", {
      flowRunId,
      maxParallelism: flow.settings?.maxParallelism ?? 3,
      failFast: flow.settings?.failFast ?? true,
      ...this.getIFlowLogBase(flow, request, { includeStepCount: true }),
    });

    // Resolve dependency graph
    await this.eventLogger.log("flow.dependencies.resolving", {
      flowRunId,
      ...this.getIFlowLogBase(flow, request),
    });

    const resolver = new DependencyResolver(flow.steps);
    const waves = resolver.groupIntoWaves();

    await this.eventLogger.log("flow.dependencies.resolved", {
      flowRunId,
      waveCount: waves.length,
      totalSteps: flow.steps.length,
      ...this.getIFlowLogBase(flow, request),
    });

    const failFast = flow.settings?.failFast ?? true;

    // Execute waves sequentially
    for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
      const wave = waves[waveIndex];
      await this.executeWave(flow, request, flowRunId, wave, waveIndex, stepResults, failFast);
    }
  }

  /**
   * Execute a single wave of steps in parallel
   */
  private async executeWave(
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    flowRunId: string,
    wave: string[],
    waveIndex: number,
    stepResults: Map<string, IStepResult>,
    failFast: boolean,
  ): Promise<void> {
    const waveNumber = waveIndex + 1;

    // Log wave start
    await this.eventLogger.log("flow.wave.started", {
      flowRunId,
      waveNumber,
      waveSize: wave.length,
      stepIds: wave,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    // Execute steps in this wave in parallel
    const wavePromises = wave.map((stepId) => this.executeStepSafe(flowRunId, stepId, flow, request, stepResults));
    const waveResults = await Promise.allSettled(wavePromises);

    // Process wave results
    const waveFailed = await this.processWaveResults(
      flow,
      request,
      flowRunId,
      wave,
      waveNumber,
      waveResults,
      stepResults,
      failFast,
    );

    // If failFast is enabled and wave failed, stop execution
    if (waveFailed && failFast) {
      const failedStepIndex = wave.findIndex((_stepId, i) => {
        const result = waveResults[i];
        return result.status === "rejected" ||
          (result.status === "fulfilled" && !result.value.success);
      });
      const failedStepId = wave[failedStepIndex];
      const failedResult = waveResults[failedStepIndex];
      const errorMessage = failedResult.status === "fulfilled"
        ? failedResult.value.error || DEFAULT_UNKNOWN_ERROR_MESSAGE
        : (failedResult.status === "rejected" && failedResult.reason instanceof Error
          ? failedResult.reason.message
          : String((failedResult as PromiseRejectedResult).reason ?? DEFAULT_UNKNOWN_ERROR_MESSAGE));
      throw new FlowExecutionError(`Step ${failedStepId} failed: ${errorMessage}`, flowRunId);
    }
  }

  /**
   * Process results from a completed wave
   */
  private async processWaveResults(
    _flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    flowRunId: string,
    wave: string[],
    waveNumber: number,
    waveResults: PromiseSettledResult<IStepResult>[],
    stepResults: Map<string, IStepResult>,
    failFast: boolean,
  ): Promise<boolean> {
    let waveFailed = false;
    let waveSuccessCount = 0;
    let waveFailureCount = 0;
    const waveErrors: Array<{ stepId: string; error: Error | string }> = [];

    for (let i = 0; i < wave.length; i++) {
      const stepId = wave[i];
      const promiseResult = waveResults[i];

      try {
        if (promiseResult.status === "fulfilled") {
          const result = promiseResult.value;
          stepResults.set(stepId, result);

          if (result.success) {
            waveSuccessCount++;
          } else {
            waveFailureCount++;
            if (failFast) {
              waveFailed = true;
            }
          }
        } else {
          // Execution threw; record safe failure
          const error: Error | string = promiseResult.reason instanceof Error
            ? promiseResult.reason
            : String(promiseResult.reason);
          waveErrors.push({ stepId, error });

          const errorIStepResult: IStepResult = {
            stepId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            duration: 0,
            startedAt: new Date(),
            completedAt: new Date(),
          };

          stepResults.set(stepId, errorIStepResult);
          waveFailureCount++;

          if (failFast) {
            waveFailed = true;
          }
        }
      } catch (processingError) {
        // Protect aggregation code from throwing and corrupting results
        await this.eventLogger.log("flow.step.processing_error", {
          flowRunId,
          stepId,
          error: processingError instanceof Error ? processingError.message : String(processingError),
          traceId: request.traceId,
          requestId: request.requestId,
        });

        waveFailureCount++;
        if (failFast) {
          waveFailed = true;
        }
      }
    }

    // Log wave completion
    await this.eventLogger.log("flow.wave.completed", {
      flowRunId,
      waveNumber,
      waveSize: wave.length,
      successCount: waveSuccessCount,
      failureCount: waveFailureCount,
      failed: waveFailed,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    // Log any wave-level errors
    if (waveErrors.length > 0) {
      await this.eventLogger.log("flow.wave.errors", {
        flowRunId,
        waveNumber,
        errorCount: waveErrors.length,
        errors: waveErrors.map(({ stepId, error }) => ({
          stepId,
          error: error instanceof Error ? error.message : String(error),
        })),
        traceId: request.traceId,
        requestId: request.requestId,
      });
    }

    return waveFailed;
  }

  /**
   * Aggregate output and create final flow result
   */
  private async aggregateAndFinalize(
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    flowRunId: string,
    stepResults: Map<string, IStepResult>,
    startedAt: Date,
  ): Promise<IFlowResult> {
    // Aggregate output
    await this.eventLogger.log("flow.output.aggregating", {
      flowRunId,
      flowId: flow.id,
      outputFrom: flow.output?.from,
      outputFormat: flow.output?.format,
      totalSteps: stepResults.size,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    const output = this.aggregateOutput(flow, stepResults);

    await this.eventLogger.log("flow.output.aggregated", {
      flowRunId,
      flowId: flow.id,
      outputLength: output.length,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();

    // Determine overall success
    const success = Array.from(stepResults.values()).every((result) => result.success);
    const successfulSteps = Array.from(stepResults.values()).filter((r) => r.success).length;
    const failedSteps = stepResults.size - successfulSteps;

    // Log flow completion
    await this.eventLogger.log("flow.completed", {
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

    // Aggregate and log token usage summary
    const tokenSummary = (this.db && request.traceId)
      ? await this.aggregateAndLogTokenUsage(flowRunId, flow.id, request.traceId, request.requestId)
      : null;

    return {
      flowRunId,
      success,
      stepResults,
      output,
      duration,
      startedAt,
      completedAt,
      tokenSummary: tokenSummary ?? undefined,
    };
  }

  /**
   * Handle execution errors and create error result
   */
  private async handleExecutionError(
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    flowRunId: string,
    stepResults: Map<string, IStepResult>,
    startedAt: Date,
    error: unknown,
  ): Promise<never> {
    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();

    // Determine partial results
    const successfulSteps = Array.from(stepResults.values()).filter((r) => r.success).length;
    const failedSteps = stepResults.size - successfulSteps;

    // Log flow failure
    await this.eventLogger.log("flow.failed", {
      flowRunId,
      flowId: flow.id,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : "Unknown",
      duration,
      stepsAttempted: stepResults.size,
      successfulSteps,
      failedSteps,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    throw error;
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    flowRunId: string,
    stepId: string,
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    stepResults: Map<string, IStepResult>,
  ): Promise<IStepResult> {
    const step = flow.steps.find((s) => s.id === stepId)!;
    const startedAt = new Date();

    // Evaluate step condition if present
    const conditionResult = await this.evaluateStepCondition(flowRunId, step, flow, stepResults, request, startedAt);
    if (conditionResult) {
      return conditionResult;
    }

    // Log step queued (ready for execution)
    await this.eventLogger.log("flow.step.queued", {
      flowRunId,
      stepId,
      identityId: step.identity,
      dependencies: step.dependsOn,
      inputSource: step.input.source,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    // Log step start
    await this.eventLogger.log("flow.step.started", {
      flowRunId,
      stepId,
      identityId: step.identity,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    try {
      // Prepare step input
      const stepRequest = await this.prepareStepRequest(flowRunId, step, flow, request, stepResults);
      const result = await this.executeStepLogic(flowRunId, step, flow, request, stepRequest, startedAt);
      return this.formatStepSuccess(flowRunId, step, request, result, startedAt);
    } catch (error) {
      return this.formatStepFailure(flowRunId, step, request, error, startedAt);
    }
  }

  /**
   * Evaluate step condition and return skip result if condition fails
   */
  private async evaluateStepCondition(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    stepResults: Map<string, IStepResult>,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    startedAt: Date,
  ): Promise<IStepResult | null> {
    if (!step.condition) {
      return null;
    }

    const conditionResult = this.conditionEvaluator.evaluateStepCondition(step, stepResults, request, flow);

    await this.eventLogger.log("flow.step.condition.evaluated", {
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
      const duration = completedAt.getTime() - startedAt.getTime();

      await this.eventLogger.log("flow.step.skipped", {
        flowRunId,
        stepId: step.id,
        condition: step.condition,
        reason: conditionResult.error || "Condition evaluated to false",
        traceId: request.traceId,
        requestId: request.requestId,
      });

      return {
        stepId: step.id,
        success: true,
        skipped: true,
        skipReason: conditionResult.error || `Condition "${step.condition}" evaluated to false`,
        duration,
        startedAt,
        completedAt,
      };
    }

    return null;
  }

  /**
   * Execute step logic (gate or agent execution)
   */
  private executeStepLogic(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    stepRequest: IFlowStepRequest,
    startedAt: Date,
  ): Promise<IAgentExecutionResult> {
    // Gate steps route to GateEvaluator
    if (step.type === FlowStepType.GATE && step.evaluate && this.gateEvaluator) {
      return this.executeGateStep(flowRunId, step, flow, request, stepRequest, startedAt);
    }

    // Agent execution (dynamic or declared mode)
    return this.executeAgentStep(step, request, stepRequest);
  }

  /**
   * Execute a gate step
   */
  private async executeGateStep(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    stepRequest: IFlowStepRequest,
    _startedAt: Date,
  ): Promise<IAgentExecutionResult> {
    if (!step.evaluate || !this.gateEvaluator) {
      throw new Error("Gate evaluator not available");
    }

    const gateConfig = toGateConfig(step.evaluate);
    const effectiveInclude = gateConfig.includeRequestCriteria || flow.settings?.includeRequestCriteria;
    const effectiveGateConfig: IGateConfig = { ...gateConfig, includeRequestCriteria: effectiveInclude };

    if (effectiveGateConfig.includeRequestCriteria && !stepRequest.requestAnalysis) {
      await this.eventLogger.log("flow.gate.criteria.no_analysis", {
        flowRunId,
        stepId: step.id,
        traceId: request.traceId,
        requestId: request.requestId,
      });
    }

    const gateResult: IGateResult = await this.gateEvaluator.evaluate(
      effectiveGateConfig,
      stepRequest.userPrompt,
      stepRequest.userPrompt,
      0,
      stepRequest.requestAnalysis,
    );

    return {
      thought: "",
      content: gateResult.evaluation.feedback,
      raw: JSON.stringify(gateResult.evaluation),
    };
  }

  /**
   * Execute an agent step (dynamic or declared mode)
   */
  private executeAgentStep(
    step: IFlowStep,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    stepRequest: IFlowStepRequest,
  ): Promise<IAgentExecutionResult> {
    if (step.execution_mode === StepExecutionMode.DYNAMIC && this.dynamicStepExecutor) {
      return this.executeDynamicStep(step, request, stepRequest);
    }
    return this.executeDeclaredStep(step, stepRequest);
  }

  /**
   * Execute a dynamic step using ReAct reasoning engine
   */
  private async executeDynamicStep(
    step: IFlowStep,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    stepRequest: IFlowStepRequest,
  ): Promise<IAgentExecutionResult> {
    const blueprintsPath = this.config
      ? join(this.config.system.root, this.config.paths.blueprints, this.config.paths.identities)
      : "";
    const loader = new BlueprintLoader({ blueprintsPath });
    const loaded = await loader.load(step.identity);

    if (!loaded) {
      throw new Error(`Blueprint not found for dynamic step: ${step.identity}`);
    }

    const dynamicResult = await this.dynamicStepExecutor!.execute(
      step,
      loaded.frontmatter as IBlueprintFrontmatter,
      stepRequest.userPrompt,
      { traceId: request.traceId || crypto.randomUUID() },
    );

    return {
      thought: `Dynamic execution completed in ${dynamicResult.iterations} iterations`,
      content: dynamicResult.output,
      raw: JSON.stringify(dynamicResult.toolCallsLog),
    };
  }

  /**
   * Execute a declared step using agent executor
   */
  private async executeDeclaredStep(
    step: IFlowStep,
    stepRequest: IFlowStepRequest,
  ): Promise<IAgentExecutionResult> {
    return await this.agentExecutor.run(step.identity, stepRequest);
  }

  /**
   * Format successful step result
   */
  private formatStepSuccess(
    flowRunId: string,
    step: IFlowStep,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    result: IAgentExecutionResult,
    startedAt: Date,
  ): IStepResult {
    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();

    this.eventLogger.log("flow.step.completed", {
      flowRunId,
      stepId: step.id,
      identityId: step.identity,
      success: true,
      duration,
      outputLength: result.content.length,
      hasThought: !!result.thought,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    return {
      stepId: step.id,
      success: true,
      result,
      duration,
      startedAt,
      completedAt,
    };
  }

  /**
   * Format failed step result
   */
  private formatStepFailure(
    flowRunId: string,
    step: IFlowStep,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    error: unknown,
    startedAt: Date,
  ): IStepResult {
    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.constructor.name : "Unknown";

    this.eventLogger.log("flow.step.failed", {
      flowRunId,
      stepId: step.id,
      identityId: step.identity,
      error: errorMessage,
      errorType,
      duration,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    return {
      stepId: step.id,
      success: false,
      error: errorMessage,
      duration,
      startedAt,
      completedAt,
    };
  }

  /**
   * Prepare the request for a step execution
   */
  private async prepareStepRequest(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    stepResults: Map<string, IStepResult>,
  ): Promise<IFlowStepRequest> {
    let inputData: string;

    // Collect input data based on source
    switch (step.input.source) {
      case "request": {
        inputData = originalRequest.userPrompt;
        break;
      }

      case "step": {
        if (!step.input.stepId) {
          throw new Error(`Step ${step.id} has source "step" but no stepId specified`);
        }
        const sourceResult = stepResults.get(step.input.stepId);
        if (!sourceResult?.result) {
          throw new Error(`Step ${step.id} depends on ${step.input.stepId} which has no result`);
        }
        inputData = sourceResult.result.content;
        break;
      }

      case "aggregate": {
        if (!step.input.from || step.input.from.length === 0) {
          throw new Error(`Step ${step.id} has source "aggregate" but no "from" steps specified`);
        }
        const aggregatedInputs: string[] = [];
        for (const stepId of step.input.from) {
          const result = stepResults.get(stepId);
          if (!result?.result) {
            throw new Error(`Step ${step.id} depends on ${stepId} which has no result`);
          }
          aggregatedInputs.push(result.result.content);
        }
        inputData = aggregatedInputs.length === 1 ? aggregatedInputs[0] : aggregatedInputs.join("\n\n");
        break;
      }

      default:
        throw new Error(`Invalid input source: ${step.input.source}`);
    }

    // Apply transform
    let userPrompt = inputData;
    if (step.input.transform) {
      const transformStart = Date.now();
      userPrompt = this.applyTransform(
        inputData,
        step.input.transform as string | ((input: string) => string),
        step.input.transformArgs as JSONValue | undefined,
        originalRequest.userPrompt,
      );

      // Log transform application
      await this.eventLogger.log("flow.step.transform.applied", {
        flowRunId,
        stepId: step.id,
        transformName: typeof step.input.transform === "string" ? step.input.transform : "custom",
        inputSize: inputData.length,
        outputSize: userPrompt.length,
        duration: Date.now() - transformStart,
        traceId: originalRequest.traceId,
        requestId: originalRequest.requestId,
      });
    }

    // Merge skills: step-level skills override flow-level defaults (Phase 17)
    const skills = step.skills ?? flow.defaultSkills;

    // Log input.prepared event for test visibility
    await this.eventLogger.log("flow.step.input.prepared", {
      flowRunId,
      stepId: step.id,
      hasSkills: !!skills && Array.isArray(skills) ? skills.length > 0 : !!skills,
      traceId: originalRequest.traceId,
      requestId: originalRequest.requestId,
    });

    return {
      userPrompt,
      context: {},
      traceId: originalRequest.traceId,
      requestId: originalRequest.requestId,
      skills,
      requestAnalysis: originalRequest.requestAnalysis,
    };
  }

  /**
   * Apply a transform function to input data
   */
  private applyTransform(
    input: string,
    transform: string | ((input: string) => string),
    transformArgs?: JSONValue,
    originalRequest?: string,
  ): string {
    // Handle custom transform functions
    if (typeof transform === "function") {
      try {
        return (transform as (input: string) => string)(input);
      } catch (error) {
        throw new Error(`Custom transform failed: ${(error as Error).message}`);
      }
    }

    const handler = BUILT_IN_TRANSFORM_HANDLERS[transform];
    if (!handler) throw new Error(`Unknown transform: ${transform}`);
    return handler({ input, transformArgs, originalRequest });
  }

  /**
   * Aggregate output from the specified steps
   */
  private aggregateOutput(flow: IFlow, stepResults: Map<string, IStepResult>): string {
    const outputFrom = Array.isArray(flow.output.from) ? flow.output.from : [flow.output.from];
    const format = flow.output.format || "markdown";

    if (outputFrom.length === 0) {
      return "";
    }

    if (outputFrom.length === 1) {
      const stepId = outputFrom[0];
      const result = stepResults.get(stepId);
      return result?.result?.content || "";
    }

    // Multiple outputs - aggregate based on format
    switch (format) {
      case "concat": {
        return outputFrom
          .map((stepId) => stepResults.get(stepId)?.result?.content || "")
          .filter((content) => content.length > 0)
          .join("\n");
      }

      case "json": {
        const jsonObj: Record<string, string> = {};
        for (const stepId of outputFrom) {
          const result = stepResults.get(stepId);
          if (result?.result?.content) {
            jsonObj[stepId] = result.result.content;
          }
        }
        return JSON.stringify(jsonObj);
      }

      case "markdown":
      default:
        return outputFrom
          .map((stepId) => {
            const result = stepResults.get(stepId);
            const content = result?.result?.content || "";
            return `## ${stepId}\n\n${content}`;
          })
          .join("\n\n");
    }
  }

  /**
   * Safe wrapper around `executeStep` to ensure unexpected throws
   * are converted into a `IStepResult` and do not propagate.
   */
  private async executeStepSafe(
    flowRunId: string,
    stepId: string,
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    stepResults: Map<string, IStepResult>,
  ): Promise<IStepResult> {
    try {
      return await this.executeStep(flowRunId, stepId, flow, request, stepResults);
    } catch (error) {
      // Log unexpected error and return a safe failure IStepResult
      try {
        await this.eventLogger.log("flow.step.unexpected_error", {
          flowRunId,
          stepId,
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : "Unknown",
          traceId: request.traceId,
          requestId: request.requestId,
        });
      } catch {
        // Swallow logging errors to avoid cascading failures
      }

      return {
        stepId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      };
    }
  }

  /**
   * Aggregate token usage across all LLM calls in a flow and log summary
   */
  private async aggregateAndLogTokenUsage(
    flowRunId: string,
    flowId: string,
    traceId: string,
    requestId?: string,
  ): Promise<IFlowResult["tokenSummary"] | null> {
    try {
      // Query all LLM usage events for this trace
      const tokenEvents = await this.db!.queryActivity({
        traceId,
        actionType: "llm.usage",
      });

      if (tokenEvents.length === 0) {
        // No token usage found, log zero summary
        await this.eventLogger.log("flow.token_summary", {
          flowRunId,
          flowId,
          totalLlmCalls: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCostUsd: 0,
          providers: {},
          traceId,
          requestId,
        });
        return null;
      }

      // Aggregate token usage by provider
      const providerStats: Record<string, {
        calls: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
      }> = {};

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;
      const models = new Set<string>();

      for (const event of tokenEvents) {
        try {
          const payload = JSON.parse(event.payload);
          const provider = payload.provider || event.target || "unknown";
          const inputTokens = payload.input_tokens ?? payload.prompt_tokens ?? 0;
          const outputTokens = payload.output_tokens ?? payload.completion_tokens ?? 0;
          const costUsd = payload.cost_usd || 0;
          const model = payload.model as string | undefined;

          // Initialize provider stats if not exists
          if (!providerStats[provider]) {
            providerStats[provider] = {
              calls: 0,
              inputTokens: 0,
              outputTokens: 0,
              costUsd: 0,
            };
          }

          // Accumulate stats
          providerStats[provider].calls++;
          providerStats[provider].inputTokens += inputTokens;
          providerStats[provider].outputTokens += outputTokens;
          providerStats[provider].costUsd += costUsd;

          totalInputTokens += inputTokens;
          totalOutputTokens += outputTokens;
          totalCostUsd += costUsd;
          if (model) {
            models.add(model);
          }
        } catch (_parseError) {
          // Skip malformed token events
          console.warn(`Skipping malformed token event: ${event.payload}`);
        }
      }

      // Log aggregated token summary
      await this.eventLogger.log("flow.token_summary", {
        flowRunId,
        flowId,
        totalLlmCalls: tokenEvents.length,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        totalCostUsd: Math.round(totalCostUsd * 10000) / 10000, // Round to 4 decimal places
        providers: providerStats,
        traceId,
        requestId,
      });

      return {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
        token_provider: Object.keys(providerStats).join(", ") || undefined,
        token_model: models.size > 0 ? Array.from(models).join(", ") : undefined,
        token_cost_usd: Math.round(totalCostUsd * 10000) / 10000,
      };
    } catch (error) {
      // Log error but don't fail the flow
      console.warn(`Failed to aggregate token usage for flow ${flowRunId}:`, error);
      try {
        await this.eventLogger.log("flow.token_summary.error", {
          flowRunId,
          flowId,
          error: error instanceof Error ? error.message : String(error),
          traceId,
          requestId,
        });
      } catch {
        // Swallow logging errors to avoid cascading failures
      }
      return null;
    }
  }
}
