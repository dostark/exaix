/**
 * @module ExecutionContextService
 * @path packages/execution/src/execution_context_service.ts
 * @description Bundles budget allocation, context caching, token counting, context
 *   budget management, and snapshot store into a single injectable service. Extracted
 *   from AgentOrchestrator to reduce constructor parameter count and encapsulate the
 *   context/budget subsystem.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_orchestrator.ts]
 */

import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { Opt, Reason } from "@exaix/core/types";
import type { Config } from "@exaix/schemas/config.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { PromptBudgetAllocator } from "@exaix/core";
import type { ITokenizer } from "@exaix/core/func";
import type { ContextCache } from "@exaix/core/context";
import type { IContextBudgetManager } from "./context/context_budget_manager.ts";
import type { ISnapshotStore } from "./context/snapshot_store.ts";
import { TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";

/** Token counting strategy: BPE via ITokenizer, or character-heuristic fallback. */
export type TokenSource = "bpe" | "heuristic";

/** Allocates prompt budget for a given model and request context. */
export interface IPromptBudgetAllocator {
  allocate(modelId: string, hints?: object, analysis?: IRequestAnalysis): Promise<IPromptBudget>;
}

/**
 * Bundles budget allocation, context cache, token counting, context budget manager,
 * and snapshot store into a single injectable service. Reduces AgentOrchestrator's
 * constructor parameter count and encapsulates the context/budget subsystem.
 */
export class ExecutionContextService {
  private _currentPromptBudget?: IPromptBudget;
  private promptBudgetAllocator?: IPromptBudgetAllocator;
  private _contextCache?: ContextCache;
  private readonly _tokenizer?: ITokenizer;
  private _contextBudgetManager?: IContextBudgetManager;
  private _snapshotStore?: ISnapshotStore;
  private logger: IEventLogger;

  constructor(
    config: Config,
    logger: IEventLogger,
    opts: {
      promptBudgetAllocator?: IPromptBudgetAllocator;
      contextCache?: ContextCache;
      tokenizer?: ITokenizer;
      contextBudgetManager?: IContextBudgetManager;
      snapshotStore?: ISnapshotStore;
    },
  ) {
    this.logger = logger;
    this.promptBudgetAllocator = opts.promptBudgetAllocator ??
      new PromptBudgetAllocator(config.budget_enforcement, undefined, logger);
    this._contextCache = opts.contextCache;
    this._tokenizer = opts.tokenizer;
    this._contextBudgetManager = opts.contextBudgetManager;
    this._snapshotStore = opts.snapshotStore;
  }

  /** Current section-level prompt budget from PromptBudgetAllocator. */
  get currentPromptBudget(): IPromptBudget | undefined {
    return this._currentPromptBudget;
  }

  /** Optional segment-level budget manager for IReActLoopExecutor. */
  get contextBudgetManager(): IContextBudgetManager | undefined {
    return this._contextBudgetManager;
  }

  /** Snapshot store for async compaction tier. */
  get snapshotStore(): ISnapshotStore | undefined {
    return this._snapshotStore;
  }

  /** Tokenizer for BPE token counting. */
  get tokenizer(): ITokenizer | undefined {
    return this._tokenizer;
  }

  /** Clear the current prompt budget (e.g., at end of execution). */
  clearBudget(): void {
    this._currentPromptBudget = undefined;
  }

  /** Allocate prompt budget for the given model and request analysis. */
  async allocateBudget(
    modelId: string,
    requestAnalysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
  ): Promise<void> {
    this._currentPromptBudget = await this.promptBudgetAllocator!.allocate(
      modelId,
      undefined,
      requestAnalysis,
    );
  }

  /** Mark stable sections in context cache for potential cache_control. */
  markSectionsStable(
    sections: {
      system: string;
      plan: string;
      portalKnowledge: string;
      memory: string;
      skills: string;
    },
    budget: IPromptBudget["sections"],
  ): void {
    if (!this._contextCache || !this._currentPromptBudget) return;
    this._contextCache.markStable("system", sections.system, budget.system);
    this._contextCache.markStable("plan", sections.plan, budget.plan);
    this._contextCache.markStable("portalKnowledge", sections.portalKnowledge, budget.portalKnowledge);
    this._contextCache.markStable("memory", sections.memory, budget.memory);
    this._contextCache.markStable("skills", sections.skills, budget.skills);
  }

  /** Invalidate the context cache. */
  invalidateCache(): void {
    this._contextCache?.invalidateAll();
  }

  /**
   * Estimate tokens for the given input, using BPE tokenizer if available,
   * falling back to character-heuristic estimation.
   */
  async estimateTokens(input: string, modelId?: Opt<string, Reason.ExecutionConfig>): Promise<number> {
    if (this._tokenizer && modelId) {
      return await this._tokenizer.countTokens(input, modelId);
    }
    return Math.ceil(input.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
  }

  /** Returns "bpe" or "heuristic" depending on tokenizer availability. */
  tokenSource(modelId?: Opt<string, Reason.ExecutionConfig>): TokenSource {
    return this._tokenizer && modelId ? "bpe" : "heuristic";
  }

  /** Estimate character count from token budget. */
  estimateMaxChars(tokenBudget: number): number {
    return tokenBudget * TOKEN_ESTIMATION_CHARS_PER_TOKEN;
  }

  /**
   * Sync character-heuristic token estimation.
   * Injects `TOKEN_ESTIMATION_CHARS_PER_TOKEN` internally so callers
   * (e.g. AgentOrchestrator) don't import the constant directly.
   */
  estimateTokensSync(input: string): number {
    return Math.ceil(input.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
  }
}
