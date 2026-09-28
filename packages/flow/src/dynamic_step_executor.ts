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
import type { McpToolName } from "@exaix/mcp";
import type { JSONValue } from "@exaix/core";
import type { IModelCallOptions } from "@exaix/schemas";
import {
  ACTIVITY_EVENT_DYNAMIC_TOOL_CALL,
  MILESTONE_TOOL_CALL_COMPLETED,
  MILESTONE_TOOL_CALL_STARTED,
} from "@exaix/core";
import type { IMilestoneEmitter } from "@exaix/core/observability";
import type { ILlmClient, INativeConversationSnapshot, ToolArgs } from "@exaix/ai";
import type { IProviderToolCall } from "@exaix/ai/providers";
import type { IProviderTurn } from "@exaix/ai";
import type { ProviderCostStatus } from "@exaix/ai/providers";
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

interface IDynamicModelUsageTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd?: number;
  costStatus?: ProviderCostStatus;
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
  config?: {
    tools?: { confirmation_timeout_s?: number };
    execution?: { native_tools_enabled?: boolean };
  };
}

/** For audit logging. */
export interface IActivityJournal {
  log(entry: JournalEntry): Promise<void>;
}

const DEFAULT_MAX_ITERATIONS = 10;

/** Invariant: only tools in DYNAMIC_MODE_TOOLS (derived from the canonical manifest) may
 *  appear in the effective permitted_tools — enforced at load time by FlowLoader and
 *  validated here defensively. */
export class DynamicStepExecutor {
  private emitMilestoneFn?: (milestone: IExecutionMilestone) => Promise<void>;

  constructor(
    private readonly mcpClient: IMcpClient & IToolManifestResolver,
    private readonly llmClient: ILlmClient,
    private readonly activityJournal: IActivityJournal,
    readonly confirmationInterceptor?: Opt<IToolConfirmationInterceptor, Reason.OptionalDependency>,
    milestoneEmitter?: Opt<IMilestoneEmitter, Reason.OptionalDependency>,
    private readonly hitlPolicyEvaluator?: Opt<IHitlPolicyEvaluator, Reason.OptionalDependency>,
    private readonly dynamicModeTools: ReadonlySet<string> = new Set(),
    private readonly dynamicModeApprovalTools: ReadonlySet<string> = new Set(),
    /** Per-call model options (thinking/effort/max_tokens) forwarded on every ReAct generate. */
    private readonly callOptions?: Opt<IModelCallOptions, Reason.OptionalInput>,
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
    agent_role: IBlueprintFrontmatter,
    input: string,
    opts: IDynamicStepExecutorOptions,
  ): Promise<IDynamicStepResult> {
    if (step.execution_mode !== FlowStepExecutionMode.DYNAMIC) {
      throw new Error(
        `DynamicStepExecutor called on step "${step.id}" which is not in dynamic mode`,
      );
    }

    // Defensive: enforce read-only boundary at runtime even if loader validation passed
    const effectiveTools = this.resolvePermittedTools(step, agent_role);
    const toolCallsLog: IDynamicToolCall[] = [];

    let context = input;
    let iterations = 0;
    const modelUsage: IDynamicModelUsageTotals = {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    const nativeToolsEnabled = opts.config?.execution?.native_tools_enabled ?? false;
    const initialTools = this.mcpClient.getToolDefinitions(effectiveTools);
    let nativeConversation: INativeConversationSnapshot | undefined = nativeToolsEnabled
      ? await this.llmClient.createNativeConversation({
        agentRole: agent_role,
        stepObjective: step.name,
        originalInput: input,
        availableTools: initialTools,
      })
      : undefined;
    const maxIterations = step.timeout
      ? Math.min(DEFAULT_MAX_ITERATIONS, Math.floor(step.timeout / 1000))
      : DEFAULT_MAX_ITERATIONS;

    while (iterations < maxIterations) {
      iterations++;

      const toolsMetadata = this.mcpClient.getToolDefinitions(effectiveTools);

      // ReAct: model reasons about what tool to call next (or declares done)
      const decision = await this.llmClient.reasonNextAction({
        agent_role,
        stepObjective: step.name,
        accumulatedContext: context,
        availableTools: toolsMetadata,
        iteration: iterations,
        maxIterations,
        // Forward the resolver's per-call options; undefined is backward compatible.
        options: this.callOptions,
        nativeToolsEnabled,
        traceId: opts.traceId,
        flowStepEffort: step.effort,
        flowStepThinking: step.thinking,
        ...(nativeConversation ? { nativeConversation } : {}),
      });
      this.addModelUsage(modelUsage, decision);

      if (decision.done) {
        // Model has declared the step objective is met
        await this.activityJournal.log({
          traceId: opts.traceId,
          stepId: step.id,
          event: "dynamic_step_completed",
          iterations,
          toolCallCount: toolCallsLog.length,
          ...this.modelUsagePayload(modelUsage),
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

      const denialText = await this.requestApprovalIfRequired(
        decision.tool,
        decision.args ?? {},
        agent_role,
        step.id,
        opts.traceId,
        opts.config?.tools?.confirmation_timeout_s,
      );
      if (denialText !== undefined) {
        context = this.appendObservation(context, decision.tool, denialText);
        nativeConversation = this.appendNativeTurn(
          nativeConversation,
          decision.nativeToolCall,
          decision.tool,
          decision.args ?? {},
          denialText,
          true,
        );
        continue;
      }

      // Execute the tool call
      await this.emitMilestone(MILESTONE_TOOL_CALL_STARTED, opts.traceId, `Tool call started: ${decision.tool}`);
      const toolResult = await this.mcpClient.callTool(
        decision.tool,
        decision.args ?? {},
        {
          traceId: opts.traceId,
          ...(decision.provider ? { provider: decision.provider } : {}),
          ...(decision.model ? { model: decision.model } : {}),
        },
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
        event: ACTIVITY_EVENT_DYNAMIC_TOOL_CALL,
        tool: decision.tool,
        args: decision.args,
        resultSummary: toolResult.substring(0, 200),
        iteration: iterations,
      });

      // Feed observation back into context for next iteration
      context = this.appendObservation(context, decision.tool, toolResult);
      nativeConversation = this.appendNativeTurn(
        nativeConversation,
        decision.nativeToolCall,
        decision.tool,
        decision.args ?? {},
        toolResult,
        false,
      );
    }

    // Max iterations reached — return with what we have
    await this.activityJournal.log({
      traceId: opts.traceId,
      stepId: step.id,
      event: "dynamic_step_max_iterations_reached",
      iterations,
      toolCallCount: toolCallsLog.length,
      ...this.modelUsagePayload(modelUsage),
    });

    return {
      stepId: step.id,
      output: context,
      toolCallsLog,
      iterations,
      completed: false,
    };
  }

  /** Agent role's permitted_tools, narrowed to the step's if specified, then filtered to
   *  READ_ONLY_TOOLS (defensive runtime enforcement). */
  protected resolvePermittedTools(
    step: IFlowStep,
    agent_role: IBlueprintFrontmatter,
  ): McpToolName[] {
    const agentRoleTools = new Set(agent_role.permitted_tools ?? []);
    const allowedDynamicTools = this.confirmationInterceptor
      ? new Set<McpToolName>([
        ...([...this.dynamicModeTools] as McpToolName[]),
        ...([...this.dynamicModeApprovalTools] as McpToolName[]),
      ])
      : new Set<McpToolName>([...this.dynamicModeTools] as McpToolName[]);

    const stepTools = step.permitted_tools?.length ? step.permitted_tools : [...agentRoleTools];

    return stepTools.filter((tool) => {
      const mcpTool = tool as McpToolName;
      const isAllowed = allowedDynamicTools.has(mcpTool) && agentRoleTools.has(mcpTool);
      if (!isAllowed) {
        console.warn(
          `Dynamic step "${step.id}": tool "${tool}" filtered out at runtime ` +
            `(must be dynamic-mode allowed per manifest and in agent role permitted_tools)`,
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

  private appendNativeTurn(
    conversation: Opt<INativeConversationSnapshot, Reason.OptionalInput>,
    call: Opt<IProviderToolCall, Reason.OptionalInput>,
    tool: McpToolName,
    args: ToolArgs,
    result: string,
    isError: boolean,
  ): INativeConversationSnapshot | undefined {
    if (!conversation || !call) return conversation;
    const turn: IProviderTurn = {
      toolUseId: call.id,
      toolName: tool,
      toolInput: args,
      toolResultContent: result,
      toolResultIsError: isError,
      ...(call.reasoningContent !== undefined ? { reasoningContent: call.reasoningContent } : {}),
      ...(call.thoughtSignature !== undefined ? { thoughtSignature: call.thoughtSignature } : {}),
      ...(call.thinkingBlocks !== undefined ? { thinkingBlocks: call.thinkingBlocks } : {}),
    };
    return { ...conversation, turns: [...conversation.turns, turn] };
  }

  private addModelUsage(
    totals: IDynamicModelUsageTotals,
    decision: Awaited<ReturnType<ILlmClient["reasonNextAction"]>>,
  ): void {
    if (!decision.usage) return;
    totals.calls++;
    totals.promptTokens += decision.usage.promptTokens;
    totals.completionTokens += decision.usage.completionTokens;
    totals.totalTokens += decision.usage.totalTokens;
    if (decision.costStatus === "unknown") {
      totals.costStatus = "unknown";
      delete totals.costUsd;
      return;
    }
    if (decision.cost_usd !== undefined && totals.costStatus !== "unknown") {
      totals.costUsd = (totals.costUsd ?? 0) + decision.cost_usd;
      totals.costStatus = decision.costStatus ?? totals.costStatus;
    } else if (decision.costStatus !== undefined && totals.costStatus === undefined) {
      totals.costStatus = decision.costStatus;
    }
  }

  private modelUsagePayload(totals: IDynamicModelUsageTotals): JournalEntry {
    if (totals.calls === 0) return {};
    return {
      llmCalls: totals.calls,
      promptTokens: totals.promptTokens,
      completionTokens: totals.completionTokens,
      totalTokens: totals.totalTokens,
      ...(totals.costStatus !== undefined ? { costStatus: totals.costStatus } : {}),
      ...(totals.costStatus !== "unknown" && totals.costUsd !== undefined ? { cost_usd: totals.costUsd } : {}),
    };
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

  private async requestApprovalIfRequired(
    tool: McpToolName,
    args: ToolArgs,
    agentRole: IBlueprintFrontmatter,
    stepId: string,
    traceId: string,
    timeoutSeconds: Opt<number, Reason.OptionalInput>,
  ): Promise<Opt<string, Reason.OptionalInput>> {
    const policyMatch = this.hitlPolicyEvaluator?.evaluate(
      agentRole.hitl?.require_secondary_approval ?? [],
      tool,
      args,
    );
    if (!this.mcpClient.requiresHumanApproval(tool) && !policyMatch) return undefined;
    if (!this.confirmationInterceptor) {
      throw new Error(
        `Dynamic step "${stepId}": tool "${tool}" requires human approval but no confirmation interceptor is configured`,
      );
    }

    if (policyMatch) {
      await this.activityJournal.log({
        traceId,
        stepId,
        event: DomainEventType.HitlPolicyMatched,
        tool,
        ruleSource: policyMatch.source,
        reason: policyMatch.rule.reason,
        surface: "dynamic",
      });
    }

    const confirmationRequest = this.createConfirmationRequest(
      tool,
      args,
      stepId,
      traceId,
      timeoutSeconds,
      policyMatch?.rule.reason,
    );
    const approvalDecision = await this.confirmationInterceptor.requestApproval(confirmationRequest);
    if (!approvalDecision.approved) {
      await this.activityJournal.log({
        traceId,
        stepId,
        event: TOOL_CONFIRMATION_EVENT_DENIED,
        tool,
        confirmationId: confirmationRequest.id,
        toolErrorCode: ToolErrorCode.PERMISSION_DENIED,
        ...(approvalDecision.reason !== undefined ? { reason: approvalDecision.reason } : {}),
        ...(approvalDecision.decidedBy !== undefined ? { decidedBy: approvalDecision.decidedBy } : {}),
      });
      return this.formatDenialObservation(tool, approvalDecision.reason);
    }

    await this.activityJournal.log({
      traceId,
      stepId,
      event: TOOL_CONFIRMATION_EVENT_APPROVED,
      tool,
      confirmationId: confirmationRequest.id,
      ...(approvalDecision.decidedBy !== undefined ? { decidedBy: approvalDecision.decidedBy } : {}),
    });
    return undefined;
  }
}
