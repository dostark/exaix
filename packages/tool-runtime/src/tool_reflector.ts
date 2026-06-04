/**
 * @module ToolReflector
 * @path packages/tool-runtime/src/tool_reflector.ts
 * @description Orchestrates tool execution with automated reflection, evaluation, and retry logic to improve agent reliability.
 * @architectural-layer Services
 * @related-files ["packages/tool-runtime/src/tool_reflector.ts"]
 */

import { z } from "zod";
import type { IDatabaseService } from "@exaix/core/types";
import type { IOutputValidator } from "./output_validator.ts";
import type { IToolAgentExecutor } from "./types.ts";
import { logDebug } from "@exaix/core/logger";
import { ToolReflectionIssueType, ToolReflectionSeverity } from "@exaix/core";
import { JSONValueSchema, type LogMetadata, toSafeJson } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";

export interface IToolCall {
  id: string;
  name: string;
  parameters: Record<string, JSONValue>;
  purpose: string;
  dependencies?: string[];
}

export interface IToolResult {
  callId: string;
  success: boolean;
  output: JSONValue;
  error?: string;
  durationMs: number;
}

export interface IReflectedToolResult extends IToolResult {
  reflection: IToolReflection;
  retryCount: number;
  finalOutput: JSONValue;
}

export interface IToolReflectorConfig {
  maxRetries?: number;
  reflectionThreshold?: number;
  parallelExecution?: boolean;
  reflectionPromptTemplate?: string;
  verbose?: boolean;
  db?: IDatabaseService;
  logger?: IEventLogger;
}

export interface IToolReflectorMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalRetries: number;
  retryRate: number;
  averageRetriesPerCall: number;
  toolDistribution: Record<string, number>;
  issueTypeDistribution: Record<string, number>;
}

// ============================================================================
// Reflection Schema
// ============================================================================

/**
 * Schema for tool reflection output
 */
export const ToolReflectionSchema = z.object({
  success: z.boolean(),
  confidence: z.number().min(0).max(100),
  achieved_purpose: z.boolean(),
  issues: z.array(z.object({
    type: z.nativeEnum(ToolReflectionIssueType),
    description: z.string(),
    severity: z.nativeEnum(ToolReflectionSeverity),
  })).default([]),
  retry_suggested: z.boolean(),
  retry_reason: z.string().optional(),
  alternative_parameters: z.record(JSONValueSchema).optional(),
  insights: z.array(z.string()).default([]),
}) satisfies z.ZodTypeAny;

export type IToolReflection = z.infer<typeof ToolReflectionSchema>;

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Default Prompt Template
// ============================================================================

const DEFAULT_REFLECTION_PROMPT = `You are evaluating whether a tool call achieved its intended purpose.

## Tool Call Information
Tool Name: {tool_name}
Purpose: {purpose}
Parameters: {parameters}

## Tool Result
Success: {success}
Output: {output}
Error: {error}

## Your Task
Evaluate whether this tool call achieved its purpose. Consider:

1. **Success Status**: Did the tool execute without errors?
2. **Output Validity**: Is the output meaningful and usable?
3. **Purpose Alignment**: Does the output fulfill the stated purpose?
4. **Data Quality**: Is the data complete and well-formed?
5. **Side Effects**: Are there any unexpected consequences?

## Response Format
Respond with a JSON object:
{
  "success": <true if tool call succeeded>,
  "confidence": <0-100 confidence in assessment>,
  "achieved_purpose": <true if purpose was fulfilled>,
  "issues": [
    {
      "type": "error, incomplete, unexpected, timeout, permission, format, or other",
      "description": "Issue description",
      "severity": "critical, major, or minor"
    }
  ],
  "retry_suggested": <true if retry would help>,
  "retry_reason": "Why retry might help (if applicable)",
  "alternative_parameters": { "key": "value" } (if retry suggested),
  "insights": ["Insight 1", "Insight 2"]
}`;

// ============================================================================
// ToolReflector Class
// ============================================================================

export class ToolReflector {
  private agentRunner: IToolAgentExecutor;
  private outputValidator: IOutputValidator;

  private config: {
    maxRetries: number;
    reflectionThreshold: number;
    parallelExecution: boolean;
    reflectionPromptTemplate: string;
    verbose: boolean;
    db?: IDatabaseService;
    logger?: IEventLogger;
  };

  private metrics: IToolReflectorMetrics = {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    totalRetries: 0,
    retryRate: 0,
    averageRetriesPerCall: 0,
    toolDistribution: {},
    issueTypeDistribution: {},
  };

  constructor(
    agentRunner: IToolAgentExecutor,
    outputValidator: IOutputValidator,
    config: IToolReflectorConfig = {},
  ) {
    const {
      maxRetries = 2,
      reflectionThreshold = 70,
      parallelExecution = true,
      reflectionPromptTemplate = DEFAULT_REFLECTION_PROMPT,
      verbose = false,
      db,
      logger,
    } = config;

    this.config = {
      maxRetries,
      reflectionThreshold,
      parallelExecution,
      reflectionPromptTemplate,
      verbose,
      db,
      logger,
    };

    this.agentRunner = agentRunner;
    this.outputValidator = outputValidator;
  }

  /**
   * Execute a tool call with reflection
   */
  async executeWithReflection(
    toolCall: IToolCall,
    executor: (params: Record<string, JSONValue>) => Promise<IToolResult>,
    traceId?: string,
  ): Promise<IReflectedToolResult> {
    let currentParams = { ...toolCall.parameters };
    let retryCount = 0;
    let lastResult: IToolResult | null = null;
    let lastReflection: IToolReflection | null = null;

    this.metrics.totalCalls++;
    this.metrics.toolDistribution[toolCall.name] = (this.metrics.toolDistribution[toolCall.name] || 0) + 1;

    while (retryCount <= this.config.maxRetries) {
      lastResult = await executor(currentParams);

      lastReflection = await this.reflect(toolCall, lastResult, traceId);

      this.updateMetrics(lastReflection);

      if (this.config.verbose) {
        logDebug(
          `Tool reflection: ${toolCall.name} - success=${lastReflection.success}, confidence=${lastReflection.confidence}, retry=${lastReflection.retry_suggested}`,
          {
            tool_name: toolCall.name,
            success: lastReflection.success,
            confidence: lastReflection.confidence,
            retry_suggested: lastReflection.retry_suggested,
            retry_count: retryCount,
            service: "tool-reflector",
            trace_id: traceId ?? null,
          } as LogMetadata,
        );
      }

      if (this.shouldAccept(lastReflection)) {
        this.metrics.successfulCalls++;
        break;
      }

      if (!lastReflection.retry_suggested || retryCount >= this.config.maxRetries) {
        this.metrics.failedCalls++;
        break;
      }

      if (lastReflection.alternative_parameters) {
        currentParams = { ...currentParams, ...lastReflection.alternative_parameters };
      }

      retryCount++;
      this.metrics.totalRetries++;

      this.logActivity("tool_reflector", "tool.retry", toolCall.name, {
        retryCount,
        reason: lastReflection.retry_reason ?? null,
        newParams: currentParams,
      }, traceId);
    }

    this.updateAggregateMetrics();

    return {
      ...lastResult!,
      reflection: lastReflection!,
      retryCount,
      finalOutput: lastResult!.output,
    };
  }

  /**
   * Execute multiple tool calls, potentially in parallel
   */
  async executeMultiple(
    toolCalls: IToolCall[],
    executor: (call: IToolCall) => Promise<IToolResult>,
    traceId?: string,
  ): Promise<IReflectedToolResult[]> {
    if (!this.config.parallelExecution) {
      const results: IReflectedToolResult[] = [];
      for (const call of toolCalls) {
        const result = await this.executeWithReflection(
          call,
          (params) => executor({ ...call, parameters: params }),
          traceId,
        );
        results.push(result);
      }
      return results;
    }

    const dependencyGroups = this.groupByDependencies(toolCalls);
    const results: IReflectedToolResult[] = [];
    const completedCalls = new Map<string, IReflectedToolResult>();

    for (const group of dependencyGroups) {
      const groupPromises = group.map((call) =>
        this.executeWithReflection(
          call,
          (params) => executor({ ...call, parameters: params }),
          traceId,
        ).then((result) => {
          completedCalls.set(call.id, result);
          return result;
        })
      );

      const groupResults = await Promise.all(groupPromises);
      results.push(...groupResults);
    }

    return results;
  }

  /**
   * Reflect on a tool result
   */
  private async reflect(toolCall: IToolCall, result: IToolResult, traceId?: string): Promise<IToolReflection> {
    const reflectionPrompt = this.config.reflectionPromptTemplate
      .replace("{tool_name}", toolCall.name)
      .replace("{purpose}", toolCall.purpose)
      .replace("{parameters}", JSON.stringify(toolCall.parameters, null, 2))
      .replace("{success}", String(result.success))
      .replace("{output}", this.formatOutput(result.output))
      .replace("{error}", result.error || "None");

    const blueprint = {
      systemPrompt:
        "You are a tool result evaluator. Assess whether tool calls achieved their purpose. Provide structured JSON output.",
      identityId: "tool-reflector",
    };

    const request = {
      userPrompt: reflectionPrompt,
      context: {},
      traceId,
    };

    const llmResult = await this.agentRunner.run(blueprint, request);

    const validationResult = this.outputValidator.validate(llmResult.content, ToolReflectionSchema);
    if (validationResult.success && validationResult.value) {
      return validationResult.value;
    }

    return this.createDefaultReflection(result);
  }

  /**
   * Determine if reflection result should be accepted
   */
  private shouldAccept(reflection: IToolReflection): boolean {
    if (!reflection.success) return false;
    if (!reflection.achieved_purpose) return false;
    if (reflection.confidence < this.config.reflectionThreshold) return false;

    const hasCriticalIssues = reflection.issues.some((i) => i.severity === ToolReflectionSeverity.CRITICAL);
    if (hasCriticalIssues) return false;

    return true;
  }

  /**
   * Group tool calls by dependencies for parallel execution
   */
  private groupByDependencies(toolCalls: IToolCall[]): IToolCall[][] {
    const groups: IToolCall[][] = [];
    const completed = new Set<string>();
    const remaining = [...toolCalls];

    while (remaining.length > 0) {
      const currentGroup: IToolCall[] = [];

      for (let i = remaining.length - 1; i >= 0; i--) {
        const call = remaining[i];
        const deps = call.dependencies || [];
        const allDepsComplete = deps.every((dep) => completed.has(dep));

        if (allDepsComplete) {
          currentGroup.push(call);
          remaining.splice(i, 1);
        }
      }

      if (currentGroup.length === 0 && remaining.length > 0) {
        currentGroup.push(remaining.shift()!);
      }

      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup.forEach((c) => completed.add(c.id));
      }
    }

    return groups;
  }

  private formatOutput(output: JSONValue): string {
    if (output === null || output === undefined) return "null";
    if (typeof output === "string") {
      return output.length > 1000 ? output.substring(0, 1000) + "... (truncated)" : output;
    }
    try {
      const json = JSON.stringify(output, null, 2);
      return json.length > 1000 ? json.substring(0, 1000) + "... (truncated)" : json;
    } catch {
      return String(output);
    }
  }

  private createDefaultReflection(result: IToolResult): IToolReflection {
    return {
      success: result.success,
      confidence: result.success ? 60 : 20,
      achieved_purpose: result.success,
      issues: result.error
        ? [{
          type: ToolReflectionIssueType.ERROR,
          description: result.error,
          severity: ToolReflectionSeverity.MAJOR,
        }]
        : [],
      retry_suggested: !result.success,
      insights: [],
    };
  }

  private updateMetrics(reflection: IToolReflection): void {
    for (const issue of reflection.issues) {
      this.metrics.issueTypeDistribution[issue.type] = (this.metrics.issueTypeDistribution[issue.type] || 0) + 1;
    }
  }

  private updateAggregateMetrics(): void {
    if (this.metrics.totalCalls > 0) {
      this.metrics.retryRate = this.metrics.totalRetries / this.metrics.totalCalls;
      this.metrics.averageRetriesPerCall = this.metrics.totalRetries / this.metrics.totalCalls;
    }
  }

  private logActivity(
    _actor: string,
    actionType: string,
    target: string,
    payload: Record<string, JSONValue>,
    traceId?: string,
  ): void {
    if (this.config.logger) {
      this.config.logger.info(
        actionType,
        target,
        toSafeJson(payload) as Record<string, JSONValue>,
        traceId,
      );
    }
  }

  getMetrics(): IToolReflectorMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalRetries: 0,
      retryRate: 0,
      averageRetriesPerCall: 0,
      toolDistribution: {},
      issueTypeDistribution: {},
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createToolReflector(
  agentRunner: IToolAgentExecutor,
  outputValidator: IOutputValidator,
  config?: IToolReflectorConfig,
): ToolReflector {
  return new ToolReflector(agentRunner, outputValidator, config);
}

export function createStrictToolReflector(
  agentRunner: IToolAgentExecutor,
  outputValidator: IOutputValidator,
  config?: IToolReflectorConfig,
): ToolReflector {
  return new ToolReflector(agentRunner, outputValidator, {
    maxRetries: 3,
    reflectionThreshold: 85,
    parallelExecution: false,
    ...config,
  });
}

export function createFastToolReflector(
  agentRunner: IToolAgentExecutor,
  outputValidator: IOutputValidator,
  config?: IToolReflectorConfig,
): ToolReflector {
  return new ToolReflector(agentRunner, outputValidator, {
    maxRetries: 1,
    reflectionThreshold: 50,
    parallelExecution: true,
    ...config,
  });
}
