/**
 * @module LegacyAgentStrategy
 * @path src/services/agent/strategies/legacy_strategy.ts
 * @description Sub-agent execution through direct model generation (simulated tasks).
 * @architectural-layer Services
 * @related-files [src/services/agent/agent_executor.ts, src/services/agent/strategies/execution_strategy.ts]
 */

import type { IExecutionStrategy } from "./execution_strategy.ts";
import { AgentExecutionError, type AgentExecutor, type IAgentFileBlueprint } from "../agent_executor.ts";
import type {
  IAgentExecutionOptions,
  IChangesetResult,
  IExecutionContext,
} from "../../../shared/schemas/agent_executor.ts";
import type { IModelProvider } from "../../../ai/types.ts";
import { parse as parseToml } from "@std/toml";
import type { JSONValue } from "../../../shared/types/json.ts";
import { AgentExecutionErrorType, type McpToolName } from "../../../shared/enums.ts";
import type { IToolResult } from "../../../shared/interfaces/i_tool_registry.ts";
import {
  LEGACY_EXECUTION_MAX_TOKENS,
  LEGACY_EXECUTION_TEMPERATURE,
  TOML_BLOCK_PATTERN,
  WRITE_TOOLS,
} from "../../../shared/constants.ts";

/**
 * Legacy execution strategy that uses direct LLM generation (simulation)
 */
export class LegacyAgentStrategy implements IExecutionStrategy {
  public readonly name = "legacy";

  constructor(
    private executor: AgentExecutor,
    private provider?: IModelProvider,
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

    const prompt = this.executor.buildExecutionPrompt(blueprint, context, options);
    const response = await this.provider.generate(prompt, {
      temperature: LEGACY_EXECUTION_TEMPERATURE,
      max_tokens: LEGACY_EXECUTION_MAX_TOKENS,
    });

    const { toolCallCount, filesChanged } = await this.executeTomlActions(response, options);
    const result = this.executor.parseAgentResponse(response, context, startTime);

    result.tool_calls = toolCallCount;
    result.files_changed = Array.from(
      new Set([...(result.files_changed || []), ...filesChanged]),
    );

    return this.executor.validateReviewResult(result);
  }

  /**
   * Parse and execute all TOML action blocks from the LLM response.
   * Returns the total tool call count and set of changed files.
   */
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
