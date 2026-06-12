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

export const DomainEventType = {
  // Flow step events
  FlowStepExecuted: "flow.step.executed",
  FlowStepReplayed: "flow.step.replayed",
  FlowStepInvalidated: "flow.step.invalidated",

  // Execution context events
  ExecutionContextCompacted: "execution.context.compacted",

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

  // Cost tracking events
  LlmUsageRecorded: "llm.usage",

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

  // Report events (execution_loop.ts)
  ReportGenerated: "report.generated",
  ReportError: "report.error",

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
  DaemonStarted: "daemon.started",
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
} as const;

export type TDomainEventType = typeof DomainEventType[keyof typeof DomainEventType];
