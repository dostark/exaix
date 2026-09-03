/**
 * @module LegacyAgentStrategy
 * @path packages/execution/src/strategies/legacy_strategy.ts
 * @description Sub-agent execution through direct model generation (simulated tasks).
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_orchestrator.ts, packages/execution/src/strategies/execution_strategy.ts]
 */

import type { IExecutionStrategy } from "./execution_strategy.ts";
import { AgentExecutionError, type AgentOrchestrator, type IAgentFileBlueprint } from "../agent_orchestrator.ts";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IModelCallOptions } from "@exaix/schemas";
import { parse as parseToml } from "@std/toml";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { computeRegistryPredictedCost } from "../registry_computed_cost.ts";
import {
  AgentExecutionErrorType,
  LEGACY_EXECUTION_MAX_TOKENS,
  LEGACY_EXECUTION_TEMPERATURE,
  TOML_BLOCK_PATTERN,
} from "@exaix/core";
import type { McpToolName } from "@exaix/mcp";
import type { IToolResult } from "@exaix/core/types";
import { WRITE_TOOLS } from "@exaix/mcp";

/**
 * Legacy execution strategy that uses direct LLM generation (simulation)
 */
export class LegacyAgentStrategy implements IExecutionStrategy {
  public readonly name = "legacy";
  /** Per-call options (thinking/effort/max_tokens) set by agent_executor before execute(). */
  public callOptions?: IModelCallOptions;

  constructor(
    private executor: AgentOrchestrator,
    private provider?: Opt<IModelProvider, Reason.OptionalDependency>,
  ) {}

  async execute(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
  ): Promise<IChangesetResult> {
    const startTime = Date.now();

    if (!this.provider) {
      return this.buildFallbackResult(context, startTime);
    }

    const prompt = await this.executor.buildExecutionPrompt(blueprint, context, options);
    const generateStartTime = Date.now();
    const result = await this.provider.generate(prompt, {
      temperature: LEGACY_EXECUTION_TEMPERATURE,
      max_tokens: LEGACY_EXECUTION_MAX_TOKENS,
      ...this.callOptions,
    });
    const generateDurationMs = Date.now() - generateStartTime;

    // Re-price this call's real, already-measured token counts against the real per-model
    // split rate (static_overlay.ts), falling back to the flat-rate result.cost_usd unchanged
    // when the model has no overlay entry. Still a PREDICTED estimate.
    const registryCostUsd = computeRegistryPredictedCost(result.provider, result.model, {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheCreationTokens: result.usage.cacheCreationTokens,
    });
    const costUsd = registryCostUsd ?? result.cost_usd ?? 0;

    // Log individual generation metrics
    await this.executor.logGeneration(
      context.trace_id,
      options.agent_role ?? "",
      result.model,
      result.provider,
      { ...result.usage, costUsd, durationMs: generateDurationMs },
    );

    const response = result.content;
    const { toolCallCount, filesChanged } = await this.executeTomlActions(response, options);
    const parsedResult = this.executor.parseAgentResponse(response, context, startTime);

    parsedResult.tool_calls = toolCallCount;
    parsedResult.files_changed = Array.from(
      new Set([...(parsedResult.files_changed || []), ...filesChanged]),
    );

    // Attach usage metrics
    parsedResult.usage = {
      prompt_tokens: result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      cost_usd: costUsd,
      cache_read_tokens: result.usage.cacheReadTokens,
      cache_creation_tokens: result.usage.cacheCreationTokens,
      reasoning_tokens: result.usage.reasoningTokens,
      // LegacyAgentStrategy's cost_usd is always a predicted estimate (registry-computed
      // per-model split price when available, else the flat-rate fallback) — no direct-API
      // provider ever returns a real reported figure — so "predicted".
      cost_source: "predicted",
    };

    return this.executor.validateReviewResult(parsedResult);
  }

  /** Returns the total tool call count and set of changed files. */
  private async executeTomlActions(
    response: string,
    options: IAgentExecutionOptions,
  ): Promise<{ toolCallCount: number; filesChanged: Set<string> }> {
    let toolCallCount = 0;
    const filesChanged = new Set<string>();

    for (const match of response.matchAll(TOML_BLOCK_PATTERN)) {
      const blockActions = this.parseTomlBlock(match[1]);
      for (const act of blockActions) {
        if (!act.tool) continue;

        const toolResult = await this.executeTool(act.tool, act.params || {}, options);
        if (!toolResult.success) {
          throw new AgentExecutionError(
            `Action ${act.tool} failed: ${toolResult.error}`,
            AgentExecutionErrorType.EXECUTION_ERROR,
          );
        }

        toolCallCount++;
        this.trackFileChanges(act, toolResult, options, filesChanged);
      }
    }

    return { toolCallCount, filesChanged };
  }

  /**
   * Parse a single TOML block into action items.
   */
  private parseTomlBlock(
    block: string,
  ): Array<{ tool: string; params?: Record<string, JSONValue>; description?: string }> {
    try {
      const parsed = parseToml(block.trim()) as {
        actions?: Array<{ tool: string; params?: Record<string, JSONValue>; description?: string }>;
      };
      if (parsed.actions && Array.isArray(parsed.actions)) {
        return parsed.actions;
      }
    } catch {
      // Skip malformed block
    }
    return [];
  }

  /**
   * Track file changes from tool execution for audit purposes.
   */
  private trackFileChanges(
    action: { tool: string; params?: Record<string, JSONValue> },
    toolResult: IToolResult,
    options: IAgentExecutionOptions,
    filesChanged: Set<string>,
  ): void {
    if (
      !WRITE_TOOLS.has(action.tool as McpToolName) ||
      !toolResult.data ||
      typeof toolResult.data !== "object" ||
      !("path" in toolResult.data)
    ) {
      return;
    }

    const fullPath = String(toolResult.data.path);
    const portal = this.executor.getPortalConfig(options.portal);
    if (!portal) return;

    const relativePath = fullPath.startsWith(portal.target_path)
      ? fullPath.substring(portal.target_path.length).replace(/^[\/\\]/, "")
      : fullPath;

    filesChanged.add(relativePath);
  }

  /**
   * Build a fallback result when no provider is available.
   */
  private buildFallbackResult(
    context: IExecutionContext,
    startTime: number,
  ): IChangesetResult {
    return {
      branch: `feat/${context.request_id}-${context.trace_id.slice(0, 8)}`,
      commit_sha: "abc1234567890abcdef",
      files_changed: [],
      description: context.plan,
      tool_calls: 0,
      execution_time_ms: Date.now() - startTime,
    };
  }

  private async executeTool(
    tool: string,
    params: Record<string, JSONValue>,
    options: IAgentExecutionOptions,
  ): Promise<IToolResult> {
    if (!this.executor.toolRegistry) {
      throw new AgentExecutionError("ToolRegistry not available", AgentExecutionErrorType.CONFIGURATION_ERROR);
    }

    // Ensure portal isolation via path prefixing
    const enrichedParams = { ...params };
    if (
      options.portal && enrichedParams.path && typeof enrichedParams.path === "string" &&
      !enrichedParams.path.startsWith("@")
    ) {
      enrichedParams.path = `@${options.portal}/${enrichedParams.path}`;
    }

    return await this.executor.toolRegistry.execute(tool, enrichedParams);
  }
}
