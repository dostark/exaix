/**
 * @module DomainEventTypes
 * @path packages/core/src/events/domain_event_types.ts
 * @architectural-layer Core
 * @dependencies []
 * @related-files ["packages/core/src/events/event_registry.ts", "packages/core/src/types/constants.ts"]
 * @description Canonical event type definitions for all Exaix domains. Every event
 * type in the system is defined here as a const object to prevent silent event-type
 * typos and establish a single source of truth for the event taxonomy.
 */

import type { EffortTier, IRouteReason, ModelResolutionReason, TaskTypeSource } from "@exaix/schemas";
import type { HitlRuleSource, HitlSurface, TaskType, VotingStrategy } from "../types/enums.ts";

/** Guardrail verdict type. */
export type GuardrailVerdict = "pass" | "violation";
/** Guardrail severity type. */
export type GuardrailSeverity = "warn" | "block";

/** Typed payload for voting.* events (Phase 113). */
export interface IVotingEventPayload {
  step_id: string;
  strategy: VotingStrategy;
  candidate_count: number;
  consensus_reached: boolean;
  winner_runner_id?: string;
  dissent_summary?: string;
  /** Present on `voting.runner_failed` — the error message from the failed runner. */
  error?: string;
}

/** Typed payload for hitl.policy.matched events (Phase 118). */
export interface IHitlPolicyMatchedPayload {
  traceId: string;
  stepId?: string;
  tool: string;
  ruleSource: HitlRuleSource;
  reason?: string;
  surface: HitlSurface;
}

/** Typed payload for model.resolved events (Phase 132). */
export interface IModelResolutionTraceEventPayload {
  intent: {
    model_size?: string;
    thinking?: boolean;
    effort?: EffortTier;
    characteristics?: string[];
    required_capabilities?: string[];
    preferred_provider?: string;
    model?: string;
  };
  candidate_providers: string[];
  scores: Record<string, number>;
  selected: { provider: string; model: string; attempt: number };
  reason: ModelResolutionReason;
  duration_ms: number;
  /** Phase 135 Step 6 (GAP-9): the route policy that chose the provider (>1 route). */
  route_reason?: IRouteReason;
  /** Phase 135 Step 6 (GAP-9): the routes weighed, with price + health, for the journal. */
  considered_routes?: IConsideredRoute[];
  /**
   * Phase 135 Step 8 (GAP-9): how the intent's task_type was derived — one of
   * frontmatter|identity|skill|static_map|analyzer|unknown. Lives on the trace payload
   * (not just IResolvedModel) so it reaches `exactl logs`. Additive/optional.
   */
  task_type_source?: TaskTypeSource;
}

/** One weighed route in a multi-route decision (Phase 135 Step 6, §5.7.4). */
export interface IConsideredRoute {
  provider: string;
  price?: number;
  health_score: number;
}

/** Typed payload for model.route.selected events (Phase 135 Step 6, §5.7.4). */
export interface IModelRouteSelectedPayload {
  model: string;
  chosen_provider: string;
  policy: IRouteReason;
  considered: IConsideredRoute[];
}

/** Typed payload for model.pricing.stale events (Phase 135). */
export interface IModelPricingStalePayload {
  provider: string;
  model: string;
  provenance: string;
  verified_at: number;
  age_days: number;
  staleness_max_days: number;
}

/** Typed payload for model.cost.divergence events (Phase 135, §5.5.2). */
export interface IModelCostDivergencePayload {
  provider: string;
  model: string;
  reported: number;
  computed: number;
  delta_pct: number;
}

/** Reason a model cleared the §5.9 admission bar (Phase 135 Step 3). */
export type ModelAdmittedReason = "curated" | "native" | "explicit_use" | "benchmark_topn";

/** Typed payload for model.admitted events (Phase 135 Step 3, F12). */
export interface IModelAdmittedPayload {
  provider: string;
  model: string;
  reason: ModelAdmittedReason;
}

/** Typed payload for model.retired events (Phase 135 Step 3 — removed at refresh). */
export interface IModelRetiredPayload {
  provider: string;
  model: string;
  last_seen_at: number;
}

/** Typed payload for model.catalog.refreshed events (Phase 135 Step 5, §7). */
export interface IModelCatalogRefreshedPayload {
  provider: string;
  models_added: number;
  models_removed: number;
  duration_ms: number;
}

/** Typed payload for model.pricing.refreshed events (Phase 135 Step 5, §7). */
export interface IModelPricingRefreshedPayload {
  provider: string;
  prices_updated: number;
  duration_ms: number;
}

/** Outcome of one refresh attempt — mirrors the registry_refresh_audit.outcome column. */
export type RegistryRefreshOutcome =
  | "success"
  | "skipped_offline"
  | "auth_error"
  | "http_error"
  | "parse_error";

/** Which refresh pass an audit row / failure describes — mirrors registry_refresh_audit.kind. */
export type RegistryRefreshKind = "catalog" | "pricing";

/** Typed payload for model.registry.refresh.failed events (Phase 135 Step 5, §7.2). */
export interface IModelRegistryRefreshFailedPayload {
  provider: string;
  kind: RegistryRefreshKind;
  outcome: RegistryRefreshOutcome;
  detail: string;
}

/**
 * Typed payload for model.benchmark.refreshed events (Phase 135 Step 7, §5.8).
 * `outcome` reuses the refresh-outcome union: success for a completed ingest pass,
 * parse_error / http_error for a source that failed (previous scores stay intact).
 */
export interface IModelBenchmarkRefreshedPayload {
  benchmark: string;
  scores_written: number;
  outcome: RegistryRefreshOutcome;
}

/**
 * Typed payload for model.benchmark.missing events (Phase 135 Step 8, §5.8.3 honest
 * degradation — GAP-D). Emitted per candidate the `best` scorer could not rank because
 * it has no score on the task-relevant benchmark; the candidate is ranked last, never
 * dropped or errored.
 */
export interface IModelBenchmarkMissingPayload {
  provider: string;
  model: string;
  benchmark: string;
  task_type: TaskType;
}

/** Typed payload for guardrail.* events. */
export interface IGuardrailEventPayload {
  policy_id: string;
  iteration: number;
  verdict: GuardrailVerdict;
  severity: GuardrailSeverity;
  flagged_excerpt?: string;
  explanation?: string;
  /** Present only on guardrail.screen.error. */
  error_message?: string;
}

export const DomainEventType = {
  // Flow step events
  FlowStepExecuted: "flow.step.executed",
  FlowStepReplayed: "flow.step.replayed",
  FlowStepInvalidated: "flow.step.invalidated",

  // Execution context events
  ExecutionContextCompacted: "execution.context.compacted",
  ExecutionContextBudgetCleared: "execution.context.budget_cleared",
  ExecutionContextCacheInvalidated: "execution.context.cache_invalidated",
  ExecutionContextSectionsStabilized: "execution.context.sections_stabilized",
  ExecutionContextBudgetAllocated: "execution.context.budget_allocated",

  // Loop history events
  LoopHistoryEntryAdded: "loop_history.entry_added",

  // Wait state events
  WaitStateCreated: "wait_state.created",
  WaitStateResolved: "wait_state.resolved",

  // Session delegation events (Phase 106).
  // Emitted today by SessionReturnWatcher: returned, reconciled, scope_violation,
  // token_rejected, budget_exceeded. The remaining four (briefed, launched,
  // path_rejected, expired, cancelled) are emitted by the Phase 111 gate hooks /
  // brief path-validation / wait-state deadline sweep / CLI cancel respectively —
  // declared here so the taxonomy states intent rather than dead constants.
  SessionDelegateBriefed: "session.delegate.briefed", // Phase 111: gate hook on prepareBrief
  SessionDelegateLaunched: "session.delegate.launched", // Phase 111: gate hook on launch
  SessionDelegateReturned: "session.delegate.returned",
  SessionDelegateReconciled: "session.delegate.reconciled",
  SessionDelegateScopeViolation: "session.delegate.scope_violation",
  SessionDelegateBudgetExceeded: "session.delegate.budget_exceeded",
  SessionDelegateTokenRejected: "session.delegate.token_rejected",
  SessionDelegatePathRejected: "session.delegate.path_rejected", // Phase 111: brief path validation
  SessionDelegateExpired: "session.delegate.expired", // Phase 111: wait-state deadline sweep
  SessionDelegateCancelled: "session.delegate.cancelled", // Phase 111: exactl session cancel
  SessionDelegateContentlessBrief: "session.delegate.contentless_brief", // Phase 150: placeholder/empty brief rejection
  SessionDelegateBriefFailed: "session.delegate.brief_failed", // Phase 150 Step 13: prepareBrief throw (distinct from reconciled)

  // Phase 128: delegate permission-hardening events
  SessionDelegateAgentMismatch: "session.delegate.agent_mismatch", // R3: generated agent.<name> key diverges from delegate identity
  SessionDelegateVersionWarning: "session.delegate.version_warning", // R3 post-gap: version probe below minimum

  // Phase 121: net allowlist instrumentation
  NetAllowlist: "net.allowlist",
  // Phase 121: crash recovery for orphaned delegations
  SessionDelegateCrashRecovered: "session.delegate.crash_recovered",

  // Cost tracking events
  LlmUsageRecorded: "llm.usage",
  CostPricingLookupSet: "cost.pricing_lookup.set",
  CostQueriedByCriteria: "cost.query.by_criteria",
  CostDailyCostQueried: "cost.query.daily",
  CostSummaryQueried: "cost.query.summary",
  CostBatchFlushed: "cost.batch.flushed",

  // Agent orchestrator events (agent_orchestrator.ts, react_loop_adapter.ts)
  AgentOutput: "agent.output",
  // Same value as the legacy ACTIVITY_EVENT_DYNAMIC_TOOL_CALL constant (packages/core/src/
  // types/constants.ts) — trajectory_evaluator.ts still queries by that constant's string
  // value, so this registers the identical value under DomainEventType rather than changing it.
  AgentDynamicToolCall: "dynamic_tool_call",

  // Execution lifecycle events (execution_loop.ts)
  ExecutionSkipped: "execution.skipped",
  ExecutionStarted: "execution.started",
  ExecutionReadonlyPlanSkipped: "execution.readonly_structured_plan_skipped",
  ExecutionReadonlyPlanExecuted: "execution.readonly_structured_plan_executed",
  ExecutionActionStarted: "execution.action_started",
  ExecutionActionCompleted: "execution.action_completed",
  ExecutionActionFailed: "execution.action_failed",
  ExecutionLeaseAcquired: "execution.lease_acquired",
  ExecutionLeaseReleased: "execution.lease_released",
  ExecutionCompleted: "execution.completed",
  ExecutionFailed: "execution.failed",
  ExecutionAmendmentPending: "execution.amendment_pending",
  ExecutionNoChanges: "execution.no_changes",

  // Report events (execution_loop.ts, mission_reporter.ts)
  ReportGenerated: "report.generated",
  ReportError: "report.error",
  ReportExecutionRecorded: "report.execution_recorded",

  // Flow lifecycle events (flow_runner.ts)
  FlowValidating: "flow.validating",
  FlowValidated: "flow.validated",
  FlowStarted: "flow.started",
  FlowDependenciesResolving: "flow.dependencies.resolving",
  FlowDependenciesResolved: "flow.dependencies.resolved",
  FlowWaveStarted: "flow.wave.started",
  FlowWaveResumeSkipped: "flow.wave.resume.skipped",
  FlowWaveCompleted: "flow.wave.completed",
  FlowWaveErrors: "flow.wave.errors",
  FlowStepProcessingError: "flow.step.processing_error",
  FlowOutputAggregating: "flow.output.aggregating",
  FlowOutputAggregated: "flow.output.aggregated",
  FlowStepQueued: "flow.step.queued",
  FlowStepStarted: "flow.step.started",
  FlowStepConditionEvaluated: "flow.step.condition.evaluated",
  FlowStepCompleted: "flow.step.completed",
  FlowStepFailed: "flow.step.failed",
  FlowStepInputPrepared: "flow.step.input.prepared",
  FlowStepTransformApplied: "flow.step.transform.applied",
  FlowStepUnexpectedError: "flow.step.unexpected_error",
  FlowTokenSummary: "flow.token_summary",
  FlowTokenSummaryError: "flow.token_summary.error",
  FlowGateCriteriaNoAnalysis: "flow.gate.criteria.no_analysis",

  // Request lifecycle events (request/processor.ts)
  RequestProcessStarted: "request.process.started",
  RequestProcessing: "request.processing",
  RequestSkipped: "request.skipped",
  RequestValidationRetry: "plan.validation.retry",
  RequestValidationErrorDetected: "plan.validation.error.detected",
  RequestSavedRejected: "plan.saved_rejected",
  RequestFailed: "request.failed",
  RequestPlanned: "request.planned",
  RequestInvalid: "request.invalid",
  RequestProcessingError: "request.processing.error",
  RequestProcessingDuration: "request.processing.duration",
  RequestQualityGateFailed: "request.quality_gate.failed",
  RequestMemoryEnhanceFailed: "memory.enhance_failed",

  // Frontmatter parse events (request/processing/parser.ts)
  FrontmatterNotFound: "file.not_found",
  FrontmatterInvalid: "frontmatter.invalid",
  FrontmatterMissingTraceId: "frontmatter.missing_trace_id",
  FrontmatterParseFailed: "file.parse_failed",
  FrontmatterAcceptanceCriteriaMalformed: "frontmatter.acceptance_criteria.malformed",
  FrontmatterExpectedOutcomesMalformed: "frontmatter.expected_outcomes.malformed",
  FrontmatterScopeMalformed: "frontmatter.scope.malformed",

  // Plan execution events (plan_executor.ts)
  PlanExecutionStarted: "plan.execution_started",
  PlanExecutionCompleted: "plan.execution_completed",
  PlanExecutionFailed: "plan.execution_failed",
  PlanAmendmentTriggered: "plan.amendment_triggered",
  // Plan amendment lifecycle events (plan_amendment_gate.ts, execution_loop.ts,
  // plan_executor.ts). Same values as the legacy PLAN_AMENDMENT_EVENT_* constants
  // (packages/core/src/types/constants.ts) — apps/exactl/src/commands/plan_commands.ts
  // and existing tests still reference those constants directly by name, so this registers
  // the identical values under DomainEventType rather than renaming them.
  PlanAmendmentProposed: "plan.amendment.proposed",
  PlanAmendmentAwaitingApproval: "plan.amendment.awaiting_approval",
  PlanAmendmentApproved: "plan.amendment.approved",
  PlanAmendmentRejected: "plan.amendment.rejected",
  PlanAmendmentExpired: "plan.amendment.expired",
  PlanAmendmentApplied: "plan.amendment.applied",

  // Plan writer events (plan_writer.ts)
  PlanValidationSuccess: "plan.validation.success",
  PlanValidationFailed: "plan.validation.failed",
  PlanValidationEnriched: "plan.validation.enriched",
  PlanParsed: "plan.parsed",
  PlanCreated: "plan.created",

  // Memory lifecycle events (memory_bank.ts)
  MemoryProjectCreated: "memory.project.created",
  MemoryProjectUpdated: "memory.project.updated",
  MemoryPatternAdded: "memory.pattern.added",
  MemoryDecisionAdded: "memory.decision.added",
  MemoryExecutionRecorded: "memory.execution.recorded",
  MemoryGlobalInitialized: "memory.global.initialized",
  MemoryGlobalLearningAdded: "memory.global.learning.added",
  MemoryLearningPromoted: "memory.learning.promoted",
  MemoryLearningDemoted: "memory.learning.demoted",
  MemoryIndicesRebuilt: "memory.indices.rebuilt",
  MemoryEmbeddingsRebuilt: "memory.embeddings.rebuilt",
  MemoryEmbeddingServiceSet: "memory.embedding_service.set",
  MemoryPendingDigest: "memory.pending_digest",
  MemoryInitFailed: "memory.init_failed",
  MemoryAutoApprovalCycle: "memory.auto_approval_cycle",
  MemoryMaintenanceCycleFailed: "memory.maintenance_cycle_failed",
  MemoryTierPromotion: "memory.tier_promotion",
  MemoryTierPromotionFailed: "memory.tier_promotion_failed",
  MemoryIndexRebuildFailed: "memory.index_rebuild_failed",

  // Memory notification / proposal events (notification.ts, memory_extractor.ts)
  MemoryUpdatePending: "memory.update.pending",
  MemoryUpdateApproved: "memory.update.approved",
  MemoryUpdateRejected: "memory.update.rejected",
  MemoryUpdatePendingDigest: "memory.update.pending.digest",
  MemoryProposalCreated: "memory.proposal.created",
  MemoryProposalApproved: "memory.proposal.approved",
  MemoryProposalRejected: "memory.proposal.rejected",
  MemoryAutoApproved: "memory.auto_approved",

  // Review events (review_registry.ts)
  ReviewCreated: "review.created",
  ReviewApproved: "review.approved",
  ReviewRejected: "review.rejected",
  ReviewDiffRead: "review.diff.read",
  ReviewRead: "review.read",
  ReviewListRead: "review.list.read",
  ReviewCountRead: "review.count.read",
  ReviewDeleted: "review.deleted",

  // Git events (git_service.ts)
  GitCheck: "git.check",
  GitInit: "git.init",
  GitIdentityCheck: "git.identity_check",
  GitIdentityConfigured: "git.identity_configured",
  GitBranchCreated: "git.branch_created",
  GitCommitted: "git.committed",
  GitCheckout: "git.checkout",
  GitCommandSuccess: "git.command.success",
  GitAuditTimeout: "git.audit.timeout",
  GitAuditFailed: "git.audit.failed",
  GitRevertCompleted: "git.revert.completed",
  GitRevertPartialFailure: "git.revert.partial_failure",

  // Daemon lifecycle events (apps/daemon/main.ts, apps/exactl)
  DaemonStarting: "daemon.starting",
  // daemon.started: emitted by the `exactl daemon start` CLI once the process is ALIVE (a PID
  // check) — it does NOT mean the daemon's watchers are listening yet.
  DaemonStarted: "daemon.started",
  // daemon.ready: emitted by the daemon process itself (apps/daemon/main.ts) ONLY after every
  // file-watcher is confirmed listening — the authoritative "fully functioning" signal. A consumer
  // that must not race the request watcher (e.g. before submitting a request) waits for THIS, not
  // daemon.started.
  DaemonReady: "daemon.ready",
  DaemonStopping: "daemon.stopping",
  DaemonStopped: "daemon.stopped",
  DaemonForceStopping: "daemon.force_stopping",
  DaemonRestarting: "daemon.restarting",
  DaemonRestarted: "daemon.restarted",
  DaemonNotRunning: "daemon.not_running",
  DaemonNoLogs: "daemon.no_logs",
  DaemonStartFailed: "daemon.start_failed",

  // File watcher events (apps/daemon/src/watcher.ts)
  WatcherFileReady: "watcher.file_ready",
  WatcherFileError: "watcher.file_error",
  WatcherFileStable: "watcher.file_stable",
  WatcherFileUnstable: "watcher.file_unstable",
  WatcherFileAlreadyProcessing: "watcher.file_already_processing",
  WatcherError: "watcher.error",

  // Context loader events (context_loader.ts)
  ContextLoaded: "context.loaded",
  ContextFileLoadError: "context.file_load_error",

  // Config events
  ConfigLoaded: "config.loaded",
  ConfigUpdated: "config.updated",
  ConfigDbWatcherStarted: "config.db_watcher.started",
  ConfigDbWatcherChangeDetected: "config.db_watcher.change_detected",
  ConfigCutoverResolved: "config.cutover.resolved",
  // Phase 139 (configuring Phase 3): rollback, key locking, integrity checksum
  ConfigRolledBack: "config.rolled_back",
  ConfigKeyLocked: "config.key_locked",
  ConfigKeyUnlocked: "config.key_unlocked",
  ConfigIntegrityVerified: "config.integrity_verified",
  ConfigIntegrityMismatch: "config.integrity_mismatch",

  // Security events
  SecurityFileValidationFilteredAll: "security.file_validation_filtered_all",
  SecuritySymlinkDetected: "symlink_detected",
  SecurityViolation: "security.violation",
  SecurityPathTraversalAttempted: "security.path_traversal_attempted",
  SecurityPathAccessDenied: "security.path_access_denied",

  // Portal / path events
  PathResolved: "path.resolved",
  PathResolutionFailed: "path.resolution_failed",
  PathResolutionError: "path.resolution_error",
  PathInvalidAlias: "path.invalid_alias",
  PathAccessDenied: "path.access_denied",
  PortalAnalyzed: "portal.analyzed",

  // Request processing — status and provider events
  RequestStatusUpdateFailed: "request.status_update_failed",
  RequestAnalyzed: "request.analyzed",
  RequestFlowValidationFailed: "flow.validation.failed",
  RequestProviderSelected: "provider.selected",
  RequestProviderSelectionFailed: "provider.selection_failed",
  RequestBlueprintNotFound: "blueprint.not_found",
  RequestBlueprintLoadedFallback: "blueprint.loaded_fallback",
  RequestPlanSaveRejectedFailed: "plan.save_rejected_failed",

  // MCP server events
  McpPromptsExecutePlan: "mcp.prompts.execute_plan",
  McpPromptsCreateReview: "mcp.prompts.create_review",
  McpPromptsCommitMessage: "mcp.prompts.commit_message",
  McpResourcesDiscovered: "mcp.resources.discovered",
  McpServerStarted: "mcp.server.started",
  McpServerStopped: "mcp.server.stopped",
  McpInitialize: "mcp.initialize",
  McpToolsList: "mcp.tools.list",
  McpToolNotFound: "mcp.tool.not_found",
  McpToolExecuted: "mcp.tool.executed",
  McpPermissionDenied: "mcp.permission.denied",
  McpToolFailed: "mcp.tool.failed",
  McpResourcesRead: "mcp.resources.read",
  McpHttpServerStarted: "mcp.http_server.started",

  // Daemon / watcher lifecycle (additional)
  DaemonRequestProcessorInitialized: "request_processor.initialized",
  DaemonFileDetected: "file.detected",
  PlanGenerated: "plan.generated",
  PlanDetected: "plan.detected",
  ShutdownWatchersStopped: "shutdown.watchers_stopped",
  ShutdownAutoApprovalStopped: "shutdown.auto_approval_stopped",
  ShutdownDatabaseClosed: "shutdown.database_closed",

  // Error handling
  SafeErrorInternalDetails: "safe_error.internal_details",

  // Database events
  DatabaseConnected: "database.connected",

  // LLM provider events
  LlmProviderInitialized: "llm.provider.initialized",
  LlmCallStarted: "llm.call.started",
  LlmCallCompleted: "llm.call.completed",
  LlmCallFailed: "llm.call.failed",
  LlmStreamCompleted: "llm.stream.completed",
  LlmStreamFailed: "llm.stream.failed",
  LlmStreamCancelled: "llm.stream.cancelled",

  // Model resolution events (Phase 132)
  ModelResolved: "model.resolved",

  // Model registry events (Phase 135)
  ModelPricingStale: "model.pricing.stale",
  ModelCostDivergence: "model.cost.divergence",
  ModelAdmitted: "model.admitted",
  ModelRetired: "model.retired",
  ModelCatalogRefreshed: "model.catalog.refreshed",
  ModelPricingRefreshed: "model.pricing.refreshed",
  ModelRegistryRefreshFailed: "model.registry.refresh.failed",
  ModelRouteSelected: "model.route.selected",
  ModelBenchmarkRefreshed: "model.benchmark.refreshed",
  ModelBenchmarkMissing: "model.benchmark.missing",

  // Reserved for future use (Phase 85 — postponed)
  ChildRunSpawned: "child_run.spawned",
  ChildRunCompleted: "child_run.completed",

  // Reserved for future use (Phase 86 — cancelled)
  ResourceLockAcquired: "resource_lock.acquired",
  ResourceLockBlocked: "resource_lock.blocked",
  ResourceLockReleased: "resource_lock.released",

  // Trigger lifecycle events (Phase 88)
  TriggerIngested: "trigger.ingested",
  TriggerAccepted: "trigger.accepted",
  TriggerRejected: "trigger.rejected",

  // Context budget events (Phase 103)
  ContextBudgetAllocated: "context.budget.allocated",
  ContextBudgetConsumed: "context.budget.consumed",
  ContextSectionTruncated: "context.section.truncated",
  ContextBudgetExceeded: "context.budget.exceeded",

  // Shutdown lifecycle
  DaemonShutdownSignal: "shutdown.signal_received",
  DaemonShutdownStarting: "shutdown.starting",
  DaemonShutdownCleanupRunning: "shutdown.cleanup.running",
  DaemonShutdownCleanupCompleted: "shutdown.cleanup.completed",
  DaemonShutdownCleanupTimedOut: "shutdown.cleanup.timed_out",
  DaemonShutdownCleanupFailed: "shutdown.cleanup.failed",
  DaemonShutdownDuplicate: "shutdown.duplicate",
  DaemonShutdownErrors: "shutdown.completed_with_errors",
  DaemonShutdownComplete: "shutdown.complete",
  DaemonUnhandledRejection: "daemon.unhandled_rejection",
  DaemonUncaughtError: "daemon.uncaught_error",
  DaemonErrorHandlersRegistered: "daemon.error_handlers_registered",

  // ---------------------------------------------------------------------------
  // Guardrail (Phase 107)
  // ---------------------------------------------------------------------------
  GuardrailScreenPass: "guardrail.screen.pass",
  GuardrailScreenViolation: "guardrail.screen.violation",
  GuardrailScreenError: "guardrail.screen.error",
  GuardrailWarn: "guardrail.warn",
  GuardrailBlock: "guardrail.block",
  GuardrailInitialized: "guardrail.initialized",
  GuardrailInitFailed: "guardrail.init_failed",

  // ---------------------------------------------------------------------------
  // Dynamic tools (Phase 163)
  // ---------------------------------------------------------------------------
  DynamicToolsInitFailed: "dynamic_tools.init_failed",

  // ---------------------------------------------------------------------------
  // Voting / Consensus (Phase 113)
  // ---------------------------------------------------------------------------
  VotingStarted: "voting.started",
  VotingResolved: "voting.resolved",
  VotingNoConsensus: "voting.no_consensus",
  VotingRunnerFailed: "voting.runner_failed",
  VotingStepConsensusResolved: "voting.step.consensus_resolved",

  // ---------------------------------------------------------------------------
  // HITL / Governance (Phase 118)
  // ---------------------------------------------------------------------------
  HitlPolicyMatched: "hitl.policy.matched",

  // ---------------------------------------------------------------------------
  // Health check events (Phase 168)
  // ---------------------------------------------------------------------------
  HealthCheckAll: "health.check_all",
  HealthCheckProvider: "health.check_provider",
} as const;

export type TDomainEventType = typeof DomainEventType[keyof typeof DomainEventType];
