/**
 * @module SharedEnums
 * @path packages/core/src/types/enums.ts
 * @description Centralized enums share between Core and TUI.
 * @architectural-layer Shared
 * @related-files [packages/schemas/src/*.ts, packages/core/src/status/*.ts]
 */

export enum GeneralStatus {
  UNKNOWN = "unknown",

  // Basic states
  ACTIVE = "active",
  DELETE = "delete",
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

/** Runner categories per GLOSSARY.md — identifies which Runner component handled an action. */
export enum RunnerKind {
  AGENT_COMPOSER = "agent-composer",
  AGENT_RUNNER = "agent-runner",
  REQUEST_ROUTER = "request-router",
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
 * Known reasons why cached portal knowledge may still be considered valid.
 */
export enum KnowledgeValidityReason {
  SHA_MATCH = "sha_match",
  SHA_MISMATCH = "sha_mismatch",
  NO_GIT = "no_git",
  TIME_TTL = "time_ttl",
  ERROR_FALLBACK = "error_fallback",
}

/**
 * Decision modes used by the portal knowledge invalidation strategy.
 */
export enum KnowledgeAnalysisMode {
  SKIP = "skip",
  INCREMENTAL = "incremental",
  FULL = "full",
}

/**
 * Standard task types used for categorization and routing.
 */
export enum TaskType {
  TEST = "test",
  BUGFIX = "bugfix",
  FEATURE = "feature",
  REFACTOR = "refactor",
  DOCS = "docs",
  ANALYSIS = "analysis",
  INFRA = "infra",
  SECURITY = "security",
  COMMIT = "commit",
  UNKNOWN = "unknown",
}

/**
 * Canonical names for built-in tools.
 */
export enum ToolName {
  READ_FILE = "read_file",
  WRITE_FILE = "write_file",
  LIST_DIRECTORY = "list_directory",
  SEARCH_FILES = "search_files",
  CREATE_DIRECTORY = "create_directory",
  RUN_COMMAND = "run_command",
  FETCH_URL = "fetch_url",
  GREP_SEARCH = "grep_search",
  MOVE_FILE = "move_file",
  COPY_FILE = "copy_file",
  DELETE_FILE = "delete_file",
  GIT_INFO = "git_info",
  DENO_TASK = "deno_task",
  PATCH_FILE = "patch_file",
  GIT_COMMIT = "git_commit",
  GIT_CREATE_BRANCH = "git_create_branch",
  GIT_CHECKOUT = "git_checkout",
  GIT_MERGE = "git_merge",
  GIT_PUSH = "git_push",
  GIT_PULL = "git_pull",
  GIT_STASH = "git_stash",
  QUERY_RELATIONSHIPS = "query_relationships",
  WHO_DEPENDS_ON = "who_depends_on",
  REMEMBER_FACT = "remember_fact",
}

/** Structured error codes for MCP tool-logic failures, shared by MCP handlers and ToolRegistry without creating an import cycle. */
export enum ToolErrorCode {
  PERMISSION_DENIED = "PERMISSION_DENIED",
  NOT_FOUND = "NOT_FOUND",
  PATH_TRAVERSAL = "PATH_TRAVERSAL",
  INVALID_ARGS = "INVALID_ARGS",
  COMMAND_BLOCKED = "COMMAND_BLOCKED",
  EXECUTION_FAILED = "EXECUTION_FAILED",
}

/** The scoring composition mode an eval scenario runs under. Canonical definition for the eval-history storage schema — the Test layer's `ScoringMode` in tests/scenario_framework/runner/scoring.ts shares these exact string values. */
export enum EvalScoringMode {
  ADDITIVE = "additive",
  GATED = "gated",
}

/**
 * Supported runtime and system commands for tool execution.
 */
export enum SystemCommand {
  DENO = "deno",
  GIT = "git",
  NPM = "npm",
  NODE = "node",
  EXACTL = "exactl",
  LS = "ls",
  GREP = "grep",
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
  INSIGHT = "insight",
  ANTI_PATTERN = "anti-pattern",
  TROUBLESHOOTING = "troubleshooting",
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
  /** Google Vertex AI (service-account auth, project-based quotas) */
  VERTEX = "vertex-ai",
  /** OpenRouter unified API gateway to many models */
  OPENROUTER = "openrouter",
  /** Mock provider for testing and development */
  MOCK = "mock",
  /** Local llama.cpp server for running open-source models */
  LLAMACPP = "llamacpp",
  /** Headless Claude Code CLI, subscription-billed (no metered API key) */
  CLAUDE_CLI = "claude-cli",
  /** Headless opencode CLI, subscription/flat-rate billed (no metered API key) */
  OPENCODE_CLI = "opencode-cli",
  /** Headless Codex CLI, subscription-billed via ChatGPT OAuth (no metered API key) */
  CODEX_CLI = "codex-cli",
  /** OpenAI-compatible chat provider (DeepSeek, Together, etc.) via Chat Completions API. */
  OPENAI_CHAT = "openai-chat",
}

/** Chat protocol format for provider request/response serialization. */
export type ChatFormat = "anthropic" | "openai" | "native";

/** Strategy types for the mock provider's simulated responses during testing. */
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

/** Complexity levels for tasks/operations, used to determine processing requirements and resource allocation. */
export enum TaskComplexity {
  /** Basic operations requiring minimal processing */
  SIMPLE = "simple",
  /** Standard operations with moderate complexity */
  MEDIUM = "medium",
  /** Complex operations requiring significant processing */
  COMPLEX = "complex",
  /** Multi-phase or cross-service initiatives */
  EPIC = "epic",
}

/** Pricing tiers for AI services, used for cost categorization and billing levels. */
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

/** Severity levels for security events/alerts, used to prioritize security responses and logging. */
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
 * Sources for request creation.
 */
export enum RequestSource {
  CLI = "cli",
  FILE = "file",
  INTERACTIVE = "interactive",
  TUI = "tui",
  MCP = "mcp",
  TRIGGER = "trigger",
}

/**
 * Disposition outcomes for trigger dispatch results.
 */
export enum TriggerDisposition {
  STARTED = "started",
  RESUMED = "resumed",
  QUEUED = "queued",
  REJECTED = "rejected",
  DEDUPLICATED = "deduplicated",
}

/**
 * Filesystem event kinds emitted by Deno.watchFs — mirrors Deno.FsEvent["kind"].
 */
export enum FilesystemEventKind {
  CREATE = "create",
  MODIFY = "modify",
  REMOVE = "remove",
  ACCESS = "access",
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
  LIST = "list",
  PLAN = "plan",
}

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
 * Memory record statuses.
 */
export enum MemoryRecordStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  ARCHIVED = "archived",
  SUPERSEDED = "superseded",
  DELETED = "deleted",
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
  AGENT_ROLE = "agent_role",
}

/**
 * File change operation types.
 */
export enum FileOperation {
  CREATE = "create",
  MODIFY = "modify",
  DELETE = "delete",
}

export enum McpTransportType {
  STDIO = "stdio",
  SSE = "sse",
}

/**
 * Canonical MCP tool names shared by schema and runtime packages.
 */
export enum McpToolName {
  READ_FILE = "read_file",
  WRITE_FILE = "write_file",
  RUN_COMMAND = "run_command",
  LIST_DIRECTORY = "list_directory",
  SEARCH_FILES = "search_files",
  CREATE_DIRECTORY = "create_directory",
  PATCH_FILE = "patch_file",
  DELETE_FILE = "delete_file",
  MOVE_FILE = "move_file",
  GIT_CREATE_BRANCH = "git_create_branch",
  GIT_COMMIT = "git_commit",
  GIT_STATUS = "git_status",
  GIT_LOG = "git_log",
  GIT_WORKTREE = "git_worktree",
  CREATE_REQUEST = "exaix_create_request",
  LIST_PLANS = "exaix_list_plans",
  APPROVE_PLAN = "exaix_approve_plan",
  QUERY_JOURNAL = "exaix_query_journal",
  // Config tools
  CONFIG_GET = "exaix_config_get",
  CONFIG_SET = "exaix_config_set",
  CONFIG_VALIDATE = "exaix_config_validate",
  CONFIG_DIFF = "exaix_config_diff",
  CONFIG_GET_PROVENANCE = "exaix_config_get_provenance",
  CONFIG_APPLY = "exaix_config_apply",
  PORTAL_SYMBOLS = "exaix_portal_symbols",
}

/**
 * Git status output formats.
 */
export enum GitStatusFormat {
  SHORT = "short",
  PORCELAIN = "porcelain",
  LONG = "long",
}

/**
 * Git log output formats.
 */
export enum GitLogFormat {
  ONELINE = "oneline",
  SHORT = "short",
  FULL = "full",
  FULLER = "fuller",
  CUSTOM = "custom",
}

/**
 * Supported git worktree actions.
 */
export enum GitWorktreeAction {
  ADD = "add",
  LIST = "list",
  REMOVE = "remove",
  PRUNE = "prune",
  LOCK = "lock",
  UNLOCK = "unlock",
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

/** Status states for task and execution lifecycle. */
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
 * Status for skill lifecycle.
 */
export enum SkillStatus {
  DRAFT = GeneralStatus.DRAFT,
  ACTIVE = GeneralStatus.ACTIVE,
  DEPRECATED = GeneralStatus.DEPRECATED,
}

/** Derived lifecycle view for a blueprint. Projected from the `deprecated` frontmatter
 *  flag — the single source of truth consumed by routing/capability matching — rather
 *  than stored independently: `deprecated` when the flag is set, otherwise `active`. */
export enum BlueprintStatus {
  ACTIVE = GeneralStatus.ACTIVE,
  DEPRECATED = GeneralStatus.DEPRECATED,
}

/**
 * Status for dialog lifecycle.
 */
export enum DialogStatus {
  ACTIVE = GeneralStatus.ACTIVE,
  CONFIRMED = GeneralStatus.CONFIRMED,
  CANCELLED = GeneralStatus.CANCELLED,
}

/** Confidence levels for AI-generated content and decisions. */
export enum ConfidenceLevel {
  /** Low confidence in the result */
  LOW = "low",
  /** Moderate confidence in the result */
  MEDIUM = "medium",
  /** High confidence in the result */
  HIGH = "high",
}

/** Granular confidence assessment levels for detailed evaluation. */
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

/** Priority levels for task scheduling and execution — lower numeric values indicate higher priority. */
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

/** Types of findings in code analysis and review results. */
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

/** Severity levels for analysis findings. */
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

/** SQLite journal modes for database configuration. */
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

/** Log levels for system logging configuration. */
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

/** Types of messages for status updates and notifications. */
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
  CONFIGURATION_ERROR = "configuration_error",
}

/**
 * Agent execution strategy names.
 */
export enum ExecutionStrategyName {
  LEGACY = "legacy",
  REACT = "react",
  MCP = "mcp",
  CLI_DELEGATE = "cli_delegate",
}

/**
 * Types of steps in a flow.
 */
export enum FlowStepType {
  AGENT = "agent",
  GATE = "gate",
  BRANCH = "branch",
  /** Deprecated — use VOTING_GROUP instead. In Team builds, CONSENSUS is aliased to
   *  VotingStepHandler; in Solo it falls through to AgentStepHandler and logs a warning. */
  CONSENSUS = "consensus",
  /** Multi-agent voting/consensus — fans out N runners and resolves majority/weighted/llm-judge. */
  VOTING_GROUP = "voting_group",
  /** Sequential per-plan-step session-delegation orchestration. Not an agent strategy. */
  SESSION_DELEGATE_CYCLE = "session_delegate_cycle",
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

/** Voting model slots for voting_group runner configuration. */
export enum VotingModelSlot {
  DEFAULT = "default",
  FAST = "fast",
  LOCAL = "local",
}

/** Voting strategies for multi-agent voting_group steps. */
export enum VotingStrategy {
  MAJORITY = "majority",
  WEIGHTED = "weighted",
  LLM_JUDGE = "llm-judge",
}

/** Source of a matching HITL governance rule. */
export enum HitlRuleSource {
  BLUEPRINT = "blueprint",
  MANDATORY = "mandatory",
}

/** Execution surface where a HITL policy match occurred. */
export enum HitlSurface {
  TOOL_REGISTRY = "tool_registry",
  DYNAMIC = "dynamic",
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

/** Execution mode for a flow step: DECLARED commits tools in the plan before execution
 *  (default); DYNAMIC lets the model select tools from permitted_tools at runtime. */
export enum FlowStepExecutionMode {
  DECLARED = "declared",
  DYNAMIC = "dynamic",
}

/**
 * Recovery actions available when a flow step fails.
 */
export enum FlowStepOnErrorAction {
  RETRY = "retry",
  FALLBACK = "fallback",
  COMPENSATE = "compensate",
  ABORT = "abort",
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
  AGENT = "agent",
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

/** Operations that can be performed on memory bank entries. */
export enum MemoryOperation {
  ADD = "add",
  UPDATE = "update",
  PROMOTE = "promote",
  DEMOTE = "demote",
  ARCHIVE = "archive",
  DELETE = "delete",
  SUPERSEDE = "supersede",
}

/** Consolidation actions the reflection pass may apply to approved learnings. */
export enum MemoryReflectionActionType {
  SYNTHESISE = "synthesise",
  PRUNE = "prune",
}

/** Typed inter-memory link kinds written by the supersession and reflection flows. */
export enum MemoryLinkType {
  SUPERSEDES = "supersedes",
  SUPERSEDED_BY = "superseded_by",
  TOPICAL = "topical",
}

/** Paid operation kinds recorded by the memory cost router. */
export enum MemoryCostOperation {
  EMBEDDING = "embedding",
  EXTRACTION = "extraction",
  CONTRADICTION = "contradiction",
}

/** Extraction implementation selected by the memory cost gate. */
export enum MemoryExtractionMethod {
  HEURISTIC = "heuristic",
  LLM = "llm",
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
 * Capabilities supported by AI providers.
 */
export enum ProviderCapability {
  CHAT = "chat",
  STREAMING = "streaming",
  VISION = "vision",
  TOOLS = "tools",
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
 * Status for requirement fulfillment tracking.
 */
export enum FulfillmentStatus {
  MET = "MET",
  PARTIAL = "PARTIAL",
  MISSING = "MISSING",
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
 * Actions for daemon control.
 */
export enum DaemonAction {
  START = "start",
  STOP = "stop",
  RESTART = "restart",
}

/**
 * ReAct reasoning loop action types
 */
export enum ReActActionType {
  TOOL_CALL = "tool_call",
  COMPLETE = "complete",
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

/**
 * Categories of dependencies identified during portal knowledge gathering.
 */
export enum DependencyCategory {
  WEB_FRAMEWORK = "web framework",
  FULLSTACK_FRAMEWORK = "fullstack framework",
  SCHEMA_VALIDATION = "schema validation",
  TEST_FRAMEWORK = "test framework",
  BUILD_TOOL = "build tool",
  STATE_MANAGEMENT = "state management",
  UI_LIBRARY = "ui library",
  ORM = "orm",
  DATABASE = "database",
  UTILITY = "utility",
  DOCUMENTATION = "documentation",
}

/**
 * Standard JSON-RPC 2.0 error codes.
 */
export enum JsonRpcErrorCode {
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
}

/** Classification of a tool by its exposure kind: mcp_handler is a live MCP tool backed by a
 *  ToolHandler class (portal/file/git tools), mcp_domain is backed by domain logic
 *  (exaix_* tools), internal_only is available only to ToolRegistry / agent strategies. */
export enum ToolKind {
  MCP_HANDLER = "mcp_handler",
  MCP_DOMAIN = "mcp_domain",
  INTERNAL_ONLY = "internal_only",
}

/**
 * Functional category of a tool for classification and routing.
 */
export enum ToolCategory {
  READ = "read",
  WRITE = "write",
  GIT = "git",
  DOMAIN = "domain",
  NETWORK = "network",
  META = "meta",
}

/** Scope of side effects a tool may produce; used by dynamic executors and agent
 *  strategies for safe-execution decisions. */
export enum ToolSideEffectScope {
  NONE = "none",
  PORTAL = "portal",
  GIT = "git",
  NETWORK = "network",
  SYSTEM = "system",
}

/**
 * Action to take when a HITL amendment request times out.
 */
export enum AmendmentTimeoutAction {
  ABORT = "abort",
  REJECT = "reject",
  APPROVE = "approve",
}

/** Storage tier for memory operations: LOCAL is free (keyword/HNSW over local JSON
 *  files), REMOTE incurs cost (embedding API calls, remote DB). */
export enum MemoryStorageTier {
  LOCAL = "local",
  REMOTE = "remote",
}

/** Tokenizer backend selection for prompt budget estimation: AUTO uses ai-token-estimator
 *  locally, LOCAL forces local-only, API permits provider-native tokenizer calls. */
export enum TokenizerBackend {
  AUTO = "auto",
  LOCAL = "local",
  API = "api",
}

/** Memory tier for hierarchical memory promotion: WORKING is newly created learnings
 *  during execution; EPISODIC is promoted after meeting the promotion threshold
 *  (retained across sessions); SEMANTIC is promoted after repeated access (never auto-demoted). */
export enum MemoryTier {
  WORKING = "working",
  EPISODIC = "episodic",
  SEMANTIC = "semantic",
}

/**
 * Sources for license detection results.
 */
export enum LicenseSource {
  FILE = "file",
  PACKAGE = "package",
  SPDX = "spdx",
}

/**
 * Vulnerability scanner types.
 */
export enum ScannerType {
  DENO_AUDIT = "deno_audit",
  NPM_AUDIT = "npm_audit",
  NONE = "none",
}

/**
 * Test detection kinds for portal knowledge analysis.
 */
export enum TestDetectionKind {
  EXECUTED = "executed",
  INFERRED = "inferred",
  NONE = "none",
}

// Step Execution Durability Enums

/** Disposition of a step execution record: executed normally, replayed, skipped because a
 *  prior identical execution was reused, or invalidated. */
export enum StepExecutionDisposition {
  EXECUTED = "executed",
  REPLAYED = "replayed",
  SKIPPED_BY_REUSE = "skipped_by_reuse",
  INVALIDATED = "invalidated",
}

/**
 * Side-effect class used for replay-eligibility heuristics.
 */
export enum StepSideEffectClass {
  NONE = "none",
  LLM = "llm",
  TOOL = "tool",
  GIT = "git",
  MIXED = "mixed",
}

/**
 * Attempt classification for step execution.
 */
export enum StepAttemptClass {
  INITIAL = "initial",
  RETRY = "retry",
  RESUME = "resume",
  REPLAY = "replay",
}

/**
 * Types of values that can be stored in the config registry.
 */
export enum ConfigValueType {
  STRING = "string",
  NUMBER = "number",
  BOOLEAN = "boolean",
  OBJECT = "object",
  ARRAY = "array",
}

/**
 * Whether a config change applies immediately or requires a restart.
 */
export enum SwapClass {
  HOT = "hot",
  RESTART = "restart",
}

/**
 * Provenance source for a config value — where it was resolved from.
 */
export enum ConfigProvenanceSource {
  DB = "db",
  REGISTRY = "registry",
  SCHEMA_DEFAULT = "schema_default",
  BOOTSTRAP = "bootstrap",
}

/**
 * Operating mode of a config adapter.
 */
export enum ConfigAdapterMode {
  DIRECT = "direct",
  DAEMON = "daemon",
}

/**
 * Output format for config CLI commands.
 */
export enum ConfigOutputFormat {
  HUMAN = "human",
  JSON = "json",
}

/** How a scoped context item's score was computed: portal retrieval uses raw HNSW
 *  cosine similarity; memory retrieval uses the existing post-fusion/tier relevance. */
export enum ContextItemScoreKind {
  COSINE = "cosine",
  HYBRID = "hybrid",
}

/** Outcome of a scoped context query — whether real, provenance-labelled items were
 *  found or the source was unavailable (see {@link ContextUnavailableReason}). */
export enum ContextResultStatus {
  OK = "ok",
  UNAVAILABLE = "unavailable",
}

/** Why a scoped context source returned no items — from never-configured (DISABLED) to
 *  a real search that found nothing (NO_HITS) or fit no candidate in budget (BUDGET_DENIED). */
export enum ContextUnavailableReason {
  DISABLED = "disabled",
  COLD = "cold",
  STALE = "stale",
  NO_HITS = "no_hits",
  TIMEOUT = "timeout",
  BUDGET_DENIED = "budget_denied",
  PROVIDER_ERROR = "provider_error",
}

/** Why a dogfood context connection/port was closed. */
export enum ContextConnectionCloseReason {
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}
