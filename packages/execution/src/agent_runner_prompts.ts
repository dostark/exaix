/**
 * @module AgentRunnerPrompts
 * @path packages/execution/src/agent_runner_prompts.ts
 * @description The prompt steps of one agent run: segment assembly, the token budget, adaptive portal knowledge, the portal knowledge cap and the prompt preview.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_runner.ts, packages/execution/tests/agent_runner_preview_prompt_test.ts]
 */

import type { IBlueprint } from "@exaix/core/blueprint";
import { ProviderRegistry, readProviderModelInfo } from "@exaix/ai";
import { type JSONValue, TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";
import type { IPortalKnowledgeSelectionAppliedPayload } from "@exaix/core/events";
import { buildAdaptivePortalKnowledge } from "@exaix/core/func";
import type { IPortalKnowledgeRequestSignals } from "@exaix/core/func";
import type { IContextSegment } from "./context/context_segment.ts";
import { ContextSegmentKindSchema } from "@exaix/schemas/execution/context_budget.ts";
import type { IPromptBudget, IPromptPreview, IPromptPreviewSegment } from "@exaix/schemas/prompt_budget.ts";
import type { ITokenizer } from "@exaix/core/func";
import type { IPlanAdapter } from "@exaix/core/planning";
import {
  DEFAULT_PORTAL_KNOWLEDGE_CORE_MAX_TOKENS,
  DEFAULT_PORTAL_KNOWLEDGE_MAX_TOKENS,
  DEFAULT_PORTAL_KNOWLEDGE_RELEVANT_MAX_ENTRIES,
  PortalKnowledgeInclusion,
} from "@exaix/core";
import { computeRegistryPredictedCost } from "./registry_computed_cost.ts";
import { renderCriticalSkillsSection, renderSkillsSection } from "@exaix/core/func";
import {
  MEMORY_CONTEXT_KEY,
  PLANNING_TOOL_CALL_OVERHEAD_TOKENS,
  PORTAL_CONTEXT_KEY,
  PORTAL_KNOWLEDGE_KEY,
  SkillRenderMode,
} from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { Opt, Reason } from "@exaix/core/types";
import { lineBoundedPrefix } from "./context/token_bounded_prefix.ts";
import { FLOW_BRANCH_JSON_OUTPUT_INSTRUCTION, OutputContract } from "@exaix/core";
import type { IParsedRequest } from "./agent_runner.ts";
import type { IContextBudgetManager } from "./context/context_budget_manager.ts";
import type { PromptBudgetAllocator } from "@exaix/core";
import type { IApplicationContext } from "@exaix/core/types";
import type { AgentRunnerSkills } from "./agent_runner_skills.ts";

type SegmentEntry = { content: string; kind: IContextSegment["kind"]; priority: number; nonCompactable: boolean };

/** What the adaptive knowledge entry is sized from. */
interface IAdaptiveKnowledgeArgs {
  request: IParsedRequest;
  entries: SegmentEntry[];
  directoryListingEntryIndex: number;
  portalKnowledgeConfig: { max_tokens?: number; core_max_tokens?: number; relevant_max_entries?: number } | undefined;
  tokenizer: ITokenizer;
  modelId: string;
  toSegments: (list: SegmentEntry[]) => Promise<IContextSegment[]>;
}

/** The token-usage hints that segment allocation reports to the budget allocator. */
type TAllocationHintKey =
  | "systemUsedTokens"
  | "planUsedTokens"
  | "portalKnowledgeUsedTokens"
  | "memoryUsedTokens"
  | "skillsUsedTokens"
  | "loopHistoryUsedTokens";

/** The slice of the runner configuration that prompt assembly reads. */
interface IPromptAssemblyConfig {
  readonly context?: IApplicationContext;
  readonly tokenizer?: ITokenizer;
  readonly promptBudgetAllocator?: PromptBudgetAllocator;
  readonly contextBudgetManager?: IContextBudgetManager;
}

/** What the prompt steps of one runner need from it. */
interface IAgentRunnerPromptsDependencies {
  readonly planAdapter: IPlanAdapter;
  readonly config: Opt<IPromptAssemblyConfig, Reason.OptionalDependency>;
  readonly skills: Pick<AgentRunnerSkills, "matchAndApplySkills">;
  /** The provider and model that the run is bound to, read on each call. */
  readonly selectedModel: () => { provider: string; model: string };
  /** True when the planning tools path engages for the request, so its history budget is reserved. */
  readonly planningEngaged: (request: IParsedRequest, agentRole: string) => boolean;
  readonly journal: (
    action: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId: Opt<string, Reason.TraceAbsent>,
  ) => void;
}

/** Prompt assembly for one agent runner: segments, the token budget, adaptive portal knowledge and the preview. */
export class AgentRunnerPrompts {
  private readonly planAdapter: IPlanAdapter;
  private readonly config: IAgentRunnerPromptsDependencies["config"];
  private readonly skills: IAgentRunnerPromptsDependencies["skills"];
  private readonly selectedModel: IAgentRunnerPromptsDependencies["selectedModel"];
  private readonly planningEngaged: IAgentRunnerPromptsDependencies["planningEngaged"];
  private readonly journal: IAgentRunnerPromptsDependencies["journal"];

  constructor(dependencies: IAgentRunnerPromptsDependencies) {
    this.planAdapter = dependencies.planAdapter;
    this.config = dependencies.config;
    this.skills = dependencies.skills;
    this.selectedModel = dependencies.selectedModel;
    this.planningEngaged = dependencies.planningEngaged;
    this.journal = dependencies.journal;
  }

  /** The provider and model of the run as one `provider:model` id. */
  modelId(): string {
    const selected = this.selectedModel();
    return `${selected.provider}:${selected.model}`;
  }

  /** The unbounded budget used when no allocator is configured. */
  private defaultPromptBudget(modelId: string): IPromptBudget {
    return {
      model: modelId,
      totalBudgetTokens: Number.MAX_SAFE_INTEGER,
      safetyBufferTokens: 0,
      sections: {
        system: Number.MAX_SAFE_INTEGER,
        plan: Number.MAX_SAFE_INTEGER,
        portalKnowledge: Number.MAX_SAFE_INTEGER,
        memory: Number.MAX_SAFE_INTEGER,
        skills: Number.MAX_SAFE_INTEGER,
        loopHistory: Number.MAX_SAFE_INTEGER,
      },
    };
  }

  /** The output-shape instruction of a run. A verdict run carries none, because its contract skill defines the shape. */
  private schemaInstructions(blueprint: IBlueprint, request: IParsedRequest): string | undefined {
    if ((request.outputContract ?? blueprint.outputContract) === OutputContract.VERDICT) return undefined;
    return request.flowOutputKind === "branch-json"
      ? FLOW_BRANCH_JSON_OUTPUT_INSTRUCTION
      : this.planAdapter.getSchemaInstructions();
  }

  /** Builds every segment except the adaptive knowledge entry. The caller sizes and appends that one. */
  private async buildBaseEntries(
    blueprint: IBlueprint,
    request: IParsedRequest,
    inclusionMode: string,
    skillContext?: Opt<string, Reason.OptionalContext>,
    criticalSkillContext?: Opt<string, Reason.OptionalContext>,
  ): Promise<{ entries: SegmentEntry[]; directoryListingEntryIndex: number }> {
    const k = ContextSegmentKindSchema.enum;
    const entries: SegmentEntry[] = [];

    if (blueprint.systemPrompt.trim()) {
      entries.push({ content: blueprint.systemPrompt, kind: k.system, priority: 100, nonCompactable: true });
    }
    // Critical skills are protected like the schema instructions, so they survive budget pressure.
    if (criticalSkillContext?.trim()) {
      entries.push({ content: criticalSkillContext, kind: k.acceptance_criteria, priority: 90, nonCompactable: true });
    }
    if (skillContext?.trim()) {
      entries.push({ content: skillContext, kind: k.skills, priority: 50, nonCompactable: false });
    }
    const schemaInstructions = this.schemaInstructions(blueprint, request);
    if (schemaInstructions !== undefined) {
      entries.push({ content: schemaInstructions, kind: k.acceptance_criteria, priority: 90, nonCompactable: true });
    }

    let directoryListingEntryIndex = -1;
    const portalContext = request.context?.[PORTAL_CONTEXT_KEY];
    if (typeof portalContext === "string" && portalContext.trim()) {
      directoryListingEntryIndex = entries.length;
      entries.push({ content: portalContext, kind: k.portal_knowledge, priority: 60, nonCompactable: false });
    }

    if (inclusionMode !== PortalKnowledgeInclusion.ADAPTIVE || !request.portalKnowledgeSnapshot) {
      const portalKnowledge = request.context?.[PORTAL_KNOWLEDGE_KEY];
      if (typeof portalKnowledge === "string" && portalKnowledge.trim()) {
        entries.push({
          content: await this.capPortalKnowledge(portalKnowledge),
          kind: k.portal_knowledge,
          priority: 60,
          nonCompactable: false,
        });
      }
    }
    const memoryContext = request.context?.[MEMORY_CONTEXT_KEY];
    if (typeof memoryContext === "string" && memoryContext.trim()) {
      entries.push({ content: memoryContext, kind: k.reflection, priority: 40, nonCompactable: false });
    }
    if (request.userPrompt.trim()) {
      // An hr-delimited block keeps the task boundary clear next to the request body's own headings.
      const labeledRequest = `---\nYOUR TASK — this is the actual task to complete now:\n---\n\n${request.userPrompt}`;
      entries.push({ content: labeledRequest, kind: k.request, priority: 75, nonCompactable: true });
    }

    return { entries, directoryListingEntryIndex };
  }

  /** Builds every prompt segment through the budget pipeline. Prompt and preview share it. */
  private async assemblePromptSegments(
    blueprint: IBlueprint,
    request: IParsedRequest,
    skillContext?: Opt<string, Reason.OptionalContext>,
    criticalSkillContext?: Opt<string, Reason.OptionalContext>,
    opts?: Opt<{ journal?: boolean }, Reason.OptionalContext>,
  ): Promise<{ allSegments: IContextSegment[]; includedSegments: IContextSegment[]; budget: IPromptBudget }> {
    const k = ContextSegmentKindSchema.enum;
    const portalKnowledgeConfig = this.config?.context?.config.get().portal_knowledge;
    const inclusionMode = portalKnowledgeConfig?.inclusion ?? "summary";
    const { entries, directoryListingEntryIndex } = await this.buildBaseEntries(
      blueprint,
      request,
      inclusionMode,
      skillContext,
      criticalSkillContext,
    );

    const tokenizer = this.config?.tokenizer;
    const modelId = this.modelId();
    const toSegments = async (list: SegmentEntry[]): Promise<IContextSegment[]> =>
      await Promise.all(
        list.map(async (e, i) => ({
          segmentId: `prompt-part-${i}`,
          content: e.content,
          kind: e.kind,
          priority: e.priority,
          tokenEstimate: await tokenizer?.countTokens(e.content, modelId) ??
            Math.ceil(e.content.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN),
          metadata: { nonCompactable: e.nonCompactable },
        })),
      );

    const adaptive = await this.maybeAddAdaptiveKnowledge(
      {
        request,
        entries,
        directoryListingEntryIndex,
        portalKnowledgeConfig,
        tokenizer,
        modelId,
        toSegments,
      },
      inclusionMode,
      k.portal_knowledge,
    );

    const allSegments = await toSegments(entries);
    const allocationHints = this.buildAllocationHints(allSegments);
    if (this.planningEngaged(request, blueprint.agentRole || "unknown")) {
      const planning = this.config!.context!.config.get().planning!;
      allocationHints.loopHistoryUsedTokens += (planning.max_tool_rounds - 1) * planning.max_tool_calls_per_round *
        (planning.max_tool_result_tokens + PLANNING_TOOL_CALL_OVERHEAD_TOKENS);
    }
    const budget: IPromptBudget = await this.config?.promptBudgetAllocator?.allocate(modelId, allocationHints) ??
      this.defaultPromptBudget(modelId);

    const manager = this.config?.contextBudgetManager;
    const includedSegments = manager
      ? (await manager.prepare({
        traceId: request.traceId ?? "unknown",
        stepId: "agent-runner",
        model: modelId,
        promptBudget: budget,
        segments: allSegments,
      })).segments
      : allSegments;

    this.journalSelection(adaptive.payload, includedSegments, adaptive.index, request, opts);

    return { allSegments, includedSegments, budget };
  }

  /** Adds adaptive mode's knowledge entry to the entries, returning its payload and index. */
  private async maybeAddAdaptiveKnowledge(
    args: Omit<IAdaptiveKnowledgeArgs, "tokenizer"> & {
      tokenizer: Opt<ITokenizer, Reason.OptionalContext>;
    },
    inclusionMode: string,
    kind: IContextSegment["kind"],
  ): Promise<{ payload: IPortalKnowledgeSelectionAppliedPayload | undefined; index: number }> {
    if (
      inclusionMode !== PortalKnowledgeInclusion.ADAPTIVE || !args.request.portalKnowledgeSnapshot || !args.tokenizer
    ) {
      return { payload: undefined, index: -1 };
    }
    const adaptive = await this.buildAdaptiveKnowledgeEntry({ ...args, tokenizer: args.tokenizer });
    if (!adaptive) return { payload: undefined, index: -1 };
    const index = args.entries.length;
    args.entries.push({ content: adaptive.content, kind, priority: 60, nonCompactable: false });
    return { payload: adaptive.payload, index };
  }

  /** Journals the applied adaptive selection, with its included token count. */
  private journalSelection(
    payload: Opt<IPortalKnowledgeSelectionAppliedPayload, Reason.OptionalContext>,
    includedSegments: readonly IContextSegment[],
    adaptiveEntryIndex: number,
    request: IParsedRequest,
    opts: Opt<{ journal?: boolean }, Reason.OptionalContext>,
  ): void {
    if (!payload) return;
    const includedById = new Map(includedSegments.map((segment) => [segment.segmentId, segment]));
    payload.includedTokens = includedById.get(`prompt-part-${adaptiveEntryIndex}`)?.tokenEstimate ?? 0;
    if (opts?.journal === false) return;
    this.journal(
      DomainEventType.PortalKnowledgeSelectionApplied,
      request.requestId ?? null,
      { ...payload },
      request.traceId,
    );
  }

  /** Sizes and renders the adaptive knowledge entry. A preliminary allocation without it gives the
   *  section budget, minus the directory listing tokens. */
  private async buildAdaptiveKnowledgeEntry(
    args: IAdaptiveKnowledgeArgs,
  ): Promise<{ content: string; payload: IPortalKnowledgeSelectionAppliedPayload } | undefined> {
    const { request, entries, directoryListingEntryIndex, portalKnowledgeConfig, tokenizer, modelId, toSegments } =
      args;
    const preliminarySegments = await toSegments(entries);
    const preliminaryHints = this.buildAllocationHints(preliminarySegments);
    const preliminaryBudget = await this.config?.promptBudgetAllocator?.allocate(modelId, preliminaryHints) ??
      this.defaultPromptBudget(modelId);
    const directoryListingTokens = directoryListingEntryIndex >= 0
      ? preliminarySegments[directoryListingEntryIndex].tokenEstimate
      : 0;
    const maxTokens = portalKnowledgeConfig?.max_tokens ?? DEFAULT_PORTAL_KNOWLEDGE_MAX_TOKENS;
    const coreMaxTokens = portalKnowledgeConfig?.core_max_tokens ?? DEFAULT_PORTAL_KNOWLEDGE_CORE_MAX_TOKENS;
    const relevantMaxEntries = portalKnowledgeConfig?.relevant_max_entries ??
      DEFAULT_PORTAL_KNOWLEDGE_RELEVANT_MAX_ENTRIES;
    const availableTokens = Math.max(
      0,
      Math.min(maxTokens, preliminaryBudget.sections.portalKnowledge - directoryListingTokens),
    );
    if (availableTokens === 0) return undefined;

    const signals: IPortalKnowledgeRequestSignals = {
      userPrompt: request.userPrompt,
      filePaths: request.filePaths,
      taskType: request.taskType,
      tags: request.tags,
    };
    // Non-null: caller only invokes this when request.portalKnowledgeSnapshot is set.
    const result = await buildAdaptivePortalKnowledge(request.portalKnowledgeSnapshot!, signals, {
      tokenizer,
      modelId,
      availableTokens,
      coreMaxTokens,
      relevantMaxEntries,
    });
    if (!result.content.trim()) return undefined;

    return {
      content: result.content,
      payload: {
        inclusion: PortalKnowledgeInclusion.ADAPTIVE,
        availableTokens,
        coreTokens: await tokenizer.countTokens(result.core, modelId),
        selectedEntryIds: result.relevant.map((entry) => entry.id),
        selectedTokens: result.budgetUsedTokens,
        includedTokens: result.budgetUsedTokens,
      },
    };
  }

  /** Constructs the combined prompt from blueprint, request, and optional skill context. */
  async constructPrompt(
    blueprint: IBlueprint,
    request: IParsedRequest,
    skillContext?: Opt<string, Reason.OptionalContext>,
    criticalSkillContext?: Opt<string, Reason.OptionalContext>,
  ): Promise<{ prompt: string; budget: IPromptBudget }> {
    const { includedSegments, budget } = await this.assemblePromptSegments(
      blueprint,
      request,
      skillContext,
      criticalSkillContext,
    );
    return { prompt: includedSegments.map((s) => s.content).join("\n\n"), budget };
  }

  /** Caps `portal_knowledge` at assembly, because an unset budget would skip `ContextBudgetManager`.
   *  Keeps whole lines and checks the kept prefix with the real tokenizer. */
  private async capPortalKnowledge(content: string): Promise<string> {
    const maxTokens = this.config?.context?.config.get().portal_knowledge?.max_tokens ??
      DEFAULT_PORTAL_KNOWLEDGE_MAX_TOKENS;
    const tokenizer = this.config?.tokenizer;
    const estimate = async (text: string): Promise<number> =>
      await tokenizer?.countTokens(text, this.modelId()) ??
        Math.ceil(text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);

    if (await estimate(content) <= maxTokens) return content;

    return await lineBoundedPrefix(content, maxTokens, estimate);
  }

  /** Non-mutating preview of `constructPrompt`'s assembly — a per-segment breakdown, not
   *  a joined string, and never a real LLM call. Runs its own skill matching (like `run()`). */
  async previewPrompt(blueprint: IBlueprint, request: IParsedRequest): Promise<IPromptPreview> {
    const agentRole = blueprint.agentRole || "unknown";
    const { skillIds, skillsContext } = await this.skills.matchAndApplySkills(blueprint, request, agentRole);
    const trimmedSkillRender = this.config?.context?.config.get().skills?.render_mode === SkillRenderMode.TRIMMED;
    const skillContextString = renderSkillsSection(skillsContext, trimmedSkillRender);
    const criticalSkillContext = renderCriticalSkillsSection(skillsContext);

    const { allSegments, includedSegments, budget } = await this.assemblePromptSegments(
      blueprint,
      request,
      skillContextString,
      criticalSkillContext,
      { journal: false },
    );

    const includedById = new Map(includedSegments.map((segment) => [segment.segmentId, segment]));
    const encoder = new TextEncoder();
    const segments: IPromptPreviewSegment[] = allSegments.map((segment) => {
      const resulting = includedById.get(segment.segmentId);
      const resultingTokens = resulting?.tokenEstimate ?? 0;
      const resultingBytes = resulting ? encoder.encode(resulting.content).length : 0;
      return {
        segmentId: segment.segmentId,
        kind: segment.kind,
        priority: segment.priority,
        originalTokenEstimate: segment.tokenEstimate,
        resultingTokenEstimate: resultingTokens,
        tokenEstimate: resultingTokens,
        originalByteLength: encoder.encode(segment.content).length,
        resultingByteLength: resultingBytes,
        byteLength: resultingBytes,
        nonCompactable: segment.metadata.nonCompactable ?? false,
        included: resulting !== undefined,
      };
    });

    // A dropped or shortened segment both count as compaction.
    const compactionTriggered = allSegments.some((segment) =>
      includedById.get(segment.segmentId)?.content !== segment.content
    );

    const selectedModel = this.selectedModel();
    const totalTokenEstimate = segments.reduce((sum, segment) => sum + segment.resultingTokenEstimate, 0);
    const modelInfo = await readProviderModelInfo(
      ProviderRegistry.getMetadataForInstance(selectedModel.provider),
      selectedModel.model,
    );
    const estimatedCostUsd = computeRegistryPredictedCost(selectedModel.provider, selectedModel.model, {
      promptTokens: totalTokenEstimate,
      completionTokens: 0,
    }, modelInfo);

    return {
      segments,
      totalTokenEstimate,
      budgetTotalTokens: budget.totalBudgetTokens,
      compactionTriggered,
      matchedSkillIds: skillIds,
      ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
    };
  }

  private buildAllocationHints(segments: IContextSegment[]): Record<TAllocationHintKey, number> {
    const hints = {
      systemUsedTokens: 0,
      planUsedTokens: 0,
      portalKnowledgeUsedTokens: 0,
      memoryUsedTokens: 0,
      skillsUsedTokens: 0,
      loopHistoryUsedTokens: 0,
    };
    for (const segment of segments) {
      switch (segment.kind) {
        case ContextSegmentKindSchema.enum.system:
          hints.systemUsedTokens += segment.tokenEstimate;
          break;
        case ContextSegmentKindSchema.enum.portal_knowledge:
          hints.portalKnowledgeUsedTokens += segment.tokenEstimate;
          break;
        case ContextSegmentKindSchema.enum.reflection:
          hints.memoryUsedTokens += segment.tokenEstimate;
          break;
        case ContextSegmentKindSchema.enum.skills:
          hints.skillsUsedTokens += segment.tokenEstimate;
          break;
        case ContextSegmentKindSchema.enum.tool_result:
        case ContextSegmentKindSchema.enum.summary:
          hints.loopHistoryUsedTokens += segment.tokenEstimate;
          break;
        default:
          hints.planUsedTokens += segment.tokenEstimate;
      }
    }
    return hints;
  }
}
