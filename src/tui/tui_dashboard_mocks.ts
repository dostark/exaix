/**
 * @module TuiDashboardMocks
 * @path src/tui/tui_dashboard_mocks.ts
 * @description Mock implementations of core services (Portal, Plan, Log, Daemon, Request, Agent, Memory, Skills) for TUI dashboard testing and TDD.
 * @architectural-layer TUI
 * * @related-files [src/tui/dashboard_view.ts]
 */
import {
  ActivityType,
  AgentHealth,
  ConfidenceLevel,
  DaemonStatus,
  ExecutionStatus,
  LearningCategory,
  LogLevel,
  MemoryBankSource,
  MemoryOperation,
  MemoryRecordStatus,
  MemoryScope,
  MemoryType,
  PortalAnalysisMode,
  PortalExecutionStrategy,
  PortalStatus,
  RequestPriority,
  RequestSource,
  SkillStatus,
  TuiIcon,
} from "../shared/enums.ts";
import { JSONValue as _JSONValue } from "../shared/types/json.ts";
import { type IPortalDetails, type IPortalInfo, type IVerificationResult } from "../shared/types/portal.ts";
import { type IPlanDetails, type IPlanMetadata } from "../shared/types/plan.ts";
import {
  type AnalysisMode,
  type IRequestAnalysis,
  type IRequestEntry,
  type IRequestMetadata,
  type IRequestOptions,
  type IRequestShowResult,
} from "../shared/types/request.ts";
import { type AgentHealthData, type AgentLogEntry, type IAgentStatusItem } from "../shared/types/agent.ts";
import { type IStructuredLogEntry, type LogQueryOptions } from "../shared/types/logging.ts";
import {
  type IActivitySummary,
  type IDecision,
  type IExecutionMemory,
  type IGlobalMemory,
  type ILearning,
  type IMemorySearchResult,
  type IMemoryUpdateProposal,
  type IPattern,
  type IProjectMemory,
  type ISkill,
  type ISkillMatch,
  type SkillImmutableFields as _SkillImmutableFields,
  type SkillManagedFields,
} from "../shared/schemas/memory_bank.ts";
import { IPortalService } from "../shared/interfaces/i_portal_service.ts";
import { IPlanService } from "../shared/interfaces/i_plan_service.ts";
import { IRequestService } from "../shared/interfaces/i_request_service.ts";
import { IDaemonService } from "../shared/interfaces/i_daemon_service.ts";
import { IAgentService } from "../shared/interfaces/i_agent_service.ts";
import { IMemoryBankService } from "../shared/interfaces/i_memory_bank_service.ts";
import { ISkillsService } from "../shared/interfaces/i_skills_service.ts";
import { INotificationService } from "../shared/interfaces/i_notification_service.ts";
import { ILogService, IStructuredLogger } from "../shared/interfaces/i_log_service.ts";
import { IJournalService } from "../shared/interfaces/i_journal_service.ts";
import { IMemoryService } from "../shared/interfaces/i_memory_service.ts";
import type { IPortalKnowledge } from "../shared/schemas/portal_knowledge.ts";
import { PlanStatus, type PlanStatusType } from "../shared/status/plan_status.ts";
import { RequestStatus, type RequestStatusType } from "../shared/status/request_status.ts";
import { AgentStatus, type AgentStatusType as _AgentStatusType } from "../shared/status/agent_status.ts";
import { MemoryStatus as _MemoryStatus, type MemoryStatusType } from "../shared/status/memory_status.ts";
import { type IMemoryNotification } from "../shared/types/notification.ts";
import { type ISkillMatchRequest } from "../shared/types/skill.ts";
import { type IMemoryEmbeddingService } from "../shared/interfaces/i_memory_embedding_service.ts";
import { IDatabaseService } from "../shared/interfaces/i_database_service.ts";
import { type IActivityRecord, type IJournalFilterOptions, type SqliteParam } from "../shared/types/database.ts";

/**
 * MockPortalService
 */
export class MockPortalService implements IPortalService {
  add(
    _targetPath: string,
    _alias: string,
    _options?: { defaultBranch?: string; executionStrategy?: PortalExecutionStrategy },
  ): Promise<void> {
    return Promise.resolve();
  }

  listPortals(): Promise<IPortalInfo[]> {
    return Promise.resolve([]);
  }

  list(): Promise<IPortalInfo[]> {
    return this.listPortals();
  }

  getPortalDetails(alias: string): Promise<IPortalDetails> {
    return Promise.resolve({
      alias,
      targetPath: `/path/to/${alias}`,
      symlinkPath: `/symlink/to/${alias}`,
      contextCardPath: `/cards/${alias}.md`,
      status: PortalStatus.ACTIVE,
    });
  }

  show(alias: string): Promise<IPortalDetails> {
    return this.getPortalDetails(alias);
  }

  openPortal(_alias: string): Promise<boolean> {
    return Promise.resolve(true);
  }

  closePortal(_alias: string): Promise<boolean> {
    return Promise.resolve(true);
  }

  refreshPortal(_alias: string): Promise<boolean> {
    return Promise.resolve(true);
  }

  refresh(_alias: string): Promise<void> {
    return Promise.resolve();
  }

  removePortal(_alias: string, _options?: { keepCard?: boolean }): Promise<boolean> {
    return Promise.resolve(true);
  }

  remove(_alias: string, _options?: { keepCard?: boolean }): Promise<void> {
    return Promise.resolve();
  }

  verify(_alias?: string): Promise<IVerificationResult[]> {
    return Promise.resolve([]);
  }

  getPortalFilesystemPath(alias: string): Promise<string> {
    return Promise.resolve(`/mock/path/${alias}`);
  }

  quickJumpToPortalDir(alias: string): Promise<string> {
    return Promise.resolve(`/mock/jump/${alias}`);
  }

  getPortalActivityLog(_alias: string): string[] {
    return [];
  }

  getKnowledge(_alias: string): Promise<IPortalKnowledge | null> {
    return Promise.resolve(null);
  }

  analyze(
    _alias: string,
    _options?: { mode?: PortalAnalysisMode; force?: boolean },
  ): Promise<string> {
    return Promise.resolve("Mock analysis result");
  }
}

/**
 * MockPlanService
 */
export class MockPlanService implements IPlanService {
  listPending(): Promise<IPlanMetadata[]> {
    return Promise.resolve([]);
  }

  list(_statusFilter?: PlanStatusType): Promise<IPlanMetadata[]> {
    return this.listPending();
  }

  getDiff(_planId: string): Promise<string> {
    return Promise.resolve("");
  }

  show(planId: string): Promise<IPlanDetails> {
    return Promise.resolve({
      metadata: {
        id: planId,
        subject: "Mock Plan",
        status: PlanStatus.REVIEW,
        created_at: new Date().toISOString(),
      },
      content: "# Mock Plan\n\nThis is a mock plan content.",
    });
  }

  approve(_planId: string, _reviewer?: string, _skills?: string[]): Promise<boolean> {
    return Promise.resolve(true);
  }

  reject(_planId: string, _reviewer?: string, _reason?: string): Promise<boolean> {
    return Promise.resolve(true);
  }

  revise(_planId: string, _comments: string[]): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * MockLogService
 * Implements IDatabaseService and IJournalService for MonitorView and other components.
 */
export class MockLogService implements IDatabaseService, IJournalService {
  logActivity(
    _actor: string,
    _actionType: string,
    _target: string | null,
    _payload: Record<string, _JSONValue>,
    _traceId?: string,
    _identityId?: string | null,
  ): void {}

  waitForFlush(): Promise<void> {
    return Promise.resolve();
  }

  queryActivity(_filter: IJournalFilterOptions): Promise<IActivityRecord[]> {
    return Promise.resolve([]);
  }

  query(_filters: IJournalFilterOptions): Promise<IActivityRecord[]> {
    return Promise.resolve([]);
  }

  getDistinctValues(_field: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  preparedGet<T>(_query: string, _params?: SqliteParam[]): Promise<T | null> {
    return Promise.resolve(null);
  }

  preparedAll<T>(_query: string, _params?: SqliteParam[]): Promise<T[]> {
    return Promise.resolve([]);
  }

  preparedRun(_query: string, _params?: SqliteParam[]): Promise<unknown> {
    return Promise.resolve({});
  }

  getActivitiesByTrace(_traceId: string): IActivityRecord[] {
    return [];
  }

  getActivitiesByTraceSafe(_traceId: string): Promise<IActivityRecord[]> {
    return Promise.resolve([]);
  }

  getActivitiesByActionType(_actionType: string): IActivityRecord[] {
    return [];
  }

  getActivitiesByActionTypeSafe(_actionType: string): Promise<IActivityRecord[]> {
    return Promise.resolve([]);
  }

  getRecentActivity(_limit?: number): Promise<IActivityRecord[]> {
    return Promise.resolve([]);
  }
}

/**
 * MockDaemonService
 */
export class MockDaemonService implements IDaemonService {
  start(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  restart(): Promise<void> {
    return Promise.resolve();
  }
  getStatus(): Promise<DaemonStatus> {
    return Promise.resolve(DaemonStatus.RUNNING);
  }
  getLogs(): Promise<string[]> {
    return Promise.resolve([]);
  }
  getErrors(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

/**
 * MockRequestService
 */
export class MockRequestService implements IRequestService {
  create(
    description: string,
    options?: IRequestOptions,
    source: RequestSource = RequestSource.TUI,
  ): Promise<IRequestMetadata> {
    return Promise.resolve({
      trace_id: "new-trace-id",
      filename: "request.md",
      path: "/mock/request.md",
      status: RequestStatus.PENDING,
      priority: options?.priority ?? RequestPriority.NORMAL,
      identity: options?.identity ?? "test-agent",
      source: source,
      created: new Date().toISOString(),
      created_by: "test-user",
      subject: description,
    });
  }

  createRequest(description: string, options?: IRequestOptions): Promise<IRequestMetadata> {
    return this.create(description, options);
  }

  list(_status?: RequestStatusType, _includeArchived?: boolean): Promise<IRequestEntry[]> {
    return Promise.resolve([]);
  }

  listRequests(status?: RequestStatusType, includeArchived?: boolean): Promise<IRequestEntry[]> {
    return this.list(status, includeArchived);
  }

  show(idOrFilename: string): Promise<IRequestShowResult> {
    return Promise.resolve({
      metadata: {
        trace_id: idOrFilename,
        filename: "request.md",
        path: "/mock/request.md",
        status: RequestStatus.PENDING,
        priority: RequestPriority.NORMAL,
        identity: "test-agent",
        source: "tui" as RequestSource,
        created: new Date().toISOString(),
        created_by: "test-user",
      },
      content: "Mock content",
    });
  }

  getRequestContent(requestId: string): Promise<string> {
    return Promise.resolve(`Mock content for ${requestId}`);
  }

  updateRequestStatus(_requestId: string, _status: RequestStatusType): Promise<boolean> {
    return Promise.resolve(true);
  }
  getAnalysis(_requestId: string): Promise<IRequestAnalysis | null> {
    return Promise.resolve(null);
  }

  analyze(_requestId: string, _options?: { mode?: AnalysisMode; force?: boolean }): Promise<IRequestAnalysis> {
    return Promise.reject(new Error("Not implemented in mock"));
  }
}

/**
 * MockAgentService
 */
export class MockAgentService implements IAgentService {
  listAgents(): Promise<IAgentStatusItem[]> {
    return Promise.resolve([
      {
        id: "agent-1",
        name: "CodeReviewer",
        model: "gpt-4o-mini",
        status: AgentStatus.ACTIVE,
        lastActivity: new Date().toISOString(),
        capabilities: ["code-review", "testing"],
        defaultSkills: ["tdd-methodology"],
      },
      {
        id: "agent-2",
        name: "Architect",
        model: "gpt-4o",
        status: AgentStatus.ACTIVE,
        lastActivity: new Date().toISOString(),
        capabilities: ["design", "documentation"],
        defaultSkills: ["architectural-patterns"],
      },
    ]);
  }

  getAgentHealth(identityId: string): Promise<AgentHealthData> {
    if (identityId === "agent-2") {
      return Promise.resolve({
        status: AgentHealth.WARNING,
        issues: ["Mock warning"],
        uptime: 1800,
      });
    }
    return Promise.resolve({
      status: AgentHealth.HEALTHY,
      issues: [],
      uptime: 3600,
    });
  }

  getAgentLogs(identityId: string, _limit = 50): Promise<AgentLogEntry[]> {
    return Promise.resolve([
      {
        timestamp: new Date().toISOString(),
        level: LogLevel.INFO,
        message: `Agent ${identityId} ready`,
      },
      {
        timestamp: new Date().toISOString(),
        level: LogLevel.DEBUG,
        message: `Agent ${identityId} heartbeating`,
      },
    ]);
  }
}

/**
 * MockMemoryService
 */
export class MockMemoryService implements IMemoryBankService, IMemoryService {
  getProjectMemory(portal: string): Promise<IProjectMemory | null> {
    return Promise.resolve({
      portal,
      overview: "Mock project memory overview",
      patterns: [],
      decisions: [],
      references: [],
      updated_at: new Date().toISOString(),
    });
  }

  createProjectMemory(_projectMem: IProjectMemory): Promise<void> {
    return Promise.resolve();
  }
  updateProjectMemory(_portal: string, _updates: any): Promise<void> {
    return Promise.resolve();
  }
  addPattern(_portal: string, _pattern: IPattern): Promise<void> {
    return Promise.resolve();
  }
  addDecision(_portal: string, _decision: IDecision): Promise<void> {
    return Promise.resolve();
  }
  createExecutionRecord(_execution: IExecutionMemory): Promise<void> {
    return Promise.resolve();
  }

  getExecutionByTraceId(traceId: string): Promise<IExecutionMemory | null> {
    return Promise.resolve({
      trace_id: traceId,
      request_id: "request-1",
      portal: "main",
      status: ExecutionStatus.COMPLETED,
      identity_id: "test-agent",
      started_at: new Date().toISOString(),
      summary: "Mock execution",
      steps: [],
      artifacts: [],
      context_files: [],
      context_portals: [],
      changes: { files_created: [], files_modified: [], files_deleted: [] },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as IExecutionMemory);
  }

  getExecutionHistory(
    _portalOrOptions?: string | { portal?: string; limit?: number },
    _limit?: number,
  ): Promise<IExecutionMemory[]> {
    return Promise.resolve([
      {
        trace_id: "trace-1",
        request_id: "request-1",
        portal: "main",
        status: ExecutionStatus.COMPLETED,
        identity_id: "test-agent",
        started_at: new Date().toISOString(),
        summary: "Mock history item",
        steps: [],
        artifacts: [],
        context_files: [],
        context_portals: [],
        changes: { files_created: [], files_modified: [], files_deleted: [] },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as IExecutionMemory,
    ]);
  }

  getGlobalMemory(): Promise<IGlobalMemory | null> {
    return Promise.resolve({
      version: "1.0",
      updated_at: new Date().toISOString(),
      learnings: [],
      patterns: [],
      anti_patterns: [],
      statistics: {
        total_learnings: 0,
        by_category: { pattern: 0, insight: 0, decision: 0, troubleshooting: 0 },
        by_project: {},
        last_activity: new Date().toISOString(),
      },
    });
  }

  initGlobalMemory(): Promise<void> {
    return Promise.resolve();
  }
  addGlobalLearning(_learning: ILearning): Promise<void> {
    return Promise.resolve();
  }

  promoteLearning(_portal: string, _promotion: any): Promise<string> {
    return Promise.resolve("new-learning-id");
  }

  demoteLearning(_learningId: string, _targetPortal: string): Promise<void> {
    return Promise.resolve();
  }

  searchMemory(_query: string, _options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]> {
    return Promise.resolve([
      {
        id: "mem-1",
        score: 0.9,
        type: MemoryType.LEARNING,
        title: "Mock Memory",
        summary: "Mock memory summary",
        content: "Mock memory content",
        metadata: {
          title: "Mock Memory",
          source: MemoryBankSource.LEARNED,
          scope: MemoryScope.PROJECT,
          created_at: new Date().toISOString(),
          tags: ["test"],
        },
      },
    ]);
  }

  searchByTags(_tags: string[], _options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  searchByKeyword(_keyword: string, _options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  searchMemoryAdvanced(_options: {
    tags?: string[];
    keyword?: string;
    portal?: string;
    limit?: number;
  }): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getRecentActivity(_limit?: number): Promise<IActivitySummary[]> {
    return Promise.resolve([]);
  }

  rebuildIndices(): Promise<void> {
    return Promise.resolve();
  }

  rebuildIndicesWithEmbeddings(_embeddingService: IMemoryEmbeddingService): Promise<void> {
    return Promise.resolve();
  }

  getMemoryById(_id: string): Promise<IMemorySearchResult | null> {
    return Promise.resolve(null);
  }

  getMemoryByReference(_reference: string): Promise<IMemorySearchResult | null> {
    return Promise.resolve(null);
  }

  getMemoryBySource(_source: MemoryBankSource): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByScope(_scope: MemoryScope): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByType(_type: MemoryType): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByTag(_tag: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByKeyword(_keyword: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByPattern(_patternId: string): Promise<IMemorySearchResult | null> {
    return Promise.resolve(null);
  }

  getMemoryByDecision(_decisionId: string): Promise<IMemorySearchResult | null> {
    return Promise.resolve(null);
  }

  getMemoryByLearning(_learningId: string): Promise<IMemorySearchResult | null> {
    return Promise.resolve(null);
  }

  getMemoryByExecution(_executionId: string): Promise<IMemorySearchResult | null> {
    return Promise.resolve(null);
  }

  getMemoryByProject(_portal: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByGlobal(): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByAgent(_identityId: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryBySkill(_skillId: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByRequest(_requestId: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByPortal(_portal: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByTraceId(_traceId: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByTimestamp(_timestamp: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByContentHash(_hash: string): Promise<IMemorySearchResult | null> {
    return Promise.resolve(null);
  }

  getMemoryByEmbedding(_embedding: number[]): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByVector(_vector: number[]): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryBySimilarity(_embedding: number[], _threshold: number): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByRelevance(_query: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByRecency(_limit: number): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByFrequency(_limit: number): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByImportance(_limit: number): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByConfidence(_threshold: number): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByStatus(_status: MemoryStatusType): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByVisibility(_visibility: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByOwner(_owner: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByCreator(_creator: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByUpdater(_updater: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByApprover(_approver: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByRejecter(_rejecter: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByReviewer(_reviewer: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByPromoter(_promoter: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByDemoter(_demoter: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByLearner(_learner: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByExecutor(_executor: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  getMemoryByPlanner(_planner: string): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  // TUI-specific methods
  getProjects(): Promise<string[]> {
    return Promise.resolve(["main", "test"]);
  }

  search(query: string, _options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]> {
    return this.searchMemory(query, _options);
  }

  listPending(): Promise<IMemoryUpdateProposal[]> {
    return Promise.resolve([
      {
        id: "prop-1",
        operation: MemoryOperation.ADD,
        target_scope: MemoryScope.PROJECT,
        target_project: "test-portal",
        learning: {
          id: "learn-1",
          created_at: new Date().toISOString(),
          source: MemoryBankSource.LEARNED,
          scope: MemoryScope.PROJECT,
          title: "Test Pattern",
          description: "A pattern for the mock",
          category: LearningCategory.PATTERN,
          confidence: ConfidenceLevel.HIGH,
          tags: [],
        },
        reason: "Testing",
        identity_id: "test-agent",
        status: MemoryRecordStatus.PENDING,
        created_at: new Date().toISOString(),
      },
    ]);
  }

  getPending(proposalId: string): Promise<IMemoryUpdateProposal | null> {
    if (proposalId === "proposal-unknown") return Promise.resolve(null);
    return Promise.resolve({
      id: proposalId,
      operation: MemoryOperation.ADD,
      target_scope: MemoryScope.PROJECT,
      target_project: "test-portal",
      learning: {
        id: "learn-1",
        created_at: new Date().toISOString(),
        source: MemoryBankSource.LEARNED,
        scope: MemoryScope.PROJECT,
        title: "Test Pattern",
        description: "A pattern for the mock",
        category: LearningCategory.PATTERN,
        confidence: ConfidenceLevel.HIGH,
        tags: [],
      },
      reason: "Testing",
      identity_id: "test-agent",
      status: MemoryRecordStatus.PENDING,
      created_at: new Date().toISOString(),
    });
  }

  approvePending(_proposalId: string): Promise<void> {
    return Promise.resolve();
  }

  rejectPending(_proposalId: string, _reason: string): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * MockSkillsService
 */
export class MockSkillsService implements ISkillsService {
  initialize(): Promise<void> {
    return Promise.resolve();
  }

  createSkill(skillDef: Omit<ISkill, SkillManagedFields>): Promise<ISkill> {
    return Promise.resolve({
      ...skillDef,
      id: "mock-id",
      created_at: new Date().toISOString(),
      usage_count: 0,
    } as ISkill);
  }

  matchSkills(_request: ISkillMatchRequest): Promise<ISkillMatch[]> {
    return Promise.resolve([]);
  }

  buildSkillContext(_skillIds: string[]): Promise<string> {
    return Promise.resolve("Mock skill context");
  }

  recordSkillUsage(_skillId: string): Promise<void> {
    return Promise.resolve();
  }

  deriveSkillFromLearnings(
    _learningIds: string[],
    _skillDef: Omit<ISkill, SkillManagedFields>,
  ): Promise<ISkill> {
    return Promise.resolve({
      id: "123e4567-e89b-12d3-a456-426614174000",
      skill_id: "new-skill-id",
      name: "Derived Skill",
      description: "Successfully derived skill",
      created_at: new Date().toISOString(),
      usage_count: 0,
      status: SkillStatus.ACTIVE,
      version: "1.0.0",
      source: MemoryBankSource.LEARNED,
      scope: MemoryScope.GLOBAL,
      triggers: { keywords: [] },
      instructions: "Do things.",
    } as ISkill);
  }

  rebuildIndex(): Promise<void> {
    return Promise.resolve();
  }

  listSkills(_filter?: { source?: string; status?: string }): Promise<ISkill[]> {
    return Promise.resolve([
      {
        id: "user-skill-id",
        skill_id: "user-skill",
        name: "User Skill",
        description: "A user skill",
        version: "1.0.0",
        created_at: new Date().toISOString(),
        usage_count: 0,
        status: SkillStatus.ACTIVE,
        source: MemoryBankSource.USER,
        scope: MemoryScope.GLOBAL,
        triggers: { keywords: [] },
        instructions: "Do it.",
      } as ISkill,
    ]);
  }

  getSkill(skillId: string): Promise<ISkill | null> {
    return Promise.resolve({
      id: skillId,
      skill_id: skillId,
      name: "Mock Skill",
      description: "A mock skill",
      version: "1.0.0",
      created_at: new Date().toISOString(),
      usage_count: 0,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.LEARNED,
      scope: MemoryScope.GLOBAL,
      triggers: { keywords: [] },
      instructions: "Do things.",
    } as ISkill);
  }

  deleteSkill(skillId: string): Promise<boolean> {
    // protect user skills from deletion in tests
    if (skillId === "tdd-methodology") return Promise.resolve(false);
    return Promise.resolve(true);
  }
}

/**
 * MockStructuredLogger
 */
export class MockStructuredLogger implements IStructuredLogger {
  setContext(_context: Partial<any>) {}
  child(_additionalContext: Partial<any>): IStructuredLogger {
    return this;
  }
  debug(_message: string, _metadata?: any) {}
  info(_message: string, _metadata?: any) {}
  warn(_message: string, _metadata?: any) {}
  error(_message: string, _error?: Error, _metadata?: any) {}
  fatal(_message: string, _error?: Error, _metadata?: any) {}
  time<T>(_operation: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

/**
 * MockStructuredLoggerService
 */
export class MockStructuredLoggerService implements ILogService {
  getStructuredLogs(_options?: LogQueryOptions): Promise<IStructuredLogEntry[]> {
    return Promise.resolve([]);
  }
  subscribeToLogs(_callback: (entry: IStructuredLogEntry) => void): () => void {
    return () => {};
  }

  getLogsByCorrelationId(_correlationId: string): Promise<IStructuredLogEntry[]> {
    return Promise.resolve([]);
  }

  getLogsByTraceId(_traceId: string): Promise<IStructuredLogEntry[]> {
    return Promise.resolve([]);
  }

  getLogsByAgentId(_identityId: string): Promise<IStructuredLogEntry[]> {
    return Promise.resolve([]);
  }
  exportLogs(_filename: string, _entries: IStructuredLogEntry[]): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * MockNotificationService
 */
export class MockNotificationService implements INotificationService {
  notifyMemoryUpdate(_proposal: IMemoryUpdateProposal): Promise<void> {
    return Promise.resolve();
  }

  notify(
    message: string,
    _type?: string,
    _proposalId?: string,
    _traceId?: string,
    _metadata?: string,
  ): Promise<void> {
    console.log(`[Notification] ${message}`);
    return Promise.resolve();
  }

  notifyApproval(_proposalId: string, _learningTitle: string): void {}
  notifyRejection(_proposalId: string, _reason: string): void {}

  getNotifications(): Promise<IMemoryNotification[]> {
    return Promise.resolve([]);
  }

  getPendingCount(): Promise<number> {
    return Promise.resolve(0);
  }

  clearNotification(_proposalId: string): Promise<void> {
    return Promise.resolve();
  }

  clearAllNotifications(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Placeholder for TuiIcon to avoid lint errors if unused elsewhere
 */
export const _USED_ICONS = {
  INFO: TuiIcon.INFO,
  FOLDER: TuiIcon.FOLDER,
};

/**
 * Placeholder for ActivityType to avoid lint errors
 */
export const _USED_ACTIVITY = {
  EXECUTION: ActivityType.EXECUTION,
};
