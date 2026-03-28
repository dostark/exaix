/**
 * @module SharedEnums
 * @path src/shared/enums.ts
 * @description Centralized enums share between Core and TUI.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [src/shared/schemas/*.ts, src/shared/status/*.ts]
 */

export enum GeneralStatus {
  UNKNOWN = "unknown",

  // Basic states
  ACTIVE = "active",
  INACTIVE = "inactive",
  BROKEN = "broken",
  PENDING = "pending",
  COMPLETED = "completed",
  FAILED = "failed",
  CONFIRMED = "confirmed",
  CANCELLED = "cancelled",
  DRAFT = "draft",
  DEPRECATED = "deprecated",
  RUNNING = "running",
  STOPPED = "stopped",

  // Plan states
  REVIEW = "review",
  APPROVED = "approved",
  REJECTED = "rejected",
  NEEDS_REVISION = "needs_revision",

  // Agent/System states
  ERROR = "error",

  // Request states
  IN_PROGRESS = "in_progress",
  PLANNED = "planned",
}

/**
 * States of a circuit breaker.
 */
export enum CircuitState {
  CLOSED = "closed",
  OPEN = "open",
  HALF_OPEN = "half-open",
}

/**
 * Actor type categories per GLOSSARY.md.
 * Defines who can initiate, receive, or process a request or event in Exaix.
 */
export enum ActorType {
  USER = "user",
  SERVICE = "service",
  MCP_CLIENT = "mcp-client",
  IDENTITY = "identity",
}

/**
 * Agent kind categories per GLOSSARY.md.
 * Identifies which runtime agent implementation handled an action.
 */
export enum AgentKind {
  IDENTITY_RUNNER = "identity-runner",
  AGENT_EXECUTOR = "agent-executor",
  FLOW_AGENT = "flow-agent",
  TOOL_AGENT = "tool-agent",
  REQUEST_ROUTER = "request-router",
}

/**
 * MCP transport types.
 */
export enum McpTransportType {
  STDIO = "stdio",
  SSE = "sse",
}

/**
 * Message roles (e.g., for LLM conversations).
 */
export enum MessageRole {
  USER = "user",
  ASSISTANT = "assistant",
  SYSTEM = "system",
  DEVELOPER = "developer",
  TOOL = "tool",
}

/**
 * Data serialization formats.
 */
export enum DataFormat {
  JSON = "json",
  YAML = "yaml",
  TOML = "toml",
  MARKDOWN = "markdown",
  TEXT = "text",
}

/**
 * Memory type classifications.
 */
export enum MemoryType {
  PROJECT = "project",
  EXECUTION = "execution",
  PROPOSAL = "proposal",
  SYSTEM = "system",
  RELEVANT = "relevant",
  PATTERN = "pattern",
  DECISION = "decision",
  LEARNING = "learning",
}

/**
 * Types of AI providers supported by the system.
 */
export enum ProviderType {
  /** Local Ollama instance for running open-source models */
  OLLAMA = "ollama",
  /** Anthropic's Claude models */
  ANTHROPIC = "anthropic",
  /** OpenAI's GPT models */
  OPENAI = "openai",
  /** Google's Gemini models */
  GOOGLE = "google",
  /** Mock provider for testing and development */
  MOCK = "mock",
}

/**
 * Mock strategy types for the mock provider.
 * Defines different behaviors for mock responses during testing.
 */
export enum MockStrategy {
  /** Use recorded responses from previous interactions */
  RECORDED = "recorded",
  /** Use scripted responses defined in configuration */
  SCRIPTED = "scripted",
  /** Generate responses based on pattern matching */
  PATTERN = "pattern",
  /** Always return failures for testing error handling */
  FAILING = "failing",
  /** Introduce delays to simulate slow responses */
  SLOW = "slow",
}

/**
 * Status for the Exaix daemon.
 */
export enum DaemonStatus {
  RUNNING = GeneralStatus.RUNNING,
  STOPPED = GeneralStatus.STOPPED,
  ERROR = GeneralStatus.ERROR,
  UNKNOWN = GeneralStatus.UNKNOWN,
}

/**
 * Complexity levels for tasks and operations.
 * Used to determine processing requirements and resource allocation.
 */
export enum TaskComplexity {
  /** Basic operations requiring minimal processing */
  SIMPLE = "simple",
  /** Standard operations with moderate complexity */
  MEDIUM = "medium",
  /** Complex operations requiring significant processing */
  COMPLEX = "complex",
}

/**
 * Pricing tiers for AI services and operations.
 * Determines cost categorization and billing levels.
 */
export enum PricingTier {
  /** Local execution with no external costs */
  LOCAL = "local",
  /** Free tier services */
  FREE = "free",
  /** Low-cost commercial services */
  LOW = "low",
  /** Medium-cost commercial services */
  MEDIUM = "medium",
  /** High-cost premium services */
  HIGH = "high",
}

/**
 * Severity levels for security events and alerts.
 * Used to prioritize security responses and logging.
 */
export enum SecuritySeverity {
  /** Minor security events requiring basic logging */
  LOW = "low",
  /** Moderate security concerns requiring attention */
  MEDIUM = "medium",
  /** Serious security incidents requiring immediate action */
  HIGH = "high",
  /** Critical security breaches requiring urgent response */
  CRITICAL = "critical",
}

/**
 * Types of security events that can occur in the system.
 * Categorizes different kinds of security-related activities.
 */
export enum SecurityEventType {
  /** Authentication-related events (login, logout, token validation) */
  AUTH = "auth",
  /** Permission and access control events */
  PERMISSION = "permission",
  /** File system access and modification events */
  FILE_ACCESS = "file_access",
  /** API call and external service interaction events */
  API_CALL = "api_call",
  /** Configuration and settings change events */
  CONFIG_CHANGE = "config_change",
}

/**
 * Results of security events and operations.
 * Indicates the outcome of security-related actions.
 */
export enum SecurityEventResult {
  /** Operation completed successfully */
  SUCCESS = "success",
  /** Operation was denied or blocked */
  DENIED = "denied",
  /** Operation failed due to an error */
  ERROR = "error",
}

/**
 * Verification result status.
 */
export enum VerificationStatus {
  OK = "ok",
  FAILED = "failed",
}

/**
 * Common grouping modes for TUI views.
 */
export enum GroupingMode {
  IDENTITY = "identity",
  ACTION = "action",
  NONE = "none",
  STATUS = "status",
  PROJECT = "project",
}

/**
 * Split directions for TUI panes.
 */
export enum SplitDirection {
  VERTICAL = "vertical",
  HORIZONTAL = "horizontal",
}

/**
 * Grouping modes for Request Manager.
 */
export enum RequestGroupingMode {
  NONE = "none",
  STATUS = "status",
  PRIORITY = "priority",
  IDENTITY = "identity",
}

/**
 * Sources for request creation.
 */
export enum RequestSource {
  CLI = "cli",
  FILE = "file",
  INTERACTIVE = "interactive",
  TUI = "tui",
  MCP = "mcp",
}

/**
 * Direction for database migrations.
 */
export enum MigrationDirection {
  UP = "up",
  DOWN = "down",
}

/**
 * Common operations for request management.
 */
export enum RequestOperation {
  CREATE = "create",
  VIEW = "view",
  DELETE = "delete",
}

/**
 * Grouping modes for Structured Log Viewer.
 */
export enum LogGroupingMode {
  CORRELATION = "correlation",
  TRACE = "trace",
  IDENTITY = "identity",
  LEVEL = "level",
  TIME = "time",
  NONE = "none",
}

/**
 * Grouping modes for Skills Manager.
 */
export enum SkillGroupingMode {
  SOURCE = "source",
  STATUS = "status",
  NONE = "none",
}

/**
 * Fields to omit when creating or updating skills.
 */
/**
 * Skill fields that are automatically managed by the system.
 */
export enum SkillManagedField {
  ID = "id",
  CREATED_AT = "created_at",
  USAGE_COUNT = "usage_count",
}

/**
 * Fields that cannot be changed after creation.
 */
export enum SkillImmutableField {
  ID = "id",
  SKILL_ID = "skill_id",
  CREATED_AT = "created_at",
}

/**
 * @deprecated Use SkillManagedField instead.
 */
export type SkillOmitFields = SkillManagedField;

/**
 * Common purposes for dialogs.
 */
export enum DialogPurpose {
  SPLIT = "split",
  CHANGE = "change",
  NEW = "new",
}

/**
 * Common modes for layout management.
 */
export enum LayoutMode {
  SAVE = "save",
  LOAD = "load",
  DELETE = "delete",
}

/**
 * Severity levels for linting.
 */
export enum Severity {
  ERROR = "error",
  WARN = "warn",
}

/**
 * Types of markdown list markers.
 */
export enum MarkdownListKind {
  UL = "ul",
  OL = "ol",
}

/**
 * Navigation directions for lists and trees.
 */
export enum NavDirection {
  UP = "up",
  DOWN = "down",
  FIRST = "first",
  LAST = "last",
}

/**
 * Directions for resizing panes.
 */
export enum ResizeDirection {
  LEFT = "left",
  RIGHT = "right",
  UP = "up",
  DOWN = "down",
}

/**
 * Directions for scrolling content.
 */
export enum ScrollDirection {
  UP = "up",
  DOWN = "down",
  TOP = "top",
  BOTTOM = "bottom",
}

/**
 * Keyboard modifiers for TUI input.
 */
export enum KeyModifier {
  CTRL = "ctrl",
  ALT = "alt",
  SHIFT = "shift",
  META = "meta",
}

/**
 * User interface output formats.
 */
export enum UIOutputFormat {
  TABLE = "table",
  JSON = "json",
  MARKDOWN = "md",
}

/**
 * Memory record statuses.
 */
export enum MemoryRecordStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  ARCHIVED = "archived",
}

/**
 * Actions taken after gate evaluation.
 */
export enum FlowGateAction {
  PASSED = "passed",
  RETRY = "retry",
  HALTED = "halted",
  CONTINUED_WITH_WARNING = "continued-with-warning",
}

/**
 * Log rotation intervals.
 */
export enum LogRotationInterval {
  DAILY = "daily",
  HOURLY = "hourly",
}

/**
 * Types of requests in the system.
 */
export enum RequestKind {
  FLOW = "flow",
  IDENTITY = "identity",
}

/**
 * File change operation types.
 */
export enum FileOperation {
  CREATE = "create",
  MODIFY = "modify",
  DELETE = "delete",
}

/**
 * Types of artifacts produced by agents.
 */
export enum ArtifactType {
  ANALYSIS = "analysis",
  REPORT = "report",
  DIAGRAM = "diagram",
}

/**
 * Operations that can be performed on a portal.
 */
export enum PortalOperation {
  READ = "read",
  WRITE = "write",
  GIT = "git",
}

/**
 * Strategy for how Exaix executes plans within a portal repository.
 * - BRANCH: execute directly in the repository checkout using feature branches
 * - WORKTREE: execute in a git worktree (feature branch still used for review)
 */
export enum PortalExecutionStrategy {
  BRANCH = "branch",
  WORKTREE = "worktree",
}

/**
 * Cost tier classification for providers.
 */
export enum ProviderCostTier {
  FREE = "free",
  FREEMIUM = "freemium",
  PAID = "paid",
  LOCAL = "local",
}

/**
 * Fine-grained permission actions.
 */
export enum PermissionAction {
  READ = "read",
  WRITE = "write",
  EXECUTE = "execute",
  DELETE = "delete",
}

/**
 * Security modes for execution.
 */
export enum SecurityMode {
  /** Fully isolated execution */
  SANDBOXED = "sandboxed",
  /** Shared access to selected resources */
  HYBRID = "hybrid",
}

/**
 * TUI spinner and animation styles.
 */
export enum SpinnerStyle {
  DOTS = "dots",
  BRAILLE = "braille",
  LINE = "line",
  ARC = "arc",
  BOUNCE = "bounce",
  PULSE = "pulse",
}

/**
 * Types of reviews or artifacts.
 */
export enum ReviewType {
  CODE = "code",
  ARTIFACT = "artifact",
}

/**
 * Review type filters.
 */
export enum ReviewTypeFilter {
  ALL = "all",
  CODE = "code",
  ARTIFACT = "artifact",
}

/**
 * Artifact specific types for CLI/Review.
 */
export enum ArtifactSubtype {
  ANALYSIS = "analysis",
  REPORT = "report",
  DIAGRAM = "diagram",
}

/**
 * Memory scope for storage.
 */
export enum StorageScope {
  USER = "user",
  SESSION = "session",
  REPO = "repo",
}

/**
 * Health status codes for agents.
 */
export enum AgentHealth {
  HEALTHY = "healthy",
  WARNING = "warning",
  CRITICAL = "critical",
}

/**
 * Status states for task and execution lifecycle.
 * Tracks the progress and completion state of operations.
 */
export enum ExecutionStatus {
  PENDING = GeneralStatus.PENDING,
  ACTIVE = GeneralStatus.ACTIVE,
  RUNNING = GeneralStatus.RUNNING,
  COMPLETED = GeneralStatus.COMPLETED,
  FAILED = GeneralStatus.FAILED,
}

/**
 * Priority levels for user requests.
 */
export enum RequestPriority {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * Status for user requests.
 */
// NOTE: RequestStatus/PlanStatus/MemoryStatus are no longer enums.
// Use the canonical const-object + union-type modules:
// - src/requests/request_status.ts
// - src/plans/plan_status.ts
// - src/memory/memory_status.ts

/**
 * Status for skill lifecycle.
 */
export enum SkillStatus {
  DRAFT = GeneralStatus.DRAFT,
  ACTIVE = GeneralStatus.ACTIVE,
  DEPRECATED = GeneralStatus.DEPRECATED,
}

/**
 * Status for portal lifecycle.
 */
export enum PortalStatus {
  ACTIVE = GeneralStatus.ACTIVE,
  INACTIVE = GeneralStatus.INACTIVE,
  BROKEN = GeneralStatus.BROKEN,
}

/**
 * Status for dialog lifecycle.
 */
export enum DialogStatus {
  ACTIVE = GeneralStatus.ACTIVE,
  CONFIRMED = GeneralStatus.CONFIRMED,
  CANCELLED = GeneralStatus.CANCELLED,
}

/**
 * Confidence levels for AI-generated content and decisions.
 * Represents the system's certainty in its outputs.
 */
export enum ConfidenceLevel {
  /** Low confidence in the result */
  LOW = "low",
  /** Moderate confidence in the result */
  MEDIUM = "medium",
  /** High confidence in the result */
  HIGH = "high",
}

/**
 * Granular confidence assessment levels for detailed evaluation.
 * Provides more precise confidence measurements.
 */
export enum ConfidenceAssessmentLevel {
  /** Very low confidence, result is highly uncertain */
  VERY_LOW = "very_low",
  /** Low confidence, result needs verification */
  LOW = "low",
  /** Moderate confidence, result is reasonably reliable */
  MEDIUM = "medium",
  /** High confidence, result is trustworthy */
  HIGH = "high",
  /** Very high confidence, result is highly reliable */
  VERY_HIGH = "very_high",
}

/**
 * Priority levels for task scheduling and execution.
 * Lower numeric values indicate higher priority.
 */
export enum PriorityLevel {
  /** Highest priority for local operations */
  LOCAL = 0,
  /** Low priority tasks */
  LOW = 2,
  /** Medium priority tasks */
  MEDIUM = 3,
  /** High priority tasks */
  HIGH = 4,
  /** Default priority for unspecified tasks */
  DEFAULT = 999,
}

/**
 * Types of findings in code analysis and review results.
 * Categorizes different kinds of issues or observations found during analysis.
 */
export enum AnalysisFindingType {
  /** A problem that needs to be fixed */
  ISSUE = "issue",
  /** A recommendation for improvement */
  SUGGESTION = "suggestion",
  /** An informational note or observation */
  NOTE = "note",
  /** A warning about potential issues */
  WARNING = "warning",
  /** A critical error that must be addressed */
  ERROR = "error",
}

/**
 * Severity levels for analysis findings.
 * Indicates the importance and urgency of addressing each finding.
 */
export enum AnalysisFindingSeverity {
  /** Minor issues that can be addressed later */
  LOW = "low",
  /** Moderate issues that should be considered */
  MEDIUM = "medium",
  /** Important issues that need attention */
  HIGH = "high",
  /** Critical issues that require immediate action */
  CRITICAL = "critical",
}

/**
 * SQLite journal modes for database configuration.
 * Defines how SQLite handles the rollback journal file.
 */
export enum SqliteJournalMode {
  /** Delete the journal file after each transaction */
  DELETE = "delete",
  /** Truncate the journal file to zero length after each transaction */
  TRUNCATE = "truncate",
  /** Persist the journal file after each transaction */
  PERSIST = "persist",
  /** Store the journal in memory */
  MEMORY = "memory",
  /** Use Write-Ahead Logging for better concurrency */
  WAL = "WAL",
  /** Disable the rollback journal entirely */
  OFF = "off",
}

/**
 * Log levels for system logging configuration.
 * Defines the verbosity levels for logging output.
 */
export enum LogLevel {
  /** Detailed diagnostic information for debugging */
  DEBUG = "debug",
  /** General information about system operation */
  INFO = "info",
  /** Warning messages about potential issues */
  WARN = "warn",
  /** Error messages about failures */
  ERROR = "error",
  /** Critical errors requiring immediate attention */
  FATAL = "fatal",
}

/**
 * Types of messages for status updates and notifications.
 * Used to categorize the nature of messages displayed to users.
 */
export enum MessageType {
  INFO = "info",
  SUCCESS = "success",
  WARNING = "warning",
  ERROR = "error",
}

/**
 * Agent execution error types.
 */
export enum AgentExecutionErrorType {
  TIMEOUT = "timeout",
  BLUEPRINT_NOT_FOUND = "blueprint_not_found",
  PORTAL_NOT_FOUND = "portal_not_found",
  PERMISSION_DENIED = "permission_denied",
  MCP_CONNECTION_FAILED = "mcp_connection_failed",
  TOOL_ERROR = "tool_error",
  GIT_ERROR = "git_error",
  SECURITY_VIOLATION = "security_violation",
  EXECUTION_ERROR = "execution_error",
}

/**
 * Types of steps in a flow.
 */
export enum FlowStepType {
  AGENT = "agent",
  GATE = "gate",
  BRANCH = "branch",
  CONSENSUS = "consensus",
}

/**
 * Actions taken when a flow gate evaluation fails.
 */
export enum FlowGateOnFail {
  RETRY = "retry",
  HALT = "halt",
  CONTINUE_WITH_WARNING = "continue-with-warning",
}

/**
 * Methods used to reach consensus in a flow.
 */
export enum FlowConsensusMethod {
  MAJORITY = "majority",
  WEIGHTED = "weighted",
  UNANIMOUS = "unanimous",
  JUDGE = "judge",
}

/**
 * Sources for flow step input data.
 */
export enum FlowInputSource {
  REQUEST = "request",
  STEP = "step",
  AGGREGATE = "aggregate",
  FEEDBACK = "feedback",
}

/**
 * Formats for flow output.
 */
export enum FlowOutputFormat {
  MARKDOWN = "markdown",
  JSON = "json",
  CONCAT = "concat",
}

/**
 * Execution mode for a flow step.
 * - DECLARED: tools are committed in the plan before execution (default, current behavior)
 * - DYNAMIC: model selects tools from permitted_tools at runtime (ReAct-style)
 */
export enum StepExecutionMode {
  DECLARED = "declared",
  DYNAMIC = "dynamic",
}

/**
/**
 * Standard MCP tool names used in the system.
 */
export enum McpToolName {
  READ_FILE = "read_file",
  WRITE_FILE = "write_file",
  RUN_COMMAND = "run_command",
  LIST_DIRECTORY = "list_directory",
  SEARCH_FILES = "search_files",
  CREATE_DIRECTORY = "create_directory",
}

/**
 * Sources for system configuration.
 */
export enum ConfigSource {
  ENV = "env",
  CONFIG = "config",
  DEFAULT = "default",
}

/**
 * Types of references in memory banks.
 */
export enum MemoryReferenceType {
  FILE = "file",
  API = "api",
  DOC = "doc",
  URL = "url",
  EXECUTION = "execution",
}

/**
 * Sources for memory bank entries.
 */
export enum MemoryBankSource {
  EXECUTION = "execution",
  USER = "user",
  IDENTITY = "identity",
  LEARNED = "learned",
  CORE = "core",
  PROJECT = "project",
  FILE = "file",
  DATABASE = "database",
  LLM = "llm",
}

/**
 * Applicability scopes for memory and configuration.
 */
export enum MemoryScope {
  GLOBAL = "global",
  PROJECT = "project",
  SESSION = "session",
}

/**
 * Categories for learned insights and patterns.
 */
export enum LearningCategory {
  PATTERN = "pattern",
  ANTI_PATTERN = "anti-pattern",
  DECISION = "decision",
  INSIGHT = "insight",
  TROUBLESHOOTING = "troubleshooting",
}

/**
 * Operations that can be performed on memory bank entries.
 */
export enum MemoryOperation {
  ADD = "add",
  UPDATE = "update",
  PROMOTE = "promote",
  DEMOTE = "demote",
  ARCHIVE = "archive",
  DELETE = "delete",
}

/**
 * Sources for review and approval actions.
 */
export enum ReviewSource {
  USER = "user",
  AUTO = "auto",
}

/**
 * Quality levels for reflexive critique.
 */
export enum CritiqueQuality {
  EXCELLENT = "excellent",
  GOOD = "good",
  ACCEPTABLE = "acceptable",
  NEEDS_IMPROVEMENT = "needs_improvement",
  POOR = "poor",
}

/**
 * Types of issues identified in critique.
 */
export enum CritiqueIssueType {
  ACCURACY = "accuracy",
  COMPLETENESS = "completeness",
  CLARITY = "clarity",
  RELEVANCE = "relevance",
  FORMAT = "format",
  LOGIC = "logic",
  OTHER = "other",
}

/**
 * Severity levels for critique issues.
 */
export enum CritiqueSeverity {
  CRITICAL = "critical",
  MAJOR = "major",
  MINOR = "minor",
  SUGGESTION = "suggestion",
}

/**
 * Verdicts for evaluation results.
 */
export enum EvaluationVerdict {
  PASS = "pass",
  FAIL = "fail",
  NEEDS_IMPROVEMENT = "needs_improvement",
}

/**
 * Impact of a factor on confidence.
 */
export enum FactorImpact {
  POSITIVE = "positive",
  NEGATIVE = "negative",
  NEUTRAL = "neutral",
}

/**
 * Category for evaluation criteria.
 */
export enum EvaluationCategory {
  QUALITY = "quality",
  CORRECTNESS = "correctness",
  COMPLETENESS = "completeness",
  SECURITY = "security",
  STYLE = "style",
  PERFORMANCE = "performance",
}

/**
 * Types of issues identified in tool reflection.
 */
export enum ToolReflectionIssueType {
  ERROR = "error",
  INCOMPLETE = "incomplete",
  UNEXPECTED = "unexpected",
  TIMEOUT = "timeout",
  PERMISSION = "permission",
  FORMAT = "format",
  OTHER = "other",
}

/**
 * Severity levels for tool reflection issues.
 */
export enum ToolReflectionSeverity {
  CRITICAL = "critical",
  MAJOR = "major",
  MINOR = "minor",
}

/**
 * Status of an archived plan.
 */
export enum ArchiveStatus {
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

/**
 * Type of a session memory item.
 */
export enum SessionMemoryItemType {
  LEARNING = "learning",
  PATTERN = "pattern",
  DECISION = "decision",
  EXECUTION = "execution",
  INSIGHT = "insight",
}

/**
 * Types of search results and entries in memory banks.
 */
export enum MemoryEntryType {
  PROJECT = MemoryType.PROJECT,
  EXECUTION = MemoryType.EXECUTION,
  PATTERN = MemoryType.PATTERN,
  DECISION = MemoryType.DECISION,
  LEARNING = MemoryType.LEARNING,
}

/**
 * Types of activity in the system for summaries and journaling.
 */
export enum ActivityType {
  EXECUTION = "execution",
  TASK = "task",
  DECISION = "decision",
}

/**
 * Valid actors for activity logging.
 */
export enum ActivityActor {
  HUMAN = "human",
  IDENTITY = "identity",
  SYSTEM = "system",
}

/**
 * Overall health status of the service or a component.
 */
export enum HealthStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  UNHEALTHY = "unhealthy",
}

/**
 * Result status of an individual health check.
 */
export enum HealthCheckVerdict {
  PASS = "pass",
  WARN = "warn",
  FAIL = "fail",
}

/**
 * Types of nodes in the TUI tree view.
 */
export enum TuiNodeType {
  ROOT = "root",
  SCOPE = "scope",
  PROJECT = "project",
  EXECUTION = "execution",
  LEARNING = "learning",
  PATTERN = "pattern",
  DECISION = "decision",
  IDENTITY = "identity",
  STATUS_GROUP = "status-group",
  MODEL_GROUP = "model-group",
  GROUP = "group",
}

/**
 * Grouping modes for TUI views.
 */
export enum TuiGroupBy {
  NONE = "none",
  STATUS = "status",
  MODEL = "model",
}

/**
 * Capabilities supported by AI providers.
 */
export enum ProviderCapability {
  CHAT = "chat",
  STREAMING = "streaming",
  VISION = "vision",
  TOOLS = "tools",
}

/**
 * Icons used in the TUI.
 */
export enum TuiIcon {
  IDENTITY = "🤖",
  LEARNING = "🎯",
  BRAIN = "🧠",
  SUCCESS = "✅",
  WARNING = "⚠️",
  CRITICAL = "❌",
  INFO = "ℹ️",
  BULLET = "•",
  PORTAL_ACTIVE = "🟢",
  PORTAL_BROKEN = "🔴",
  PORTAL_INACTIVE = "⚪",
  FOLDER = "📂",
}

/**
 * Types of dialogs used in the Request Manager View.
 */
export enum RequestDialogType {
  SEARCH = "search",
  FILTER_STATUS = "filter-status",
  FILTER_IDENTITY = "filter-identity",
  CREATE = "create",
  PRIORITY = "priority",
}

/**
 * Actions for daemon control key bindings.
 */
export enum DaemonKeyAction {
  START = "start",
  STOP = "stop",
  RESTART = "restart",
  VIEW_LOGS = "view-logs",
  VIEW_CONFIG = "view-config",
  REFRESH = "refresh",
  AUTO_REFRESH = "auto-refresh",
  HELP = "help",
  QUIT = "quit",
  CANCEL = "cancel",
}

/**
 * Common properties for evaluation criteria.
 */
export enum EvaluationCriterionProperty {
  NAME = "name",
  DESCRIPTION = "description",
  WEIGHT = "weight",
  REQUIRED = "required",
  CATEGORY = "category",
}
/**
 * Connection status for real-time streams.
 */
export enum ConnectionStatus {
  CONNECTING = "connecting",
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  ERROR = "error",
}

/**
 * Status indicators for UI elements.
 */
export enum StatusIndicator {
  ACTIVE = "active",
  PENDING = "pending",
  COMPLETED = "completed",
  FAILED = "failed",
  APPROVED = "approved",
  REJECTED = "rejected",
  ARCHIVED = "archived",
  RUNNING = "running",
}

/**
 * Fields used for grouping lists.
 */
export enum GroupingField {
  SOURCE = "source",
  STATUS = "status",
  CATEGORY = "category",
  PRIORITY = "priority",
}

/**
 * Actions for daemon control.
 */
export enum DaemonAction {
  START = "start",
  STOP = "stop",
  RESTART = "restart",
}

/**
 * Analysis depth for portal codebase knowledge gathering.
 */
export enum PortalAnalysisMode {
  /** Directory scan + config parsing only — no LLM (<5 s). */
  QUICK = "quick",
  /** Adds architecture inference (1 LLM call) + symbol extraction (~15 s). */
  STANDARD = "standard",
  /** Full convention mapping + complete symbol index (~60 s). */
  DEEP = "deep",
}

/**
 * Assessment strategy used by the RequestQualityGate service.
 */
export enum QualityGateMode {
  /** Fast, zero-cost text signal analysis — no LLM calls. */
  HEURISTIC = "heuristic",
  /** Full LLM-powered quality assessment. */
  LLM = "llm",
  /** Heuristic first; escalate to LLM only for borderline scores. */
  HYBRID = "hybrid",
}

/**
 * Outcome status returned by the `exactl request clarify` command.
 */
export enum ClarifyResultStatus {
  /** Session has pending questions awaiting user answers. */
  QUESTIONS = "questions",
  /** Session is complete — request is re-queued for processing. */
  COMPLETE = "complete",
  /** User cancelled clarification — request is re-queued as-is. */
  CANCELLED = "cancelled",
  /** No clarification session found for the given request. */
  NO_SESSION = "no_session",
}
