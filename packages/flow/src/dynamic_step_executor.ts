/**
 * @module DynamicStepExecutor
 * @path packages/flow/src/dynamic_step_executor.ts
 * @description Executes a flow step in dynamic mode: the model receives the step
 * objective and iteratively selects tools from permitted_tools via a ReAct loop
 * until the objective is satisfied or max_iterations is reached.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/flow_runner.ts, "packages/schemas/src/flow.ts"]
 */

import type { IFlowStep } from "@exaix/schemas/flow.ts";
import type { IBlueprintFrontmatter } from "@exaix/schemas/blueprint.ts";
import {
  DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S,
  FlowStepExecutionMode,
  TOOL_CONFIRMATION_EVENT_APPROVED,
  TOOL_CONFIRMATION_EVENT_DENIED,
  ToolErrorCode,
} from "@exaix/core";
import type { IHitlPolicyEvaluator, IToolConfirmationInterceptor, IToolManifestResolver } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import { DYNAMIC_MODE_APPROVAL_TOOLS, DYNAMIC_MODE_TOOLS, type McpToolName } from "@exaix/mcp";
import type { JSONValue } from "@exaix/core";
import { MILESTONE_TOOL_CALL_COMPLETED, MILESTONE_TOOL_CALL_STARTED } from "@exaix/core";
import type { IMilestoneEmitter } from "@exaix/core/observability";
import type { ILlmClient, ToolArgs } from "@exaix/ai";
import type { IMcpClient } from "@exaix/mcp";
import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import type { IExecutionMilestone } from "@exaix/schemas";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Journal entry for activity logging
 */
export type JournalEntry = Record<string, JSONValue>;

/**
 * Result from a dynamic step execution
 */
export interface IDynamicStepResult {
  stepId: string;
  output: string;
  toolCallsLog: IDynamicToolCall[];
  iterations: number;
  completed: boolean;
}

/**
 * Log of a single tool call during dynamic execution
 */
export interface IDynamicToolCall {
  tool: McpToolName;
  args: ToolArgs;
  result: string;
  timestamp: string;
}

/**
 * Options for dynamic step execution
 */
export interface IDynamicStepExecutorOptions {
  /** Maximum ReAct iterations before the step is considered complete regardless */
  maxIterations?: number;
  /** Trace ID for Activity Journal correlation */
  traceId: string;
  /** Config subset for runtime behaviour — if absent, defaults apply */
  config?: { tools?: { confirmation_timeout_s?: number } };
}

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Activity journal interface for audit logging
 */
export interface IActivityJournal {
  log(entry: JournalEntry): Promise<void>;
}

/**
 * Executes a single flow step in dynamic (ReAct) mode.
 * The model iteratively selects tools from step.permitted_tools,
 * observes results, and continues until the objective is met.
 *
 * Invariant: only tools in DYNAMIC_MODE_TOOLS (derived from the canonical manifest)
 * may appear in the effective permitted_tools.
 * This is enforced at load time by FlowLoader and validated here defensively.
 */
export class DynamicStepExecutor {
  private emitMilestoneFn?: (milestone: IExecutionMilestone) => Promise<void>;

  constructor(
    private readonly mcpClient: IMcpClient & IToolManifestResolver,
    private readonly llmClient: ILlmClient,
    private readonly activityJournal: IActivityJournal,
    readonly confirmationInterceptor?: IToolConfirmationInterceptor,
    milestoneEmitter?: IMilestoneEmitter,
    private readonly hitlPolicyEvaluator?: IHitlPolicyEvaluator,
  ) {
    this.emitMilestoneFn = milestoneEmitter?.emit.bind(milestoneEmitter);
  }

  private async emitMilestone(
    milestoneType: IExecutionMilestone["milestoneType"],
    traceId: string,
    summary: string,
  ): Promise<void> {
    if (!this.emitMilestoneFn) return;
    await this.emitMilestoneFn({
      milestoneId: crypto.randomUUID(),
      traceId,
      milestoneType,
      requiresAttention: false,
      occurredAt: new Date().toISOString(),
      summary,
    });
  }

  async execute(
    step: IFlowStep,
    identity: IBlueprintFrontmatter,
    input: string,
    opts: IDynamicStepExecutorOptions,
  ): Promise<IDynamicStepResult> {
    if (step.execution_mode !== FlowStepExecutionMode.DYNAMIC) {
      throw new Error(
        `DynamicStepExecutor called on step "${step.id}" which is not in dynamic mode`,
      );
    }

    // Defensive: enforce read-only boundary at runtime even if loader validation passed
    const effectiveTools = this.resolvePermittedTools(step, identity);
    const toolCallsLog: IDynamicToolCall[] = [];

    let context = input;
    let iterations = 0;
    const maxIterations = step.timeout
      ? Math.min(DEFAULT_MAX_ITERATIONS, Math.floor(step.timeout / 1000))
      : DEFAULT_MAX_ITERATIONS;

    while (iterations < maxIterations) {
      iterations++;

      const toolsMetadata = this.mcpClient.getToolDefinitions(effectiveTools);

      // ReAct: model reasons about what tool to call next (or declares done)
      const decision = await this.llmClient.reasonNextAction({
        identity,
        stepObjective: step.name,
        accumulatedContext: context,
        availableTools: toolsMetadata,
        iteration: iterations,
        maxIterations,
      });

      if (decision.done) {
        // Model has declared the step objective is met
        await this.activityJournal.log({
          traceId: opts.traceId,
          stepId: step.id,
          event: "dynamic_step_completed",
          iterations,
          toolCallCount: toolCallsLog.length,
        });
        return {
          stepId: step.id,
          output: decision.output ?? context,
          toolCallsLog,
          iterations,
          completed: true,
        };
      }

      // Validate tool choice against permitted list (runtime guard)
      if (!decision.tool || !effectiveTools.includes(decision.tool)) {
        throw new Error(
          `Dynamic step "${step.id}": model selected tool "${decision.tool}" ` +
            `which is not in permitted_tools. Permitted: [${effectiveTools.join(", ")}]`,
        );
      }

      const policyMatch = this.hitlPolicyEvaluator?.evaluate(
        identity.hitl?.require_secondary_approval ?? [],
        decision.tool,
        decision.args ?? {},
      );

      if (this.mcpClient.requiresHumanApproval(decision.tool) || policyMatch) {
        if (!this.confirmationInterceptor) {
          throw new Error(
            `Dynamic step "${step.id}": tool "${decision.tool}" requires human approval but no confirmation interceptor is configured`,
          );
        }

        if (policyMatch) {
          await this.activityJournal.log({
            traceId: opts.traceId,
            stepId: step.id,
            event: DomainEventType.HitlPolicyMatched,
            tool: decision.tool,
            ruleSource: policyMatch.source,
            reason: policyMatch.rule.reason,
            surface: "dynamic",
          });
        }

        const confirmationRequest = this.createConfirmationRequest(
          decision.tool,
          decision.args ?? {},
          step.id,
          opts.traceId,
          opts.config?.tools?.confirmation_timeout_s,
          policyMatch?.rule.reason,
        );
        const approvalDecision = await this.confirmationInterceptor.requestApproval(confirmationRequest);

        if (!approvalDecision.approved) {
          const denialText = this.formatDenialObservation(decision.tool, approvalDecision.reason);

          await this.activityJournal.log({
            traceId: opts.traceId,
            stepId: step.id,
            event: TOOL_CONFIRMATION_EVENT_DENIED,
            tool: decision.tool,
            confirmationId: confirmationRequest.id,
            toolErrorCode: ToolErrorCode.PERMISSION_DENIED,
            ...(approvalDecision.reason !== undefined ? { reason: approvalDecision.reason } : {}),
            ...(approvalDecision.decidedBy !== undefined ? { decidedBy: approvalDecision.decidedBy } : {}),
          });

          context = this.appendObservation(context, decision.tool, denialText);
          continue;
        }

        await this.activityJournal.log({
          traceId: opts.traceId,
          stepId: step.id,
          event: TOOL_CONFIRMATION_EVENT_APPROVED,
          tool: decision.tool,
          confirmationId: confirmationRequest.id,
          ...(approvalDecision.decidedBy !== undefined ? { decidedBy: approvalDecision.decidedBy } : {}),
        });
      }

      // Execute the tool call
      await this.emitMilestone(MILESTONE_TOOL_CALL_STARTED, opts.traceId, `Tool call started: ${decision.tool}`);
      const toolResult = await this.mcpClient.callTool(
        decision.tool,
        decision.args ?? {},
      );
      await this.emitMilestone(MILESTONE_TOOL_CALL_COMPLETED, opts.traceId, `Tool call completed: ${decision.tool}`);

      const call: IDynamicToolCall = {
        tool: decision.tool,
        args: decision.args ?? {},
        result: toolResult,
        timestamp: new Date().toISOString(),
      };
      toolCallsLog.push(call);

      // Journal every tool call for auditability (identical to declared mode)
      await this.activityJournal.log({
        traceId: opts.traceId,
        stepId: step.id,
        event: "dynamic_tool_call",
        tool: decision.tool,
        args: decision.args,
        resultSummary: toolResult.substring(0, 200),
        iteration: iterations,
      });

      // Feed observation back into context for next iteration
      context = this.appendObservation(context, decision.tool, toolResult);
    }

    // Max iterations reached — return with what we have
    await this.activityJournal.log({
      traceId: opts.traceId,
      stepId: step.id,
      event: "dynamic_step_max_iterations_reached",
      iterations,
      toolCallCount: toolCallsLog.length,
    });

    return {
      stepId: step.id,
      output: context,
      toolCallsLog,
      iterations,
      completed: false,
    };
  }

  /**
   * Resolves the effective permitted_tools for a step:
   * 1. Start with identity blueprint's permitted_tools
   * 2. Narrow to step's permitted_tools if specified
   * 3. Filter to READ_ONLY_TOOLS only (defensive runtime enforcement)
   */
  protected resolvePermittedTools(
    step: IFlowStep,
    identity: IBlueprintFrontmatter,
  ): McpToolName[] {
    const identityTools = new Set(identity.permitted_tools ?? []);
    const allowedDynamicTools = this.confirmationInterceptor
      ? new Set<McpToolName>([
        ...([...DYNAMIC_MODE_TOOLS] as McpToolName[]),
        ...([...DYNAMIC_MODE_APPROVAL_TOOLS] as McpToolName[]),
      ])
      : new Set<McpToolName>([...DYNAMIC_MODE_TOOLS] as McpToolName[]);

    const stepTools = step.permitted_tools?.length ? step.permitted_tools : [...identityTools];

    return stepTools.filter((tool) => {
      const mcpTool = tool as McpToolName;
      const isAllowed = allowedDynamicTools.has(mcpTool) && identityTools.has(mcpTool);
      if (!isAllowed) {
        console.warn(
          `Dynamic step "${step.id}": tool "${tool}" filtered out at runtime ` +
            `(must be dynamic-mode allowed per manifest and in identity permitted_tools)`,
        );
      }
      return isAllowed;
    }) as McpToolName[];
  }

  private appendObservation(
    context: string,
    tool: McpToolName,
    result: string,
  ): string {
    return `${context}\n\n[Tool: ${tool}]\n${result}`;
  }

  private createConfirmationRequest(
    tool: McpToolName,
    args: ToolArgs,
    stepId: string,
    traceId: string,
    timeoutS?: Opt<number, Reason.ExecutionConfig>,
    reason?: Opt<string, Reason.OptionalInput>,
  ): ToolConfirmationRequest {
    const requestedAt = new Date();
    const expiresAt = new Date(
      requestedAt.getTime() + (timeoutS ?? DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S) * 1000,
    );

    return {
      id: crypto.randomUUID(),
      toolName: tool,
      args,
      stepId,
      traceId,
      reason,
      requestedAt: requestedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  private formatDenialObservation(
    tool: McpToolName,
    reason?: Opt<string, Reason.OptionalInput>,
  ): string {
    return `Tool '${tool}' call denied: ${reason ?? "User declined"}`;
  }
}
