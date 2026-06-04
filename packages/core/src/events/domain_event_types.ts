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

  // Config events
  ConfigLoaded: "config.loaded",
  ConfigUpdated: "config.updated",

  // Security events
  SecurityFileValidationFilteredAll: "security.file_validation_filtered_all",
  SecuritySymlinkDetected: "symlink_detected",
  SecurityViolation: "security.violation",

  // Database events
  DatabaseConnected: "database.connected",

  // LLM provider events
  LlmProviderInitialized: "llm.provider.initialized",

  // Reserved for future use (Phase 85 — postponed)
  ChildRunSpawned: "child_run.spawned",
  ChildRunCompleted: "child_run.completed",

  // Reserved for future use (Phase 86 — cancelled)
  ResourceLockAcquired: "resource_lock.acquired",
  ResourceLockBlocked: "resource_lock.blocked",
  ResourceLockReleased: "resource_lock.released",
} as const;

export type TDomainEventType = typeof DomainEventType[keyof typeof DomainEventType];
