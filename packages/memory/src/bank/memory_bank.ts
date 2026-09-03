/**
 * @module MemoryBankService
 * @path packages/memory/src/bank/memory_bank.ts
 * @description Core service for managing Exaix's Memory Banks:
 * - Project memory (overview, patterns, decisions, references)
 * - Execution memory (trace records, lessons learned)
 * - Search and indexing operations
 * - IActivity Journal integration
 * @architectural-layer Services
 * @related-files ["packages/core/src/types/i_database_service.ts", "packages/schemas/src/memory_bank.ts"]
 * @architectural-link [ARCHITECTURE.md#memory-banks-architecture]
 */

import { join } from "@std/path";
import { ensureDir, ensureDirSync, exists } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType, type TDomainEventType } from "@exaix/core/events";
import {
  ActivityActor,
  ActivityType,
  type JSONValue,
  MemoryBankSource,
  MemoryLinkType,
  MemoryOperation,
  MemoryReferenceType,
  MemoryScope,
  MemoryType,
} from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { DEFAULT_AI_TIMEOUT_MS, MEMORY_DEDUP_SIMILARITY_THRESHOLD } from "@exaix/core";
import {
  DEFAULT_EXECUTION_MEMORY_PATH,
  DEFAULT_GLOBAL_MEMORY_PATH,
  DEFAULT_GLOBAL_MEMORY_VERSION,
  DEFAULT_INDEX_MEMORY_PATH,
  DEFAULT_PROJECTS_MEMORY_PATH,
  DEFAULT_TASKS_MEMORY_PATH,
  LOCK_ACQUIRE_TIMEOUT_MS,
} from "@exaix/core";
import {
  ExecutionMemorySchema,
  GlobalMemorySchema,
  LearningSchema,
  ProjectMemorySchema,
} from "@exaix/schemas/memory_bank.ts";
import {
  searchByKeyword as searchByKeywordHelper,
  searchByTags as searchByTagsHelper,
  searchMemory as searchMemoryHelper,
  searchMemoryAdvanced as searchMemoryAdvancedHelper,
} from "./memory_search.ts";
import type { ISearchDeps } from "./memory_search.ts";
import type {
  IActivitySummary,
  IDecision,
  IExecutionMemory,
  IGlobalMemory,
  ILearning,
  ILearningPatch,
  IMemorySearchResult,
  IPattern,
  IProjectMemory,
  IReference,
} from "@exaix/schemas/memory_bank.ts";

import { findDedupMatch, type IDedupCandidate, mergeLearnings } from "../dedup/semantic_dedup.ts";
import { ID_MARKER_PREFIX, parseDecisions, parsePatterns } from "./parsers.ts";
import { formatExecutionSummary } from "./formatters.ts";
import { buildFilesIndex, buildPatternsIndex, buildTagsIndex, writeIndices } from "./index_builder.ts";
import type {
  ILearningContradictionDecision,
  ILearningContradictionResolver,
  IMemoryBankService,
  IMemoryEmbeddingService,
} from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
/** @visible */
export class MemoryBankService implements IMemoryBankService {
  private memoryRoot!: string;
  private projectsDir!: string;
  private executionDir!: string;
  private tasksDir!: string;
  private indexDir!: string;
  private globalDir!: string;
  private embeddingService?: IMemoryEmbeddingService;

  private contradictionResolver?: ILearningContradictionResolver;

  private static readonly CONTRADICTION_CANDIDATE_LIMIT = 5;
  private static readonly CONTRADICTION_SIMILARITY_THRESHOLD = 0.75;
  private static readonly DEDUP_CANDIDATE_LIMIT = 5;
  private static readonly DEFAULT_DELETE_REASON = "soft_delete_requested";
  private static readonly DEFAULT_SUPERSEDE_REASON = "replacement_learning_provided";
  private static readonly DEDUP_MERGE_REASON = "semantic_duplicate_merged";

  /** Create a new Memory Bank Service instance @param config - Exaix configuration @param db - Database service for IActivity Journal integration */
  constructor(
    private config: Config,
    private logger?: Opt<IEventLogger, Reason.OptionalDependency>,
    options: { contradictionResolver?: Opt<ILearningContradictionResolver, Reason.OptionalDependency> } = {},
  ) {
    this.contradictionResolver = options.contradictionResolver;
    this.memoryRoot = join(config.system.root!, config.paths.memory!);
    // Use subdirectory names directly, not full paths (which already include Memory/)
    this.projectsDir = join(this.memoryRoot, DEFAULT_PROJECTS_MEMORY_PATH);
    this.executionDir = join(this.memoryRoot, DEFAULT_EXECUTION_MEMORY_PATH);
    this.tasksDir = join(this.memoryRoot, DEFAULT_TASKS_MEMORY_PATH);
    this.indexDir = join(this.memoryRoot, DEFAULT_INDEX_MEMORY_PATH);
    this.globalDir = join(this.memoryRoot, DEFAULT_GLOBAL_MEMORY_PATH);

    // Ensure directory structure exists
    this.initializeDirectories();
  }

  /** Set the embedding service for semantic search support. Called during application initialization after the embedding provider is constructed. */
  setEmbeddingService(service: IMemoryEmbeddingService): void {
    this.embeddingService = service;

    this.logActivity({
      event_type: DomainEventType.MemoryEmbeddingServiceSet,
      target: MemoryScope.GLOBAL,
      metadata: { service_name: service.constructor.name },
    });
  }

  /**
   * Initialize Memory Banks directory structure
   */
  private initializeDirectories(): void {
    ensureDirSync(this.projectsDir);
    ensureDirSync(this.executionDir);
    ensureDirSync(this.tasksDir);
    ensureDirSync(this.indexDir);
    ensureDirSync(this.globalDir);
  }

  /** Execute an operation with file-based locking to prevent concurrent access @param lockPath - Path to the lock file @param operation - Async operation to execute while holding the lock @param timeoutMs - Maximum time to wait for lock acquisition (default: 5000ms) @param maxRetries - Maximum number of retry attempts (default: 3) */
  private async withFileLock<T>(
    lockPath: string,
    operation: () => Promise<T>,
    timeoutMs: Opt<number, Reason.SensibleDefault> = LOCK_ACQUIRE_TIMEOUT_MS,
    maxRetries: Opt<number, Reason.SensibleDefault> = 3,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Try to acquire lock with exclusive access
        const lockFile = await Deno.open(lockPath, {
          createNew: true,
          write: true,
        });

        try {
          // Execute the operation while holding the lock
          const result = await operation();
          return result;
        } finally {
          // Always close and remove the lock file
          try {
            lockFile.close();
          } catch {
            // Ignore close errors
          }

          try {
            await Deno.remove(lockPath);
          } catch {
            // Ignore cleanup errors - lock file may already be removed
          }
        }
      } catch (error) {
        lastError = error as Error;

        // If it's not a "file exists" error, rethrow immediately
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          throw error;
        }

        // If this was the last attempt, throw the timeout error
        if (attempt === maxRetries) {
          throw new Error(
            `Failed to acquire file lock after ${maxRetries + 1} attempts: ${lastError.message}`,
          );
        }

        // Wait with exponential backoff before retrying
        const delay = Math.min(timeoutMs * Math.pow(2, attempt), DEFAULT_AI_TIMEOUT_MS); // Cap at 30 seconds
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError || new Error("Unexpected error in file locking");
  }

  // Project Memory Operations

  /** Get project memory for a specific portal @param portal - Portal name @returns Project memory or null if not found */
  async getProjectMemory(portal: string): Promise<IProjectMemory | null> {
    const projectDir = join(this.projectsDir, portal);

    if (!await exists(projectDir)) {
      return null;
    }

    try {
      const overview = await this.readMarkdownFile(join(projectDir, "overview.md"));
      const patternsContent = await this.readMarkdownFile(join(projectDir, "patterns.md"));
      const decisionsContent = await this.readMarkdownFile(join(projectDir, "decisions.md"));
      const referencesContent = await this.readMarkdownFile(join(projectDir, "references.md"));

      const patterns = parsePatterns(patternsContent);
      const decisions = parseDecisions(decisionsContent);
      const references = this.parseReferences(referencesContent);

      return {
        portal,
        overview,
        patterns,
        decisions,
        references,
      };
    } catch (error) {
      console.error(`Error reading project memory for ${portal}:`, error);
      return null;
    }
  }

  /** Get list of project names (aliases) from memory banks. @returns Array of project names */
  async getProjects(): Promise<string[]> {
    const projects: string[] = [];
    try {
      for await (const entry of Deno.readDir(this.projectsDir)) {
        if (entry.isDirectory) {
          projects.push(entry.name);
        }
      }
    } catch {
      // Directory may not exist
    }
    return projects;
  }

  /** Create new project memory @param projectMem - Project memory data */
  async createProjectMemory(projectMem: IProjectMemory): Promise<void> {
    // Validate schema
    ProjectMemorySchema.parse(projectMem);

    const projectDir = join(this.projectsDir, projectMem.portal);
    await ensureDir(projectDir);

    // Write overview
    await this.writeMarkdownFile(
      join(projectDir, "overview.md"),
      projectMem.overview,
    );

    // Write patterns
    await this.writeMarkdownFile(
      join(projectDir, "patterns.md"),
      this.formatPatterns(projectMem.patterns),
    );

    // Write decisions
    await this.writeMarkdownFile(
      join(projectDir, "decisions.md"),
      this.formatDecisions(projectMem.decisions),
    );

    // Write references
    await this.writeMarkdownFile(
      join(projectDir, "references.md"),
      this.formatReferences(projectMem.references),
    );

    // Embed the project overview under its synthetic `${portal}:overview` key (skipped when empty)
    await this.embeddingService?.embed({
      kind: MemoryType.PROJECT,
      portal: projectMem.portal,
      overview: projectMem.overview,
    });

    // Log to IActivity Journal
    this.logActivity({
      event_type: DomainEventType.MemoryProjectCreated,
      target: projectMem.portal,
      metadata: {
        patterns_count: projectMem.patterns.length,
        decisions_count: projectMem.decisions.length,
        references_count: projectMem.references.length,
      },
    });
  }

  /** Update project memory (merge update) @param portal - Portal name @param updates - Partial project memory updates */
  async updateProjectMemory(
    portal: string,
    updates: Partial<Omit<IProjectMemory, "portal">>,
  ): Promise<void> {
    const projectDir = join(this.projectsDir, portal);
    const lockPath = join(projectDir, "update.lock");

    await this.withFileLock(lockPath, async () => {
      const existing = await this.getProjectMemory(portal);
      if (!existing) {
        throw new Error(`Project memory not found for portal: ${portal}`);
      }

      const updated: IProjectMemory = {
        portal,
        overview: updates.overview ?? existing.overview,
        patterns: updates.patterns ?? existing.patterns,
        decisions: updates.decisions ?? existing.decisions,
        references: updates.references ?? existing.references,
      };

      // Rewrite all files
      await this.createProjectMemory(updated);
    });

    // Log update
    this.logActivity({
      event_type: DomainEventType.MemoryProjectUpdated,
      target: portal,
      metadata: { updated_fields: Object.keys(updates) },
    });
  }

  /** Add a pattern to project memory @param portal - Portal name @param pattern - Pattern to add */
  async addPattern(portal: string, pattern: IPattern): Promise<void> {
    const projectDir = join(this.projectsDir, portal);
    const lockPath = join(projectDir, "patterns.lock");
    let storedPattern: IPattern | undefined;

    await ensureDir(projectDir);

    await this.withFileLock(lockPath, async () => {
      let existing = await this.getProjectMemory(portal);
      if (!existing) {
        await this.createProjectMemory({
          portal,
          overview: "",
          patterns: [],
          decisions: [],
          references: [],
        });
        existing = await this.getProjectMemory(portal);
      }

      if (!existing) {
        throw new Error(`Could not create project memory for portal: ${portal}`);
      }

      // Backfill the pattern's embedding-index id before storing so the stored
      // marker and the embedded entry share one stable identity.
      const normalized: IPattern = { ...pattern, id: pattern.id ?? crypto.randomUUID() };
      existing.patterns.push(normalized);
      await this.updateProjectMemory(portal, { patterns: existing.patterns });
      storedPattern = normalized;
    });

    // Embed the stored pattern under its own UUID id (cost-gated inside the service)
    await this.embeddingService?.embed({ kind: MemoryType.PATTERN, portal, pattern: storedPattern! });

    // Log pattern addition
    this.logActivity({
      event_type: DomainEventType.MemoryPatternAdded,
      target: portal,
      metadata: {
        pattern_name: pattern.name,
        tags: pattern.tags || [],
      },
    });
  }

  /** Add a decision to project memory @param portal - Portal name @param decision - Decision to add */
  async addDecision(portal: string, decision: IDecision): Promise<void> {
    const projectDir = join(this.projectsDir, portal);
    const lockPath = join(projectDir, "decisions.lock");
    let storedDecision: IDecision | undefined;

    await this.withFileLock(lockPath, async () => {
      const existing = await this.getProjectMemory(portal);
      if (!existing) {
        throw new Error(`Project memory not found for portal: ${portal}`);
      }

      // Backfill the decision's embedding-index id before storing so the stored
      // marker and the embedded entry share one stable identity.
      const normalized: IDecision = { ...decision, id: decision.id ?? crypto.randomUUID() };
      existing.decisions.push(normalized);
      await this.updateProjectMemory(portal, { decisions: existing.decisions });
      storedDecision = normalized;
    });

    // Embed the stored decision under its own UUID id (cost-gated inside the service)
    await this.embeddingService?.embed({ kind: MemoryType.DECISION, portal, decision: storedDecision! });

    // Log decision addition
    this.logActivity({
      event_type: DomainEventType.MemoryDecisionAdded,
      target: portal,
      metadata: {
        decision_summary: decision.decision.substring(0, 100),
        date: decision.date,
        tags: decision.tags || [],
      },
    });
  }

  // Execution Memory Operations

  /** Create execution memory record @param execution - Execution memory data */
  async createExecutionRecord(execution: IExecutionMemory): Promise<void> {
    // Validate schema - fail fast on invalid data
    ExecutionMemorySchema.parse(execution);

    const execDir = join(this.executionDir, execution.trace_id);
    await ensureDir(execDir);

    // Write summary.md
    const summary = formatExecutionSummary(execution);
    await this.writeMarkdownFile(join(execDir, "summary.md"), summary);

    // Write context.json
    await Deno.writeTextFile(
      join(execDir, "context.json"),
      JSON.stringify(execution, null, 2),
    );

    // Embed the execution under its trace_id (cost-gated inside the service)
    await this.embeddingService?.embed({ kind: MemoryType.EXECUTION, execution });

    // Log to IActivity Journal
    this.logActivity({
      event_type: DomainEventType.MemoryExecutionRecorded,
      target: execution.portal,
      trace_id: execution.trace_id,
      metadata: {
        status: execution.status,
        agent_role: execution.identity_id,
        files_changed: (execution.changes?.files_created?.length || 0) +
          (execution.changes?.files_modified?.length || 0),
      },
    });
  }

  /** Get execution memory by trace ID @param traceId - Execution trace ID (UUID) @returns Execution memory or null if not found */
  async getExecutionByTraceId(traceId: string): Promise<IExecutionMemory | null> {
    const execDir = join(this.executionDir, traceId);
    const contextFile = join(execDir, "context.json");

    if (!await exists(contextFile)) {
      return null;
    }

    try {
      const content = await Deno.readTextFile(contextFile);
      const data = JSON.parse(content);
      return ExecutionMemorySchema.parse(data);
    } catch (error) {
      console.error(`Error reading execution memory for ${traceId}:`, error);
      return null;
    }
  }

  /** Get execution history with optional filtering @param portal - Optional portal filter @param limit - Maximum number of results (default: 100) @returns Array of execution memories, sorted by started_at descending */
  async getExecutionHistory(
    portal?: Opt<string, Reason.QueryFilter>,
    limit: number = 100,
  ): Promise<IExecutionMemory[]> {
    const executions: IExecutionMemory[] = [];

    try {
      // Read all execution directories
      for await (const entry of Deno.readDir(this.executionDir)) {
        if (entry.isDirectory) {
          const execution = await this.getExecutionByTraceId(entry.name);
          if (execution) {
            // Apply portal filter if specified
            if (!portal || execution.portal === portal) {
              executions.push(execution);
            }
          }
        }
      }

      // Sort by started_at descending (most recent first)
      executions.sort((a, b) => {
        return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
      });

      // Apply limit
      return executions.slice(0, limit);
    } catch (error) {
      console.error("Error reading execution history:", error);
      return [];
    }
  }

  // Global Memory Operations

  /** Get global memory @returns Global memory or null if not initialized */
  async getGlobalMemory(): Promise<IGlobalMemory | null> {
    const jsonPath = join(this.globalDir, "learnings.json");

    if (!await exists(jsonPath)) {
      return null;
    }

    try {
      const content = await Deno.readTextFile(jsonPath);
      const data = JSON.parse(content);
      return GlobalMemorySchema.parse(data);
    } catch (error) {
      console.error("Error reading global memory:", error);
      return null;
    }
  }

  /** Initialize global memory directory structure Creates Memory/Global/ with empty learnings, patterns, and anti-patterns files. */
  async initGlobalMemory(): Promise<void> {
    await ensureDir(this.globalDir);

    const now = new Date().toISOString();
    const emptyGlobal: IGlobalMemory = {
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      updated_at: now,
      learnings: [],
      patterns: [],
      anti_patterns: [],
      statistics: {
        total_learnings: 0,
        by_category: {},
        by_project: {},
        last_activity: now,
      },
    };

    // Write JSON index
    await Deno.writeTextFile(
      join(this.globalDir, "learnings.json"),
      JSON.stringify(emptyGlobal, null, 2),
    );

    // Write empty markdown files
    await this.writeMarkdownFile(
      join(this.globalDir, "learnings.md"),
      "# Global Learnings\n\nCross-project learnings and insights.\n",
    );

    await this.writeMarkdownFile(
      join(this.globalDir, "patterns.md"),
      "# Global Patterns\n\nCode patterns that apply across all projects.\n",
    );

    await this.writeMarkdownFile(
      join(this.globalDir, "anti-patterns.md"),
      "# Anti-Patterns\n\nThings to avoid across all projects.\n",
    );

    this.logActivity({
      event_type: DomainEventType.MemoryGlobalInitialized,
      target: MemoryScope.GLOBAL,
      metadata: { version: "1.0.0" },
    });
  }

  /** Add a learning to global memory @param learning - Learning to add */
  async addGlobalLearning(learning: ILearning): Promise<void> {
    // Validate learning schema
    LearningSchema.parse(learning);

    const decision = await this.resolveContradiction(learning);
    if (decision.operation === MemoryOperation.UPDATE && decision.candidateId) {
      await this.updateLearning(decision.candidateId, this.learningPatch(learning));
      return;
    }
    if (decision.operation === MemoryOperation.SUPERSEDE && decision.candidateId) {
      await this.supersedeLearning(decision.candidateId, learning, decision.reason);
      return;
    }

    // No LLM-informed UPDATE/SUPERSEDE — fall back to LLM-free cosine-similarity dedup.
    const dedupMatch = await this.resolveDedupMatch(learning);
    if (dedupMatch) {
      const merged = mergeLearnings(learning, dedupMatch.learning);
      await this.supersedeLearning(dedupMatch.learning.id, merged, MemoryBankService.DEDUP_MERGE_REASON);
      return;
    }

    // Ensure global directory exists before locking
    await ensureDir(this.globalDir);

    const lockPath = join(this.globalDir, "learnings.lock");

    await this.withFileLock(lockPath, async () => {
      let globalMem = await this.getGlobalMemory();
      if (!globalMem) {
        await this.initGlobalMemory();
        globalMem = await this.getGlobalMemory();
      }

      if (!globalMem) {
        throw new Error("Failed to initialize global memory");
      }

      // Check for duplicate ID
      if (globalMem.learnings.some((l: ILearning) => l.id === learning.id)) {
        throw new Error(`Learning with ID '${learning.id}' already exists`);
      }

      // Add learning
      globalMem.learnings.push(learning);

      // Update statistics
      globalMem.statistics.total_learnings = globalMem.learnings.length;
      if (learning.category) {
        globalMem.statistics.by_category[learning.category] =
          (globalMem.statistics.by_category[learning.category] as number || 0) +
          1;
      }

      if (learning.project) {
        globalMem.statistics.by_project[learning.project] =
          (globalMem.statistics.by_project[learning.project] as number || 0) +
          1;
      }

      globalMem.statistics.last_activity = new Date().toISOString();
      globalMem.updated_at = new Date().toISOString();

      // Write updated JSON
      await Deno.writeTextFile(
        join(this.globalDir, "learnings.json"),
        JSON.stringify(globalMem, null, 2),
      );

      // Append to markdown file
      const mdContent = this.formatLearningMarkdown(learning);
      const mdPath = join(this.globalDir, "learnings.md");
      const existingContent = await this.readMarkdownFile(mdPath);
      await this.writeMarkdownFile(mdPath, existingContent + "\n" + mdContent);
    });

    this.logActivity({
      event_type: DomainEventType.MemoryGlobalLearningAdded,
      target: MemoryScope.GLOBAL,
      metadata: {
        learning_id: learning.id,
        title: learning.title,
        category: learning.category,
        confidence: learning.confidence,
      },
    });
  }

  async updateLearning(
    id: string,
    patch: ILearningPatch,
  ): Promise<void> {
    const updatedFields = Object.keys(patch);
    await this.mutateGlobalLearnings((globalMem) => {
      const index = globalMem.learnings.findIndex((learning) => learning.id === id);
      if (index === -1) throw new Error(`Learning not found: ${id}`);
      const updated = {
        ...globalMem.learnings[index],
        ...patch,
        id,
        created_at: globalMem.learnings[index].created_at,
      };
      globalMem.learnings[index] = LearningSchema.parse(updated);
    });
    this.logActivity({
      event_type: DomainEventType.MemoryLearningUpdated,
      target: MemoryScope.GLOBAL,
      metadata: { learning_id: id, updated_fields: updatedFields },
    });
  }

  async deleteLearning(id: string, reason: string = MemoryBankService.DEFAULT_DELETE_REASON): Promise<void> {
    await this.mutateGlobalLearnings((globalMem) => {
      const learning = globalMem.learnings.find((item) => item.id === id);
      if (!learning) throw new Error(`Learning not found: ${id}`);
      learning.status = MemoryStatus.DELETED;
    });
    this.logActivity({
      event_type: DomainEventType.MemoryLearningDeleted,
      target: MemoryScope.GLOBAL,
      metadata: { learning_id: id, reason },
    });
  }

  async supersedeLearning(
    oldId: string,
    newLearning: ILearning,
    reason: string = MemoryBankService.DEFAULT_SUPERSEDE_REASON,
  ): Promise<void> {
    LearningSchema.parse(newLearning);
    await this.mutateGlobalLearnings((globalMem) => {
      const oldLearning = globalMem.learnings.find((learning) => learning.id === oldId);
      if (!oldLearning) throw new Error(`Learning not found: ${oldId}`);
      if (globalMem.learnings.some((learning) => learning.id === newLearning.id)) {
        throw new Error(`Learning with ID '${newLearning.id}' already exists`);
      }
      oldLearning.status = MemoryStatus.SUPERSEDED;
      oldLearning.superseded_by = newLearning.id;
      // Typed supersession-chain links on both sides, written regardless of caller.
      oldLearning.links = [
        ...(oldLearning.links ?? []).filter((link) =>
          !(link.target_id === newLearning.id && link.type === MemoryLinkType.SUPERSEDED_BY)
        ),
        { target_id: newLearning.id, type: MemoryLinkType.SUPERSEDED_BY },
      ];
      globalMem.learnings.push(
        LearningSchema.parse({
          ...newLearning,
          supersedes: oldId,
          links: [
            ...(newLearning.links ?? []).filter((link) =>
              !(link.target_id === oldId && link.type === MemoryLinkType.SUPERSEDES)
            ),
            { target_id: oldId, type: MemoryLinkType.SUPERSEDES },
          ],
        }),
      );
      globalMem.statistics.total_learnings = globalMem.learnings.length;
      globalMem.statistics.by_category[newLearning.category] =
        (globalMem.statistics.by_category[newLearning.category] as number || 0) + 1;
      if (newLearning.project) {
        globalMem.statistics.by_project[newLearning.project] =
          (globalMem.statistics.by_project[newLearning.project] as number || 0) + 1;
      }
    });
    this.logActivity({
      event_type: DomainEventType.MemoryLearningSuperseded,
      target: MemoryScope.GLOBAL,
      metadata: { learning_id: oldId, superseded_by: newLearning.id, reason },
    });
  }

  private async resolveContradiction(learning: ILearning): Promise<ILearningContradictionDecision> {
    if (
      learning.status !== MemoryStatus.APPROVED || !this.embeddingService || !this.contradictionResolver
    ) {
      return { operation: MemoryOperation.ADD, reason: "contradiction_resolution_unavailable" };
    }
    const matches = await this.embeddingService.searchByEmbedding(`${learning.title} ${learning.description}`, {
      limit: MemoryBankService.CONTRADICTION_CANDIDATE_LIMIT,
      threshold: MemoryBankService.CONTRADICTION_SIMILARITY_THRESHOLD,
    });
    const ids = new Set(matches.map((match) => match.id));
    const globalMem = await this.getGlobalMemory();
    const candidates =
      globalMem?.learnings.filter((candidate) => ids.has(candidate.id) && candidate.status === MemoryStatus.APPROVED) ??
        [];
    return await this.contradictionResolver.resolve(learning, candidates);
  }

  /** Strongest approved near-duplicate for `learning`, if any clears `MEMORY_DEDUP_SIMILARITY_THRESHOLD`; called only as an ADD-fallback so an LLM-informed contradiction decision always takes precedence. */
  private async resolveDedupMatch(learning: ILearning): Promise<IDedupCandidate | undefined> {
    if (learning.status !== MemoryStatus.APPROVED || !this.embeddingService) return undefined;
    const matches = await this.embeddingService.searchByEmbedding(`${learning.title} ${learning.description}`, {
      limit: MemoryBankService.DEDUP_CANDIDATE_LIMIT,
      threshold: MEMORY_DEDUP_SIMILARITY_THRESHOLD,
    });
    const similarityById = new Map(matches.map((match) => [match.id, match.similarity]));
    const globalMem = await this.getGlobalMemory();
    const candidates: IDedupCandidate[] = (globalMem?.learnings ?? [])
      .filter((candidate) => similarityById.has(candidate.id) && candidate.status === MemoryStatus.APPROVED)
      .map((candidate) => ({ learning: candidate, similarity: similarityById.get(candidate.id)! }));
    return findDedupMatch(candidates, MEMORY_DEDUP_SIMILARITY_THRESHOLD);
  }

  private learningPatch(learning: ILearning): ILearningPatch {
    const { id: _id, created_at: _createdAt, ...patch } = learning;
    return patch;
  }

  private async mutateGlobalLearnings(operation: (globalMem: IGlobalMemory) => void): Promise<void> {
    await ensureDir(this.globalDir);
    const lockPath = join(this.globalDir, "learnings.lock");
    await this.withFileLock(lockPath, async () => {
      const globalMem = await this.getGlobalMemory();
      if (!globalMem) throw new Error("Global memory not initialized");
      operation(globalMem);
      globalMem.statistics.last_activity = new Date().toISOString();
      globalMem.updated_at = new Date().toISOString();
      GlobalMemorySchema.parse(globalMem);
      await Deno.writeTextFile(join(this.globalDir, "learnings.json"), JSON.stringify(globalMem, null, 2));
      await this.rewriteLearningsMarkdown(globalMem);
    });
  }

  /** Promote a learning from project to global scope @param portal - Source portal name @param promotion - Promotion details @returns ID of the created global learning */
  async promoteLearning(
    portal: string,
    promotion: {
      type: MemoryType.PATTERN | MemoryType.DECISION;
      name: string;
      title: string;
      description: string;
      category: ILearning["category"];
      tags: string[];
      confidence: ILearning["confidence"];
    },
  ): Promise<string> {
    // Verify source project exists
    const projectMem = await this.getProjectMemory(portal);
    if (!projectMem) {
      throw new Error(`Project memory not found for portal: ${portal}`);
    }

    // Ensure global memory exists
    const globalMem = await this.getGlobalMemory();
    if (!globalMem) {
      await this.initGlobalMemory();
    }

    // Create learning from promotion
    const learningId = crypto.randomUUID();
    const now = new Date().toISOString();

    const learning: ILearning = {
      id: learningId,
      created_at: now,
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      project: portal,
      title: promotion.title,
      description: promotion.description,
      category: promotion.category,
      tags: promotion.tags,
      confidence: promotion.confidence,
      status: MemoryStatus.APPROVED,
      approved_at: now,
    };

    await this.addGlobalLearning(learning);

    this.logActivity({
      event_type: DomainEventType.MemoryLearningPromoted,
      target: portal,
      metadata: {
        learning_id: learningId,
        from_type: promotion.type,
        from_name: promotion.name,
        to_scope: MemoryScope.GLOBAL,
      },
    });

    return learningId;
  }

  /** Demote a learning from global to project scope @param learningId - ID of the learning to demote @param targetPortal - Target portal name */
  async demoteLearning(learningId: string, targetPortal: string): Promise<void> {
    // Get global memory
    const globalMem = await this.getGlobalMemory();
    if (!globalMem) {
      throw new Error("Global memory not initialized");
    }

    // Find the learning
    const learningIndex = globalMem.learnings.findIndex((l: ILearning) => l.id === learningId);
    if (learningIndex === -1) {
      throw new Error(`Learning not found: ${learningId}`);
    }

    // Verify target project exists
    const projectMem = await this.getProjectMemory(targetPortal);
    if (!projectMem) {
      throw new Error(`Project memory not found for portal: ${targetPortal}`);
    }

    const learning = globalMem.learnings[learningIndex];

    // Add to project as a pattern (most common case)
    const pattern: IPattern = {
      name: learning.title!,
      description: learning.description!,
      examples: [],
      tags: learning.tags || [],
    };

    await this.addPattern(targetPortal, pattern);

    // Remove from global memory
    globalMem.learnings.splice(learningIndex, 1);

    // Update statistics
    globalMem.statistics.total_learnings = globalMem.learnings.length;
    if (learning.category) {
      globalMem.statistics.by_category[learning.category] = Math.max(
        0,
        (globalMem.statistics.by_category[learning.category] as number || 1) - 1,
      );
    }

    if (learning.project) {
      globalMem.statistics.by_project[learning.project] = Math.max(
        0,
        (globalMem.statistics.by_project[learning.project] as number || 1) - 1,
      );
    }

    globalMem.updated_at = new Date().toISOString();

    // Write updated global memory
    await Deno.writeTextFile(
      join(this.globalDir, "learnings.json"),
      JSON.stringify(globalMem, null, 2),
    );

    // Rewrite learnings.md without the demoted learning
    await this.rewriteLearningsMarkdown(globalMem);

    this.logActivity({
      event_type: DomainEventType.MemoryLearningDemoted,
      target: targetPortal,
      metadata: {
        learning_id: learningId,
        from_scope: MemoryScope.GLOBAL,
        to_project: targetPortal,
      },
    });
  }

  /**
   * Format a learning as markdown
   */
  private formatLearningMarkdown(learning: ILearning): string {
    let md = `## ${learning.title}\n\n`;
    md += `**ID:** ${learning.id}\n`;
    md += `**Created:** ${learning.created_at}\n`;
    md += `**Source:** ${learning.source}`;
    if (learning.project) {
      md += ` (from ${learning.project})`;
    }
    md += `\n`;
    md += `**Category:** ${learning.category}\n`;
    md += `**Confidence:** ${learning.confidence}\n`;

    if (learning.tags && learning.tags.length > 0) {
      md += `**Tags:** ${learning.tags.join(", ")}\n`;
    }

    md += `\n${learning.description}\n`;

    if (learning.references && learning.references.length > 0) {
      md += `\n**References:**\n`;
      for (const ref of learning.references) {
        md += `- [${ref.type}] ${ref.path}\n`;
      }
    }

    return md;
  }

  /**
   * Rewrite the learnings.md file from global memory state
   */
  private async rewriteLearningsMarkdown(globalMem: IGlobalMemory): Promise<void> {
    let md = "# Global Learnings\n\nCross-project learnings and insights.\n\n";

    for (const learning of globalMem.learnings) {
      md += this.formatLearningMarkdown(learning) + "\n";
    }

    await this.writeMarkdownFile(join(this.globalDir, "learnings.md"), md);
  }

  // Search Operations

  /** Search memory banks for matching content @param query - Search query string @param options - Search options (portal filter, limit) @returns Array of search results */
  async searchMemory(
    query: string,
    options?: Opt<{ portal?: string; limit?: number }, Reason.ExecutionConfig>,
  ): Promise<IMemorySearchResult[]> {
    return await searchMemoryHelper(query, options, this.buildSearchDeps());
  }

  /** Search memory by tags (AND logic for multiple tags) @param tags - Array of tags to search for @param options - Optional search options (portal filter, limit) @returns Array of search results with matching tags */
  async searchByTags(
    tags: string[],
    options?: Opt<{ portal?: string; limit?: number }, Reason.ExecutionConfig>,
  ): Promise<IMemorySearchResult[]> {
    return await searchByTagsHelper(tags, options, this.buildSearchDeps());
  }

  /** Search memory by keyword with frequency-based ranking @param keyword - Keyword to search for @param options - Optional search options (portal filter, limit) @returns Array of search results ranked by keyword frequency */
  async searchByKeyword(
    keyword: string,
    options?: Opt<{ portal?: string; limit?: number }, Reason.ExecutionConfig>,
  ): Promise<IMemorySearchResult[]> {
    return await searchByKeywordHelper(keyword, options, this.buildSearchDeps());
  }

  async searchMemoryAdvanced(
    options: {
      tags?: string[];
      keyword?: string;
      portal?: string;
      limit?: number;
    },
  ): Promise<IMemorySearchResult[]> {
    return await searchMemoryAdvancedHelper(options, this.buildSearchDeps());
  }

  private buildSearchDeps(): ISearchDeps {
    return {
      projectsDir: this.projectsDir,
      getProjectMemory: this.getProjectMemory.bind(this),
      getExecutionHistory: this.getExecutionHistory.bind(this),
      loadLearningsFromFile: this.loadLearningsFromFile.bind(this),
    };
  }

  /**
   * Load learnings from JSON file (helper for search operations)
   */
  private async loadLearningsFromFile(): Promise<ILearning[]> {
    const learningsPath = join(this.globalDir, "learnings.json");
    if (!await exists(learningsPath)) {
      return [];
    }
    try {
      const content = await Deno.readTextFile(learningsPath);
      const parsed = JSON.parse(content);
      // Handle both flat array and GlobalMemory structure
      if (Array.isArray(parsed)) {
        return parsed;
      }
      // GlobalMemory structure with learnings property
      if (parsed.learnings && Array.isArray(parsed.learnings)) {
        return parsed.learnings;
      }
      return [];
    } catch {
      return [];
    }
  }

  /** Get recent activity summary @param limit - Maximum number of activities to return @returns Array of activity summaries */
  async getRecentActivity(limit: number = 20): Promise<IActivitySummary[]> {
    const executions = await this.getExecutionHistory(undefined, limit);

    return executions.map((exec) => ({
      type: ActivityType.EXECUTION,
      timestamp: exec.started_at,
      portal: exec.portal,
      summary: exec.summary,
      trace_id: exec.trace_id,
      status: exec.status,
    }));
  }

  // Index Management

  /** Rebuild all indices for fast lookups Creates: - files.json: File path → executions mapping - patterns.json: Pattern → projects mapping - tags.json: Tag → projects/patterns mapping */
  async rebuildIndices(): Promise<void> {
    // Build indices using extracted functions
    const executions = await this.getExecutionHistory(undefined, 1000);
    const filesIndex = buildFilesIndex(executions);
    const patternsIndex = await buildPatternsIndex(this.projectsDir, (p) => this.getProjectMemory(p));
    const learnings = await this.loadLearningsFromFile();
    const tagsIndex = await buildTagsIndex(this.projectsDir, (p) => this.getProjectMemory(p), learnings);

    // Write indices
    await writeIndices(this.indexDir, filesIndex, patternsIndex, tagsIndex);

    // Log index rebuild
    this.logActivity({
      event_type: DomainEventType.MemoryIndicesRebuilt,
      target: ActivityActor.SYSTEM,
      metadata: {
        files_indexed: Object.keys(filesIndex).length,
        patterns_indexed: Object.keys(patternsIndex).length,
        tags_indexed: Object.keys(tagsIndex).length,
      },
    });
  }

  /** Rebuild all indices including embeddings This method rebuilds standard indices and also regenerates embedding vectors for all learnings using the provided embedding service. @param embeddingService - The embedding service to use for generating vectors */
  async rebuildIndicesWithEmbeddings(
    embeddingService: IMemoryEmbeddingService,
  ): Promise<void> {
    // First, rebuild standard indices
    await this.rebuildIndices();

    // Initialize embedding manifest
    await embeddingService.initializeManifest();

    // Embed all approved learnings
    const learnings = await this.loadLearningsFromFile();
    let learningCount = 0;
    for (const learning of learnings) {
      if (learning.status === MemoryStatus.APPROVED) {
        await embeddingService.embedLearning(learning);
        learningCount++;
      }
    }

    // Embed project-level memories (overview, patterns, decisions) and execution history,
    // persisting lazily-backfilled pattern/decision ids first so embedded ids stay stable.
    let patternCount = 0;
    let decisionCount = 0;
    let overviewCount = 0;
    for (const portal of await this.getProjects()) {
      await this.persistBackfilledIds(portal);
      const projectMem = await this.getProjectMemory(portal);
      if (!projectMem) continue;
      if (projectMem.overview) {
        await embeddingService.embed({ kind: MemoryType.PROJECT, portal, overview: projectMem.overview });
        overviewCount++;
      }
      for (const pattern of projectMem.patterns) {
        await embeddingService.embed({ kind: MemoryType.PATTERN, portal, pattern });
        patternCount++;
      }
      for (const decision of projectMem.decisions) {
        await embeddingService.embed({ kind: MemoryType.DECISION, portal, decision });
        decisionCount++;
      }
    }

    // Embed all execution history (limit above the default 100 so nothing is missed)
    const executions = await this.getExecutionHistory(undefined, Number.MAX_SAFE_INTEGER);
    for (const execution of executions) {
      await embeddingService.embed({ kind: MemoryType.EXECUTION, execution });
    }

    // Flush debounced cache writes after the batch
    await embeddingService.flush?.();

    // Log embedding rebuild
    this.logActivity({
      event_type: DomainEventType.MemoryEmbeddingsRebuilt,
      target: ActivityActor.SYSTEM,
      metadata: {
        learnings_embedded: learningCount,
        patterns_embedded: patternCount,
        decisions_embedded: decisionCount,
        overviews_embedded: overviewCount,
        executions_embedded: executions.length,
      },
    });
  }

  /** Rewrites a project's patterns/decisions markdown when entries lack persisted id markers, so lazy-backfilled ids become stable across runs. */
  private async persistBackfilledIds(portal: string): Promise<void> {
    const projectDir = join(this.projectsDir, portal);

    const patternsPath = join(projectDir, "patterns.md");
    const patternsContent = await this.readMarkdownFile(patternsPath);
    const patterns = parsePatterns(patternsContent);
    if (patterns.length > this.countIdMarkers(patternsContent)) {
      await this.writeMarkdownFile(patternsPath, this.formatPatterns(patterns));
    }

    const decisionsPath = join(projectDir, "decisions.md");
    const decisionsContent = await this.readMarkdownFile(decisionsPath);
    const decisions = parseDecisions(decisionsContent);
    if (decisions.length > this.countIdMarkers(decisionsContent)) {
      await this.writeMarkdownFile(decisionsPath, this.formatDecisions(decisions));
    }
  }

  /** Counts persisted id markers in raw markdown. */
  private countIdMarkers(content: string): number {
    return content.split(ID_MARKER_PREFIX).length - 1;
  }

  // Helper Methods

  /**
   * Read markdown file content
   */
  private async readMarkdownFile(path: string): Promise<string> {
    if (!await exists(path)) {
      return "";
    }
    return await Deno.readTextFile(path);
  }

  /**
   * Write markdown file content
   */
  private async writeMarkdownFile(path: string, content: string): Promise<void> {
    const dir = path.substring(0, path.lastIndexOf("/"));

    if (dir) {
      await ensureDir(dir);
    }
    await Deno.writeTextFile(path, content);
  }

  /**
   * Parse references from markdown content
   */
  private parseReferences(content: string): IReference[] {
    const references: IReference[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const match = line.match(/^\- \[(.+)\]\((.+)\)(?: - (.+))?$/);
      if (match) {
        references.push({
          path: match[2],
          type: MemoryReferenceType.URL,
          description: match[3] || match[1],
        });
      }
    }

    return references;
  }

  /**
   * Format patterns to markdown, persisting each entry's stable embedding-index id as a marker
   */
  private formatPatterns(patterns: IPattern[]): string {
    return patterns.map((p) => {
      let md = `## ${p.name}\n`;
      if (p.id) {
        md += `${ID_MARKER_PREFIX} ${p.id} -->\n`;
      }
      md += `\n${p.description}\n`;
      if (p.examples && p.examples.length > 0) {
        md += `\n**Examples:**\n${p.examples.map((e) => `- ${e}`).join("\n")}\n`;
      }
      if (p.tags && p.tags.length > 0) {
        md += `\n**Tags:** ${p.tags.join(", ")}\n`;
      }
      return md;
    }).join("\n\n");
  }

  /**
   * Format decisions to markdown, persisting each entry's stable embedding-index id as a marker
   */
  private formatDecisions(decisions: IDecision[]): string {
    return decisions.map((d) => {
      let md = `## ${d.date}: ${d.decision}\n`;
      if (d.id) {
        md += `${ID_MARKER_PREFIX} ${d.id} -->\n`;
      }
      md += `\n${d.rationale}\n`;
      if (d.alternatives && d.alternatives.length > 0) {
        md += `\n**Alternatives considered:** ${d.alternatives.join(", ")}\n`;
      }
      if (d.tags && d.tags.length > 0) {
        md += `\n**Tags:** ${d.tags.join(", ")}\n`;
      }
      return md;
    }).join("\n\n");
  }

  /**
   * Format references to markdown
   */
  private formatReferences(references: IReference[]): string {
    return references.map((r) => {
      const desc = r.description ? ` - ${r.description}` : "";
      const title = r.description || r.path;
      return `- [${title}](${r.path})${desc}`;
    }).join("\n");
  }

  /**
   * Log activity to IActivity Journal
   */
  private logActivity(event: {
    event_type: TDomainEventType;
    target: string;
    trace_id?: string;
    metadata?: Record<string, JSONValue>;
  }): void {
    if (!this.logger) return;
    void this.logger.info(event.event_type, event.target, event.metadata, event.trace_id);
  }
}
