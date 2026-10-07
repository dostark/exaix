/**
 * @module LlmClient
 * @path packages/ai/src/llm_client.ts
 * @description ReAct reasoning engine that prompts LLM for next action selection.
 * @architectural-layer AI
 * @related-files [packages/flow/src/dynamic_step_executor.ts, packages/ai/src/providers.ts]
 */
import type { ILlmClient, ToolArgs } from "./types.ts";
import type { EffortDeclaration, IBlueprintFrontmatter, IModelCallOptions, ThinkingDeclaration } from "@exaix/schemas";
import { type Config, ConfigSchema } from "@exaix/schemas";

import {
  canonicalizeToolName,
  DEFAULT_MODEL_FALLBACK,
  McpToolName,
  REACT_DEFAULT_MAX_TOKENS,
  ReActActionType,
  TaskComplexity,
} from "@exaix/core";
import { ProviderFactory } from "./provider_factory.ts";
import type { IModelOptions, IModelProvider, INativeConversationSnapshot } from "./types.ts";
import type { ModelResolver } from "./model_resolver.ts";
import { ProviderRegistry } from "./provider_registry.ts";
import type { IProviderMetadata } from "./provider_registry.ts";
import type { IEventLogger } from "@exaix/core/logger";
import type { ITokenizer } from "@exaix/core/func";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import { PromptBudgetAllocator } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { ContextBudgetExceededError } from "@exaix/core/errors";
import { PromptBudgetSection } from "@exaix/schemas/prompt_budget.ts";
import { measureNativeConversation } from "./native_conversation_budget.ts";
import { EffortResolver } from "./effort_resolver.ts";
import { projectResolvedCallOptions } from "./provider_call_options.ts";
import type { IEffortDeclarations } from "./effort_resolver.ts";
import type { ProviderType } from "@exaix/core";
import type { IGenerateResult, ProviderCostStatus } from "./providers/common.ts";

import { z } from "zod";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

interface RawLlmError {
  message?: string;
  [key: string]: JSONValue | undefined;
}

type LlmErrorPayload = Error | string | object | null | undefined;

function getErrorMessage(error: LlmErrorPayload): string {
  return error instanceof Error ? error.message : String(error);
}

const ReActResponseSchema = z.object({
  reasoning: z.string(),
  action: z.object({
    type: z.nativeEnum(ReActActionType),
    /** A supported alias like `Read` resolves to its canonical name. Retired native aliases
     *  and case variants fail the enum check. */
    tool: z.preprocess(
      (value) => typeof value === "string" ? canonicalizeToolName(value) : value,
      z.nativeEnum(McpToolName),
    ).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    output: z.string().optional(),
  }),
});

const REACT_PROMPT_TEMPLATE = `
You are {agent_role_name}, {agent_role_description}.

Step Objective: {step_objective}

Available Tools:
{tools_description}

Current Context:
{accumulated_context}

Iteration: {iteration} of {max_iterations}

Reason about what action to take next. Either:
1. Select a tool and provide arguments, OR
2. Declare the step complete with your findings

Respond in JSON format:
{
  "reasoning": "Why I'm taking this action",
  "action": {
    "type": "${ReActActionType.TOOL_CALL} | ${ReActActionType.COMPLETE}",
    "tool": "tool_name",
    "args": {...},
    "output": "final output when complete"
  }
}
`;

const NATIVE_REACT_TOOL_INSTRUCTION =
  `Available tools are supplied through the provider tool interface. Use one tool at a time,
or provide a final answer when the objective is complete. Do not write a JSON action envelope.
`;

type IReasonParams = Parameters<ILlmClient["reasonNextAction"]>[0];
type IReasonResult = Awaited<ReturnType<ILlmClient["reasonNextAction"]>>;

export class LlmClient implements ILlmClient {
  constructor(
    private readonly config?: Opt<Config, Reason.OptionalDependency>,
    private readonly testProvider?: Opt<IModelProvider, Reason.TestOverride>,
    private readonly defaultModel: string = DEFAULT_MODEL_FALLBACK,
    private readonly resolver?: Opt<ModelResolver, Reason.OptionalDependency>,
    private readonly logger?: Opt<IEventLogger, Reason.OptionalDependency>,
    private readonly tokenizer: ITokenizer = new AiTokenEstimatorTokenizer(),
    private readonly promptBudgetAllocator?: Opt<Pick<PromptBudgetAllocator, "allocate">, Reason.OptionalDependency>,
  ) {}

  /** Parses "provider:model", "gpt-*" (implicit OpenAI), or a plain model name. */
  private static parseModelString(model: Opt<string, Reason.OptionalInput>): { provider?: string; model?: string } {
    if (!model) return {};

    if (model.includes(":")) {
      const [provider, ...rest] = model.split(":");
      return { provider: provider.trim().toLowerCase(), model: rest.join(":").trim() };
    }

    const normalized = model.trim();
    if (normalized.startsWith("gpt-")) {
      return { provider: "openai", model: normalized };
    }

    return { model: normalized };
  }

  /** Resolves an IModelProvider from the blueprint model string. Blueprint overrides
   *  (provider:model) take priority over env/config; falls back to ProviderFactory. */
  private async resolveProvider(
    model?: Opt<string, Reason.AbstractBoundary>,
  ): Promise<IModelProvider> {
    // When resolver is available, use it directly — no env var mutation needed
    if (this.resolver && model) {
      const resolved = await this.resolver.resolve({ model });
      return ProviderFactory.createByName(
        this.config ?? ConfigSchema.parse({}),
        resolved.model,
        undefined,
        this.logger,
      );
    }
    // Fallback: direct factory call (backward compat)
    const overrides = LlmClient.parseModelString(model);
    const config = this.config ?? ConfigSchema.parse({});
    const effectiveModel = overrides.model || this.defaultModel;
    return await ProviderFactory.createByName(config, effectiveModel, undefined, this.logger);
  }

  async createNativeConversation(params: {
    agentRole: IBlueprintFrontmatter;
    stepObjective: string;
    originalInput: string;
    availableTools: Array<{ name: string; description: string; inputSchema: Record<string, JSONValue> }>;
  }): Promise<INativeConversationSnapshot> {
    const initialPromptSections = [
      {
        section: PromptBudgetSection.SYSTEM,
        text: `\nYou are ${params.agentRole.name}, ${params.agentRole.description ?? "an expert assistant"}.\n\n`,
      },
      {
        section: PromptBudgetSection.PLAN,
        text: `Step Objective: ${params.stepObjective}\n\nOriginal Input:\n${params.originalInput}\n\n`,
      },
      { section: PromptBudgetSection.SYSTEM, text: NATIVE_REACT_TOOL_INSTRUCTION },
    ];
    const initialPrompt = initialPromptSections.map((section) => section.text).join("");
    return await this.measureNativeSnapshot(
      { initialPrompt, initialPromptSections, turns: [] },
      params.agentRole.model ?? this.defaultModel,
      params.availableTools,
      false,
    );
  }

  private async measureNativeSnapshot(
    snapshot: INativeConversationSnapshot,
    model: string,
    tools: readonly { name: string; description: string; inputSchema: Record<string, JSONValue> }[],
    enforceBudget: boolean,
    outputTokens = 0,
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<INativeConversationSnapshot> {
    const sections = [
      ...(snapshot.initialPromptSections ?? [{ section: PromptBudgetSection.SYSTEM, text: snapshot.initialPrompt }]),
      ...(snapshot.turns.length ? [{ section: "loopHistory" as const, text: JSON.stringify(snapshot.turns) }] : []),
      ...(snapshot.roundInstruction !== undefined
        ? [{ section: "loopHistory" as const, text: snapshot.roundInstruction }]
        : []),
    ];
    const projection: JSONValue = {
      initialPrompt: snapshot.initialPrompt,
      turns: snapshot.turns.map((turn) => ({
        toolUseId: turn.toolUseId,
        toolName: turn.toolName,
        toolInput: turn.toolInput,
        toolResultContent: turn.toolResultContent,
        toolResultIsError: turn.toolResultIsError,
        ...(turn.assistantContent !== undefined ? { assistantContent: turn.assistantContent } : {}),
        ...(turn.reasoningContent !== undefined ? { reasoningContent: turn.reasoningContent } : {}),
        ...(turn.thoughtSignature !== undefined ? { thoughtSignature: turn.thoughtSignature } : {}),
        ...(turn.thinkingBlocks !== undefined
          ? { thinkingBlocks: turn.thinkingBlocks.map(({ thinking, signature }) => ({ thinking, signature })) }
          : {}),
      })),
      ...(snapshot.roundInstruction !== undefined ? { roundInstruction: snapshot.roundInstruction } : {}),
      tools: tools.map((tool) => ({
        name: tool.name,
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema,
      })),
    };
    const measurement = await measureNativeConversation(this.tokenizer, model, projection, sections);
    if (enforceBudget) {
      const allocator = this.promptBudgetAllocator ?? new PromptBudgetAllocator(undefined, this.tokenizer);
      const budget = await allocator.allocate(model, {
        systemUsedTokens: measurement.sections.system,
        planUsedTokens: measurement.sections.plan,
        loopHistoryUsedTokens: measurement.sections.loopHistory,
      });
      const inputLimit = Math.max(0, budget.totalBudgetTokens - budget.safetyBufferTokens - outputTokens);
      const overSection = Object.entries(measurement.sections).some(([section, count]) =>
        count > budget.sections[section as keyof typeof budget.sections]
      );
      if (measurement.totalTokens > inputLimit || overSection) {
        await this.logger?.info(DomainEventType.ContextBudgetExceeded, "", {
          model: budget.model,
          contextWindow: budget.totalBudgetTokens,
          inputLimit,
          outputTokens,
          estimatedTokens: measurement.totalTokens,
          sectionBreakdown: measurement.sections,
          tokenSource: measurement.tokenSource,
        }, traceId);
        throw new ContextBudgetExceededError(
          `Dynamic native prompt exceeds the input budget for ${budget.model}`,
          budget.model,
          inputLimit,
          measurement.totalTokens,
          measurement.sections,
        );
      }
    }
    return { ...snapshot, measurement };
  }

  async reasonNextAction(params: IReasonParams): Promise<IReasonResult> {
    const { agent_role } = params;
    const provider = this.testProvider ?? await this.resolveProvider(agent_role.model);
    const providerMetadata = ProviderRegistry.getMetadataForInstance(provider.id);
    const nativeEnabled = params.nativeToolsEnabled === true &&
      providerMetadata?.supportsNativeTools === true &&
      providerMetadata.supportsNativeConversation === true && params.nativeConversation !== undefined;
    const prompt = this.buildPrompt(params, nativeEnabled);
    const generateOptions = await this.buildGenerateOptions(params, provider, providerMetadata, nativeEnabled);
    const result = await provider.generate(prompt, generateOptions);
    return nativeEnabled ? this.parseNativeResult(result, params.availableTools) : this.parseJsonResult(result);
  }

  private buildPrompt(params: IReasonParams, nativeEnabled: boolean): string {
    if (nativeEnabled) return params.nativeConversation!.initialPrompt;
    const toolsDescription = params.availableTools
      .map((tool) => `- ${tool.name}: ${tool.description}\n  Schema: ${JSON.stringify(tool.inputSchema)}`)
      .join("\n");
    return REACT_PROMPT_TEMPLATE
      .replace("{agent_role_name}", params.agent_role.name)
      .replace("{agent_role_description}", params.agent_role.description ?? "an expert assistant")
      .replace("{step_objective}", params.stepObjective)
      .replace("{tools_description}", toolsDescription)
      .replace("{accumulated_context}", params.accumulatedContext || "[No previous tool calls yet]")
      .replace("{iteration}", params.iteration.toString())
      .replace("{max_iterations}", params.maxIterations.toString());
  }

  private async buildGenerateOptions(
    params: IReasonParams,
    provider: IModelProvider,
    metadata: Opt<IProviderMetadata, Reason.OptionalContext>,
    nativeEnabled: boolean,
  ): Promise<IModelOptions | undefined> {
    const options = this.projectCallOptions(
      provider,
      metadata,
      params.agent_role,
      params.flowStepEffort,
      params.flowStepThinking,
      params.options,
    );
    const trace = {
      ...(params.traceId ? { traceId: params.traceId } : {}),
      ...(params.callSite ? { callSite: params.callSite } : {}),
    };
    if (!nativeEnabled) return options || params.traceId || params.callSite ? { ...options, ...trace } : undefined;
    const outputTokens = params.options?.max_tokens ?? this.config?.ai?.max_tokens ?? REACT_DEFAULT_MAX_TOKENS;
    const nativeConversation = await this.measureNativeSnapshot(
      {
        ...params.nativeConversation!,
        roundInstruction:
          `Iteration: ${params.iteration} of ${params.maxIterations}. Select one tool call or return your final answer.`,
      },
      params.agent_role.model ?? provider.id,
      params.availableTools,
      true,
      outputTokens,
      params.traceId,
    );
    return {
      ...options,
      ...trace,
      max_tokens: outputTokens,
      tools: params.availableTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
      // A provider that cannot honor an explicit tool_choice receives the tool list only.
      ...(provider.callCapabilities?.supportsToolChoice === false
        ? {}
        : { toolChoice: { type: "auto", disable_parallel_tool_use: true } }),
      nativeConversation,
    };
  }

  private parseNativeResult(
    result: IGenerateResult,
    availableTools: IReasonParams["availableTools"],
  ): IReasonResult {
    if (!result.toolCalls?.length) {
      if (!result.content.trim()) throw new Error("Native dynamic decision returned no tool call or final content");
      return {
        done: true,
        output: result.content,
        provider: result.provider,
        model: result.model,
        ...this.modelMetadata(result),
      };
    }
    if (result.toolCalls.length !== 1) throw new Error("Native dynamic decision returned multiple tool calls");
    const call = result.toolCalls[0];
    const canonicalName = canonicalizeToolName(call.name);
    const matchingTool = availableTools.find((tool) => tool.name === canonicalName);
    if (
      !matchingTool || !call.id?.trim() || !call.input || typeof call.input !== "object" || Array.isArray(call.input)
    ) {
      throw new Error("Native dynamic decision returned an unknown or malformed tool call");
    }
    return {
      done: false,
      tool: matchingTool.name as McpToolName,
      args: call.input as ToolArgs,
      provider: result.provider,
      model: result.model,
      nativeToolCall: { ...call, name: matchingTool.name },
      ...this.modelMetadata(result),
    };
  }

  private parseJsonResult(result: IGenerateResult): IReasonResult {
    let rawJson = result.content.match(/```json\n([\s\S]*?)\n```/)?.[1] ??
      result.content.match(/```\n([\s\S]*?)\n```/)?.[1] ?? result.content;
    rawJson = rawJson.trim();
    if (rawJson.indexOf("{") !== 0) {
      const startIndex = rawJson.indexOf("{");
      const endIndex = rawJson.lastIndexOf("}");
      if (startIndex !== -1 && endIndex > startIndex) rawJson = rawJson.substring(startIndex, endIndex + 1);
    }
    try {
      const decision = ReActResponseSchema.parse(JSON.parse(rawJson));
      if (decision.action.type === "complete") {
        return {
          done: true,
          output: decision.action.output,
          provider: result.provider,
          model: result.model,
          ...this.modelMetadata(result),
        };
      }
      if (decision.action.type === "tool_call" && decision.action.tool) {
        return {
          done: false,
          tool: decision.action.tool,
          args: (decision.action.args ?? {}) as ToolArgs,
          provider: result.provider,
          model: result.model,
          ...this.modelMetadata(result),
        };
      }
      throw new Error("Invalid reasoning response format: missing tool name for tool_call");
    } catch (error) {
      throw new Error(`Failed to parse LLM response: ${getErrorMessage(error as LlmErrorPayload)}`);
    }
  }

  private modelMetadata(result: IGenerateResult): {
    usage: IGenerateResult["usage"];
    cost_usd?: number;
    costStatus?: ProviderCostStatus;
  } {
    return {
      usage: result.usage,
      ...(result.costStatus !== undefined ? { costStatus: result.costStatus } : {}),
      ...(result.costStatus !== "unknown" && result.cost_usd !== undefined ? { cost_usd: result.cost_usd } : {}),
    };
  }

  private projectCallOptions(
    provider: IModelProvider,
    providerMetadata: Opt<IProviderMetadata, Reason.OptionalContext>,
    role: IBlueprintFrontmatter,
    flowStepEffort: Opt<EffortDeclaration, Reason.OptionalContext>,
    flowStepThinking: Opt<ThinkingDeclaration, Reason.OptionalContext>,
    requestOptions: Opt<IModelCallOptions, Reason.OptionalInput>,
  ): IModelOptions | undefined {
    if (
      !requestOptions && role.effort === undefined && role.thinking === undefined &&
      flowStepEffort === undefined && flowStepThinking === undefined
    ) return undefined;
    const declarations: IEffortDeclarations = {
      ...(requestOptions ? { request: { effort: requestOptions.effort, thinking: requestOptions.thinking } } : {}),
      role: { effort: role.effort, thinking: role.thinking },
      flowStep: { effort: flowStepEffort, thinking: flowStepThinking },
    };
    const resolver = new EffortResolver();
    const resolution = resolver.resolve(declarations, {
      taskComplexity: TaskComplexity.MEDIUM,
      complexitySource: "default",
      modelSize: role.model_size,
      providerType: providerMetadata?.name as ProviderType | undefined,
      model: provider.id,
      providerSupportsThinking: provider.callCapabilities?.supportsThinking ??
        providerMetadata?.supportsThinking === true,
      anthropicThinkingDefault: this.config?.ai_anthropic?.thinking_default,
      skillFloors: [],
      agentRole: role.agent_role,
    });
    const projected = projectResolvedCallOptions(resolution, declarations, provider.callCapabilities);
    return {
      ...requestOptions,
      ...(projected.effort !== undefined ? { effort: projected.effort } : {}),
      ...(projected.thinking !== undefined ? { thinking: projected.thinking } : {}),
    };
  }
}
