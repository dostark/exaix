/**
 * @module SharedConstants
 * @path packages/core/src/types/constants.ts
 * @description Centralized registry of system-wide constants shared between Core and TUI.
 * @architectural-layer Shared
 * @related-files ["packages/core/src/types/enums.ts", "packages/schemas/src/config.ts"]
 */

import {
  AmendmentTimeoutAction,
  ConfigValueType,
  LogLevel,
  McpTransportType,
  MockStrategy,
  ProviderType,
  RequestPriority,
  SwapClass,
  TaskType,
} from "./enums.ts";
import { configurable } from "../config/registry.ts";

// ============================================================================
// HTTP Status Codes
// ============================================================================
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_SERVER_ERROR = 500;

// ============================================================================
// Edition Constants
// ============================================================================
export const EDITION_SOLO = "solo";
export const EDITION_TEAM = "team";
export const EDITION_ENTERPRISE = "enterprise";

// ============================================================================
// Guardrail (Phase 107)
// ============================================================================
/** Maximum time (ms) to wait for a guardrail policy evaluation before timing out. */
export const GUARDRAIL_SCREEN_TIMEOUT_MS: number = configurable({
  key: "guardrail.screen_timeout_ms",
  default: 10_000,
  type: ConfigValueType.NUMBER,
  description: "Maximum time in milliseconds to wait for guardrail policy evaluation",
  min: 100,
  max: 60_000,
  swap: SwapClass.RESTART,
});

/** Maximum characters to include in the flagged_excerpt field of a GuardrailIncident. */
export const GUARDRAIL_FLAGGED_EXCERPT_MAX_CHARS = 500;

// ============================================================================
// HITL / Governance (Phase 118)
// ============================================================================
/** Maximum time (ms) for a HitlPolicyEvaluator.evaluate() call to stay within. */
export const HITL_EVAL_BUDGET_MS: number = configurable({
  key: "hitl.eval_budget_ms",
  default: 5,
  type: ConfigValueType.NUMBER,
  description: "Maximum time in milliseconds for HITL policy evaluation",
  min: 1,
  max: 1000,
  swap: SwapClass.RESTART,
});

// ============================================================================
// Path Configuration Defaults
// ============================================================================
export const DEFAULT_WORKSPACE_PATH = "Workspace";
export const DEFAULT_RUNTIME_PATH = ".exa";
export const DEFAULT_MEMORY_PATH = "Memory";
export const DEFAULT_PORTALS_PATH = "Portals";
export const DEFAULT_PORTAL_DEFAULT_BRANCH = "main";
export const DEFAULT_BLUEPRINTS_PATH = "Blueprints";
export const DEFAULT_ACTIVE_PATH = "Active";
export const DEFAULT_ARCHIVE_PATH = "Archive";
export const DEFAULT_PLANS_PATH = "Plans";
export const DEFAULT_REQUESTS_PATH = "Requests";
export const DEFAULT_REJECTED_PATH = "Rejected";

// Subfolder Defaults (relative to their parent domain)
export const DEFAULT_IDENTITIES_PATH = "Identities";
export const DEFAULT_FLOWS_PATH = "Flows";
export const DEFAULT_WAIT_STATES_PATH = "WaitStates";
export const DEFAULT_PROJECTS_MEMORY_PATH = "Projects";
export const DEFAULT_EXECUTION_MEMORY_PATH = "Execution";
export const DEFAULT_INDEX_MEMORY_PATH = "Index";
export const DEFAULT_SKILLS_MEMORY_PATH = "Skills";
export const DEFAULT_PENDING_MEMORY_PATH = "Pending";
export const DEFAULT_TASKS_MEMORY_PATH = "Tasks";
export const DEFAULT_GLOBAL_MEMORY_PATH = "Global";

export const ExaPathDefaults = {
  workspace: DEFAULT_WORKSPACE_PATH,
  runtime: DEFAULT_RUNTIME_PATH,
  memory: DEFAULT_MEMORY_PATH,
  portals: DEFAULT_PORTALS_PATH,
  blueprints: DEFAULT_BLUEPRINTS_PATH,
  flows: `${DEFAULT_BLUEPRINTS_PATH}/${DEFAULT_FLOWS_PATH}`,
  waitStates: DEFAULT_WAIT_STATES_PATH,
  requests: DEFAULT_REQUESTS_PATH,
  plans: DEFAULT_PLANS_PATH,
  active: DEFAULT_ACTIVE_PATH,
  archive: DEFAULT_ARCHIVE_PATH,
  rejected: DEFAULT_REJECTED_PATH,
  identities: DEFAULT_IDENTITIES_PATH,
  memoryProjects: `${DEFAULT_MEMORY_PATH}/${DEFAULT_PROJECTS_MEMORY_PATH}`,
  memoryExecution: `${DEFAULT_MEMORY_PATH}/${DEFAULT_EXECUTION_MEMORY_PATH}`,
  memoryIndex: `${DEFAULT_MEMORY_PATH}/${DEFAULT_INDEX_MEMORY_PATH}`,
  memorySkills: `${DEFAULT_MEMORY_PATH}/${DEFAULT_SKILLS_MEMORY_PATH}`,
  memoryPending: `${DEFAULT_MEMORY_PATH}/${DEFAULT_PENDING_MEMORY_PATH}`,
  memoryTasks: `${DEFAULT_MEMORY_PATH}/${DEFAULT_TASKS_MEMORY_PATH}`,
  memoryGlobal: `${DEFAULT_MEMORY_PATH}/${DEFAULT_GLOBAL_MEMORY_PATH}`,
} as const;

// Plan amendment constants (Phase 66)
export const AMENDMENT_ARTIFACTS_DIR = "amendments";
export const DEFAULT_AMENDMENT_EXPIRY_MS: number = configurable({
  key: "amendment.expiry_ms",
  default: 86_400_000,
  type: ConfigValueType.NUMBER,
  description: "Time-to-live in milliseconds for plan amendments",
  min: 60_000,
  max: 7_776_000_000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_AMENDMENT_THRESHOLD: number = configurable({
  key: "amendment.threshold",
  default: 60,
  type: ConfigValueType.NUMBER,
  description: "Minimum confidence score for auto-approved amendments (0-100)",
  min: 0,
  max: 100,
  swap: SwapClass.RESTART,
});
export const DEFAULT_AMENDMENT_HITL_TIMEOUT_MS: number = configurable({
  key: "amendment.hitl_timeout_ms",
  default: 300_000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for HITL amendment approval",
  min: 10_000,
  max: 3_600_000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_AMENDMENT_ON_TIMEOUT: AmendmentTimeoutAction = configurable({
  key: "amendment.on_timeout",
  default: AmendmentTimeoutAction.ABORT as AmendmentTimeoutAction,
  type: ConfigValueType.STRING,
  description: "Action when amendment review times out (abort, approve, reject)",
  enum: Object.values(AmendmentTimeoutAction) as readonly string[],
  swap: SwapClass.RESTART,
});

// Live execution streaming constants (Phase 67)
export const STREAMING_EVENT_HEARTBEAT = "agent.heartbeat";
export const STREAMING_EVENT_TOOL_START = "tool.start";
export const STREAMING_EVENT_TOOL_END = "tool.end";
export const STREAMING_EVENT_LLM_STREAM = "llm.stream";
export const STREAMING_EVENT_FLOW_STATUS = "flow.status";
export const STREAMING_EVENT_MILESTONE = "milestone";
export const EXECUTION_HEARTBEAT_INTERVAL_MS: number = configurable({
  key: "execution.heartbeat_interval_ms",
  default: 5000,
  type: ConfigValueType.NUMBER,
  description: "Interval in milliseconds between execution heartbeat events",
  min: 100,
  max: 60_000,
  swap: SwapClass.HOT,
});
export const EVENT_BUS_MAX_SUBSCRIBER_QUEUE: number = configurable({
  key: "execution.event_bus_max_queue",
  default: 1000,
  type: ConfigValueType.NUMBER,
  description: "Maximum subscriber queue size before backpressure drops events",
  min: 10,
  max: 100_000,
  swap: SwapClass.RESTART,
});

// Milestone type constants (Phase 92)
export const MILESTONE_FLOW_STARTED = "flow.started";
export const MILESTONE_FLOW_STEP_STARTED = "flow.step.started";
export const MILESTONE_FLOW_STEP_COMPLETED = "flow.step.completed";
export const MILESTONE_FLOW_STEP_REPLAYED = "flow.step.replayed";
export const MILESTONE_FLOW_STEP_SKIPPED = "flow.step.skipped";
export const MILESTONE_LLM_CALL_STARTED = "llm.call.started";
export const MILESTONE_LLM_CALL_COMPLETED = "llm.call.completed";
export const MILESTONE_TOOL_CALL_STARTED = "tool.call.started";
export const MILESTONE_TOOL_CALL_COMPLETED = "tool.call.completed";
export const MILESTONE_CONTEXT_COMPACTION_APPLIED = "context.compaction.applied";
export const MILESTONE_APPROVAL_GATE_ENTERED = "approval.gate.entered";
export const MILESTONE_APPROVAL_GATE_RESOLVED = "approval.gate.resolved";
export const MILESTONE_CHILD_RUN_SPAWNED = "child_run.spawned";
export const MILESTONE_CHILD_RUN_COMPLETED = "child_run.completed";
export const MILESTONE_RESOURCE_LOCK_WAITING = "resource_lock.waiting";
export const MILESTONE_RESOURCE_LOCK_ACQUIRED = "resource_lock.acquired";
export const MILESTONE_FLOW_COMPLETED = "flow.completed";
export const MILESTONE_FLOW_FAILED = "flow.failed";

/** Activity-journal event logged by dynamic_step_executor.ts for every tool call decision. */
export const ACTIVITY_EVENT_DYNAMIC_TOOL_CALL = "dynamic_tool_call";

// ============================================================================
// Database Validation Limits
// ============================================================================

// Database defaults
export const DEFAULT_DATABASE_BATCH_FLUSH_MS: number = configurable({
  key: "database.batch_flush_ms",
  default: 1000,
  type: ConfigValueType.NUMBER,
  description: "Interval in milliseconds for flushing batched DB writes",
  min: 10,
  max: 10000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_DATABASE_BATCH_MAX_SIZE: number = configurable({
  key: "database.batch_max_size",
  default: 100,
  type: ConfigValueType.NUMBER,
  description: "Maximum number of operations per batch flush",
  min: 1,
  max: 1000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_DATABASE_JOURNAL_MODE: string = configurable({
  key: "database.journal_mode",
  default: "WAL",
  type: ConfigValueType.STRING,
  description: "SQLite journal mode (WAL, DELETE, MEMORY)",
  swap: SwapClass.RESTART,
});
export const DEFAULT_DATABASE_FOREIGN_KEYS: boolean = configurable({
  key: "database.foreign_keys",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether SQLite foreign key enforcement is enabled",
  swap: SwapClass.RESTART,
});
export const DEFAULT_DATABASE_BUSY_TIMEOUT_MS: number = configurable({
  key: "database.busy_timeout_ms",
  default: 5000,
  type: ConfigValueType.NUMBER,
  description: "Default SQLite busy timeout in milliseconds",
  min: 0,
  max: 30000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_DATABASE_FAILURE_THRESHOLD: number = configurable({
  key: "database.failure_threshold",
  default: 5,
  type: ConfigValueType.NUMBER,
  description: "Number of failures before circuit breaker opens",
  min: 1,
  max: 100,
  swap: SwapClass.RESTART,
});
export const DEFAULT_DATABASE_RESET_TIMEOUT_MS: number = configurable({
  key: "database.reset_timeout_ms",
  default: 60000,
  type: ConfigValueType.NUMBER,
  description: "Time in milliseconds before circuit breaker resets",
  min: 1000,
  max: 300000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_DATABASE_HALF_OPEN_SUCCESS_THRESHOLD: number = configurable({
  key: "database.half_open_success_threshold",
  default: 2,
  type: ConfigValueType.NUMBER,
  description: "Successful probes needed to close circuit breaker",
  min: 1,
  max: 10,
  swap: SwapClass.RESTART,
});

// ============================================================================
// Config DB — polling and dynamic key namespaces
// ============================================================================
/**
 * Polling interval (ms) for the Config DB watcher that detects external
 * overrides via MAX(id) change. Used in the daemon's polling loop.
 */
export const DEFAULT_CONFIG_DB_POLL_INTERVAL_MS: number = configurable({
  key: "config_db.poll_interval_ms",
  default: 5_000,
  type: ConfigValueType.NUMBER,
  description: "Polling interval in milliseconds for Config DB change detection",
  min: 100,
  max: 60_000,
  swap: SwapClass.HOT,
});
/**
 * Key prefix for profile-scoped config keys (`profile.<name>.<base>`). A key
 * under this prefix validates against its stripped base key's registry metadata
 * rather than requiring its own `configurable()` registration. Used by
 * DirectConfigAdapter.resolveValidationKey().
 */
export const CONFIG_PROFILE_KEY_PREFIX = "profile.";
/**
 * Wildcard segment used in `configurable()` pattern keys (e.g. `models.*.model`,
 * `paths.*`). A concrete key like `models.default.model` validates against the
 * matching pattern key's metadata.
 */
export const CONFIG_PATTERN_WILDCARD = "*";

// ============================================================================
// Config Rate Limiting (Phase 138 Step 3)
// ============================================================================

/** Sliding window (ms) over which CLI `config set` writes are counted. */
export const CLI_CONFIG_SET_DEBOUNCE_WINDOW_MS = 5_000;
/** Max CLI `config set` writes permitted within the debounce window. */
export const CLI_CONFIG_SET_MAX_WRITES_PER_WINDOW = 10;
/** Max pending (staged, un-applied) MCP config changes per session. */
export const MCP_CONFIG_SET_MAX_PENDING = 50;
/** config_overrides row count at which a warning is logged. */
export const CONFIG_DB_OVERRIDE_WARN_THRESHOLD = 100_000;
/** config_overrides row count at which non-recovery writes are hard-blocked. */
export const CONFIG_DB_OVERRIDE_HARD_LIMIT = 1_000_000;

// ============================================================================
// Config Integrity Checksum (Phase 139 Step 5, §11.7)
// ============================================================================

/**
 * Synthetic config_overrides key under which the Config-DB integrity checksum is
 * stored. Excluded from the checksum computation, from listOverrides/diff, and
 * from the DB watcher so it never surfaces as a user override.
 */
export const CONFIG_CHECKSUM_KEY = "_checksum";
/**
 * How often (ms) the daemon re-verifies the Config-DB integrity checksum on its
 * existing DB-watcher poll loop (§11.7 "every 60s"). Tunable via
 * `exactl config set config.integrity.poll_interval_ms`.
 */
export const CONFIG_INTEGRITY_POLL_INTERVAL_MS: number = configurable({
  key: "config.integrity.poll_interval_ms",
  default: 60_000,
  type: ConfigValueType.NUMBER,
  description: "Interval (ms) between daemon Config-DB integrity checksum verifications",
  min: 1_000,
  max: 3_600_000,
  swap: SwapClass.RESTART,
});

// ============================================================================
// File Watcher Validation Limits
// ============================================================================

// Watcher defaults
export const DEFAULT_WATCHER_DEBOUNCE_MS: number = configurable({
  key: "watcher.debounce_ms",
  default: 200,
  type: ConfigValueType.NUMBER,
  description: "Debounce interval in milliseconds for file watcher events",
  min: 50,
  max: 5000,
  swap: SwapClass.HOT,
});
export const DEFAULT_WATCHER_STABILITY_CHECK: boolean = configurable({
  key: "watcher.stability_check",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether to wait for file stability before processing change events",
  swap: SwapClass.HOT,
});
export const DEFAULT_WATCHER_STABILITY_BACKOFF_MS = [50, 100, 200, 500, 1000];
export const DEFAULT_WATCHER_STABILITY_MAX_ATTEMPTS: number = configurable({
  key: "watcher.stability_max_attempts",
  default: 5,
  type: ConfigValueType.NUMBER,
  description: "Maximum stability check attempts for a changed file",
  min: 1,
  max: 20,
  swap: SwapClass.HOT,
});
export const DEFAULT_WATCHER_STABILITY_MIN_FILE_SIZE: number = configurable({
  key: "watcher.stability_min_file_size",
  default: 1,
  type: ConfigValueType.NUMBER,
  description: "Minimum file size in bytes to consider a file stable",
  min: 1,
  max: 1_000_000,
  swap: SwapClass.HOT,
});

// ============================================================================

// ============================================================================
// Session Delegate (Phase 111/123)
// ============================================================================
/** Maximum time (ms) to drain a headless delegate's stdout stream. */
export const DELEGATE_STDOUT_DRAIN_MS: number = configurable({
  key: "delegate.stdout_drain_ms",
  default: 5_000,
  type: ConfigValueType.NUMBER,
  description: "Maximum time in milliseconds to drain a headless delegate's stdout stream",
  min: 100,
  max: 300_000,
  swap: SwapClass.RESTART,
});

// ============================================================================
// Service Limits and Batch Sizes
// ============================================================================
export const DEFAULT_LOG_BUFFER_SIZE: number = configurable({
  key: "logging.buffer_size",
  default: 10000,
  type: ConfigValueType.NUMBER,
  description: "Maximum number of log entries held in the in-memory buffer",
  min: 100,
  max: 1_000_000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_COST_PRECISION_FACTOR: number = configurable({
  key: "cost_tracking.precision_factor",
  default: 10000,
  type: ConfigValueType.NUMBER,
  description: "Decimal precision factor for cost rounding calculations",
  min: 1,
  max: 1000000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_TITLE_PLACEHOLDER = "Untitled";
export const DEFAULT_NONE_LABEL = "None";
export const DEFAULT_NONE_VALUE = "none";
export const DEFAULT_DESCRIPTION_PLACEHOLDER = "(no description)";

// Agent Validation Limits
// ============================================================================
export const AGENT_MAX_ITERATIONS_MIN = 1;
export const AGENT_MAX_ITERATIONS_MAX = 100;

// Agent defaults
export const DEFAULT_AGENT_MODEL = "default";
export const DEFAULT_IDENTITY_ID = "default";
export const DEFAULT_UNKNOWN_LABEL = "Unknown";
export const DEFAULT_UNKNOWN_ERROR_MESSAGE = "Unknown error";
export const DEFAULT_AGENT_TIMEOUT_SEC: number = configurable({
  key: "agent.timeout_sec",
  default: 60,
  type: ConfigValueType.NUMBER,
  description: "Default agent execution timeout in seconds",
  min: 1,
  max: 300,
  swap: SwapClass.RESTART,
});
export const DEFAULT_AGENT_MAX_ITERATIONS: number = configurable({
  key: "agent.max_iterations",
  default: 10,
  type: ConfigValueType.NUMBER,
  description: "Maximum iterations per agent execution",
  min: AGENT_MAX_ITERATIONS_MIN,
  max: AGENT_MAX_ITERATIONS_MAX,
  swap: SwapClass.RESTART,
});
export const DEFAULT_REFLEXIVE_CONVERGENCE_QUALITY_EXIT_THRESHOLD: number = configurable({
  key: "agent.convergence_quality_exit_threshold",
  default: 85,
  type: ConfigValueType.NUMBER,
  description: "Quality score threshold (0-100) for early convergence exit",
  min: 0,
  max: 100,
  swap: SwapClass.RESTART,
});
export const DEFAULT_REFLEXIVE_CONVERGENCE_MIN_IMPROVEMENT_DELTA = 3;
export const DEFAULT_REFLEXIVE_CONVERGENCE_OSCILLATION_WINDOW: number = configurable({
  key: "agent.convergence_oscillation_window",
  default: 2,
  type: ConfigValueType.NUMBER,
  description: "Number of iterations to detect oscillation in convergence",
  min: 1,
  max: 10,
  swap: SwapClass.RESTART,
});
export const DEFAULT_REFLEXIVE_CONVERGENCE_ABSOLUTE_MAX_ITERATIONS = 12;
export const DEFAULT_REFLEXIVE_CONVERGENCE_SCORE_EVERY_N_ITERATIONS: number = configurable({
  key: "agent.convergence_score_interval",
  default: 1,
  type: ConfigValueType.NUMBER,
  description: "Score convergence quality every N iterations",
  min: 1,
  max: 10,
  swap: SwapClass.RESTART,
});

// Agent event names
export const AGENT_EVENT_EXECUTION_STARTED = "agent.execution_started";
export const AGENT_EVENT_EXECUTION_COMPLETED = "agent.execution_completed";
export const AGENT_EVENT_EXECUTION_FAILED = "agent.execution_failed";
export const AGENT_EVENT_OUTPUT = "agent.output";
export const AGENT_EVENT_SECURITY_VIOLATION = "security.violation";
export const AGENT_GENERATION_COMPLETED = "agent.generation_completed";
export const AGENT_EVENT_PROMPT_ASSEMBLED = "agent.prompt_assembled";
/** Debug-level: the full assembled prompt text, for diagnosing live-provider response issues. */
export const AGENT_EVENT_PROMPT_DEBUG_DUMP = "agent.prompt_debug_dump";
/** Debug-level: the raw LLM response as received, before thought/content extraction. */
export const AGENT_EVENT_LLM_RESPONSE_RECEIVED = "agent.llm_response_received";
/** Debug-level: the exact outbound JSON request body sent to a model provider's API. */
export const PROVIDER_EVENT_REQUEST_DEBUG_DUMP = "provider.request_debug_dump";
/** Debug-level: the complete raw JSON response body from a model provider's API, before extraction. */
export const PROVIDER_EVENT_RESPONSE_DEBUG_DUMP = "provider.response_debug_dump";
/** Warn-level: the provider reported the response was truncated (stop_reason max_tokens). */
export const AGENT_EVENT_RESPONSE_TRUNCATED = "agent.response_truncated";
/** Warn-level: a ReAct action's TOML block failed to parse and the action was dropped. */
export const REACT_EVENT_ACTION_PARSE_FAILED = "agent.react_action_parse_failed";
/** Anthropic stop_reason value meaning the generation hit max_tokens and was truncated. */
export const RESPONSE_STOP_REASON_MAX_TOKENS = "max_tokens";

export const AGENT_EXECUTOR_ID = "agent-executor";
// Plan amendment event names (Phase 66)
export const PLAN_AMENDMENT_EVENT_PROPOSED = "plan.amendment.proposed";
export const PLAN_AMENDMENT_EVENT_AWAITING_APPROVAL = "plan.amendment.awaiting_approval";
export const PLAN_AMENDMENT_EVENT_APPROVED = "plan.amendment.approved";
export const PLAN_AMENDMENT_EVENT_REJECTED = "plan.amendment.rejected";
export const PLAN_AMENDMENT_EVENT_EXPIRED = "plan.amendment.expired";
export const PLAN_AMENDMENT_EVENT_APPLIED = "plan.amendment.applied";

// Skill event names (Phase 70)
export const SKILL_EVENT_MATCH_COMPLETED = "skills.match_completed";
export const SKILL_EVENT_RETRIEVAL_TIMEOUT = "skills.retrieval_timeout";
export const SKILL_EVENT_RETRIEVAL_FAILED = "skills.retrieval_failed";
export const MEMORY_EVENT_AUTO_APPROVED = "memory.auto_approved";
export const MEMORY_EVENT_TIER_SELECTED = "memory.tier_selected";
export const MEMORY_MIN_VECTORS_FOR_LOCAL_SEARCH: number = configurable({
  key: "memory.min_vectors_local_search",
  default: 5,
  type: ConfigValueType.NUMBER,
  description: "Minimum vectors required to perform local memory search",
  min: 1,
  max: 1000,
  swap: SwapClass.RESTART,
});

/** Example execution time used in AgentOrchestrator response-shape examples. */
export const AGENT_EXECUTION_EXAMPLE_TIME_MS: number = configurable({
  key: "agent.execution_example_time_ms",
  default: 2_000,
  type: ConfigValueType.NUMBER,
  description: "Example execution time in milliseconds for response-shape examples",
  min: 100,
  max: 60_000,
  swap: SwapClass.RESTART,
});

// ReAct loop constants
export const REACT_THOUGHT_PREFIX = "THOUGHT: ";
export const REACT_STATUS_COMPLETE = "STATUS: COMPLETE";
export const REACT_SUMMARY_PREFIX = "SUMMARY: ";
export const REACT_CALLING_TOOL_PREFIX = "CALLING TOOL: ";
export const REACT_TOOL_ERROR_PREFIX = "TOOL ERROR: ";
/** Max chars of a serialized tool result kept in the dynamic_tool_call journal summary. */
export const REACT_TOOL_RESULT_SUMMARY_MAX = 200;
export const REACT_DEFAULT_TEMPERATURE: number = configurable({
  key: "react.temperature",
  default: 0.1,
  type: ConfigValueType.NUMBER,
  description: "Default temperature for ReAct loop LLM calls",
  min: 0,
  max: 2,
  swap: SwapClass.RESTART,
});
export const REACT_DEFAULT_MAX_TOKENS: number = configurable({
  key: "react.max_tokens",
  default: 8192,
  type: ConfigValueType.NUMBER,
  description: "Default maximum tokens for ReAct loop LLM calls",
  min: 100,
  max: 100_000,
  swap: SwapClass.RESTART,
});

// General Agent & MCP constants
export const DEFAULT_AGENT_HANDSHAKE_TIMEOUT_MS: number = configurable({
  key: "agent.handshake_timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for agent handshake with child processes",
  min: 1000,
  max: 300000,
  swap: SwapClass.RESTART,
});
export const PORTAL_ALIAS_WORKSPACE = "workspace";

// Environment variables for MCP agents
export const ENV_AGENT_MODE = "EXA_AGENT_MODE";
export const ENV_TRACE_ID = "EXA_TRACE_ID";
export const ENV_PORTAL_ALIAS = "EXA_PORTAL";

// MCP content types
export const MCP_CONTENT_TYPE_STRUCTURED_DATA = "exaix_structured_data";

// ============================================================================
// AI Provider Defaults and Limits
// ============================================================================
export const DEFAULT_AI_TIMEOUT_MS: number = configurable({
  key: "ai.timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Default AI provider request timeout in milliseconds",
  min: 1000,
  max: 300_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_AI_RETRY_MAX_ATTEMPTS: number = configurable({
  key: "ai.retry.max_attempts",
  default: 3,
  type: ConfigValueType.NUMBER,
  description: "Maximum retry attempts for AI provider requests",
  min: 1,
  max: 10,
  swap: SwapClass.HOT,
});
export const DEFAULT_AI_RETRY_BACKOFF_BASE_MS: number = configurable({
  key: "ai.retry.backoff_base_ms",
  default: 1000,
  type: ConfigValueType.NUMBER,
  description: "Base backoff delay in milliseconds for AI retries",
  min: 100,
  max: 10_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_AI_RETRY_TIMEOUT_PER_REQUEST_MS: number = configurable({
  key: "ai.retry.timeout_per_request_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Per-request timeout in milliseconds for AI retries",
  min: 1000,
  max: 300_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_AI_MODEL: string = configurable({
  key: "ai.model",
  default: "gemini-flash-latest",
  type: ConfigValueType.STRING,
  description: "Default AI model identifier",
  swap: SwapClass.RESTART,
});
// Convenience keys for Step 7 commands
configurable({
  key: "ai.provider",
  default: "google",
  type: ConfigValueType.STRING,
  description: "Active AI provider",
  enum: Object.values(ProviderType) as readonly string[],
  swap: SwapClass.RESTART,
});
configurable({
  key: "system.active_profile",
  default: "",
  type: ConfigValueType.STRING,
  description: "Active profile name for profile-scoped config resolution",
  swap: SwapClass.RESTART,
});
configurable({
  key: "models.*.model",
  default: "",
  type: ConfigValueType.STRING,
  description: "Per-name model override pattern (models.<name>.model)",
  swap: SwapClass.RESTART,
});
configurable({
  key: "paths.*",
  default: "",
  type: ConfigValueType.STRING,
  description: "Per-key path pattern (paths.<key>)",
  swap: SwapClass.RESTART,
});
export const DEFAULT_AI_TEMPERATURE_MIN: number = configurable({
  key: "ai.temperature_min",
  default: 0,
  type: ConfigValueType.NUMBER,
  description: "Minimum allowed temperature for AI provider requests",
  min: 0,
  max: 2,
  swap: SwapClass.RESTART,
});
export const DEFAULT_AI_TEMPERATURE_MAX: number = configurable({
  key: "ai.temperature_max",
  default: 2,
  type: ConfigValueType.NUMBER,
  description: "Maximum allowed temperature for AI provider requests",
  min: 0,
  max: 5,
  swap: SwapClass.RESTART,
});
export const MOCK_DELAY_MS: number = configurable({
  key: "mock.delay_ms",
  default: 100,
  type: ConfigValueType.NUMBER,
  description: "Simulated delay in milliseconds for mock provider responses",
  min: 0,
  max: 5000,
  swap: SwapClass.HOT,
});
export const MOCK_INPUT_TOKENS: number = configurable({
  key: "mock.input_tokens",
  default: 100,
  type: ConfigValueType.NUMBER,
  description: "Simulated input token count for mock provider billing",
  min: 1,
  max: 10000,
  swap: SwapClass.HOT,
});
export const MOCK_OUTPUT_TOKENS: number = configurable({
  key: "mock.output_tokens",
  default: 200,
  type: ConfigValueType.NUMBER,
  description: "Simulated output token count for mock provider billing",
  min: 1,
  max: 10000,
  swap: SwapClass.HOT,
});
export const DEFAULT_MOCK_MODEL: string = configurable({
  key: "mock.model",
  default: "mock-model",
  type: ConfigValueType.STRING,
  description: "Model identifier used in mock provider responses",
  swap: SwapClass.RESTART,
});
export const DEFAULT_MOCK_STRATEGY = MockStrategy.RECORDED;
export const DEFAULT_FAST_MODEL_NAME: string = configurable({
  key: "ai.fast_model",
  default: "gemini-flash-latest",
  type: ConfigValueType.STRING,
  description: "Model name used for fast inference provider requests",
  swap: SwapClass.RESTART,
});
export const DEFAULT_LOCAL_MODEL_NAME: string = configurable({
  key: "ai.local_model",
  default: "llama3.2",
  type: ConfigValueType.STRING,
  description: "Model name used for local/self-hosted provider requests",
  swap: SwapClass.RESTART,
});
export const PROVIDER_MOCK = ProviderType.MOCK;
export const PROVIDER_OLLAMA = ProviderType.OLLAMA;
export const PROVIDER_OPENAI = ProviderType.OPENAI;
export const PROVIDER_ANTHROPIC = ProviderType.ANTHROPIC;
export const PROVIDER_GOOGLE = ProviderType.GOOGLE;
export const PROVIDER_VERTEX = ProviderType.VERTEX;
export const PROVIDER_OPENROUTER = ProviderType.OPENROUTER;

// ============================================================================
// UI/Preview Validation Limits
// ============================================================================
export const PROMPT_PREVIEW_LENGTH_MIN = 10;
export const PROMPT_PREVIEW_LENGTH_MAX = 500;
export const PROMPT_PREVIEW_EXTENDED_MIN = 50;
export const PROMPT_PREVIEW_EXTENDED_MAX = 1000;

// UI defaults
export const PROMPT_PREVIEW_LENGTH: number = configurable({
  key: "ui.prompt_preview_length",
  default: 100,
  type: ConfigValueType.NUMBER,
  description: "Default prompt preview length in characters",
  min: PROMPT_PREVIEW_LENGTH_MIN,
  max: PROMPT_PREVIEW_LENGTH_MAX,
  swap: SwapClass.RESTART,
});
export const PROMPT_PREVIEW_EXTENDED: number = configurable({
  key: "ui.prompt_preview_extended",
  default: 500,
  type: ConfigValueType.NUMBER,
  description: "Extended prompt preview length in characters",
  min: PROMPT_PREVIEW_EXTENDED_MIN,
  max: PROMPT_PREVIEW_EXTENDED_MAX,
  swap: SwapClass.RESTART,
});

// ============================================================================
// MCP Defaults
// ============================================================================
export const DEFAULT_MCP_ENABLED: boolean = configurable({
  key: "mcp.enabled",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether the MCP server is enabled",
  swap: SwapClass.RESTART,
});
export const DEFAULT_MCP_TRANSPORT = McpTransportType.STDIO;
export const DEFAULT_MCP_SERVER_NAME: string = configurable({
  key: "mcp.server_name",
  default: "exaix",
  type: ConfigValueType.STRING,
  description: "MCP server name identifier",
  swap: SwapClass.RESTART,
});
export const DEFAULT_MCP_VERSION = "1.0.0";
export const DEFAULT_MCP_IDENTITY_ID = "system";
export const DEFAULT_MCP_HTTP_PORT: number = configurable({
  key: "mcp.http_port",
  default: 3000,
  type: ConfigValueType.NUMBER,
  description: "HTTP port for the MCP server when using HTTP transport",
  min: 1024,
  max: 65535,
  swap: SwapClass.RESTART,
});

// ============================================================================
// Git Defaults
// ============================================================================
export const GIT_TIMEOUT_MS_MIN = 1000;
export const GIT_TIMEOUT_MS_MAX = 60000;
export const DEFAULT_GIT_BRANCH_PREFIX_PATTERN: string = configurable({
  key: "git.branch_prefix_pattern",
  default: "^(feature|bugfix|hotfix|chore)/",
  type: ConfigValueType.STRING,
  description: "Regex pattern for allowed git branch prefixes",
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_ALLOWED_PREFIXES = ["feature/", "bugfix/", "hotfix/", "chore/"];
export const DEFAULT_GIT_STATUS_TIMEOUT_MS: number = configurable({
  key: "git.status_timeout_ms",
  default: 10000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for git status operations",
  min: GIT_TIMEOUT_MS_MIN,
  max: GIT_TIMEOUT_MS_MAX,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_LS_FILES_TIMEOUT_MS: number = configurable({
  key: "git.ls_files_timeout_ms",
  default: 15000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for git ls-files operations",
  min: GIT_TIMEOUT_MS_MIN,
  max: GIT_TIMEOUT_MS_MAX,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_CHECKOUT_TIMEOUT_MS: number = configurable({
  key: "git.checkout_timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for git checkout operations",
  min: GIT_TIMEOUT_MS_MIN,
  max: GIT_TIMEOUT_MS_MAX,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_CLEAN_TIMEOUT_MS: number = configurable({
  key: "git.clean_timeout_ms",
  default: 20000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for git clean operations",
  min: GIT_TIMEOUT_MS_MIN,
  max: GIT_TIMEOUT_MS_MAX,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_LOG_TIMEOUT_MS: number = configurable({
  key: "git.log_timeout_ms",
  default: 20000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for git log operations",
  min: GIT_TIMEOUT_MS_MIN,
  max: GIT_TIMEOUT_MS_MAX,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_DIFF_TIMEOUT_MS: number = configurable({
  key: "git.diff_timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for git diff operations",
  min: GIT_TIMEOUT_MS_MIN,
  max: GIT_TIMEOUT_MS_MAX,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_COMMAND_TIMEOUT_MS: number = configurable({
  key: "git.command_timeout_ms",
  default: 60000,
  type: ConfigValueType.NUMBER,
  description: "Default timeout in milliseconds for general git operations",
  min: GIT_TIMEOUT_MS_MIN,
  max: GIT_TIMEOUT_MS_MAX,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_MAX_RETRIES: number = configurable({
  key: "git.max_retries",
  default: 3,
  type: ConfigValueType.NUMBER,
  description: "Maximum retry attempts for git operations",
  min: 1,
  max: 10,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_RETRY_BACKOFF_BASE_MS: number = configurable({
  key: "git.retry_backoff_base_ms",
  default: 1000,
  type: ConfigValueType.NUMBER,
  description: "Base backoff delay in milliseconds for git retries",
  min: 100,
  max: 10000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_BRANCH_NAME_COLLISION_MAX_RETRIES: number = configurable({
  key: "git.branch_collision_max_retries",
  default: 5,
  type: ConfigValueType.NUMBER,
  description: "Maximum retries for branch name collision resolution",
  min: 1,
  max: 10,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_TRACE_ID_SHORT_LENGTH: number = configurable({
  key: "git.trace_id_short_length",
  default: 8,
  type: ConfigValueType.NUMBER,
  description: "Length in characters for truncated trace IDs in branch names",
  min: 4,
  max: 16,
  swap: SwapClass.RESTART,
});
export const DEFAULT_GIT_BRANCH_SUFFIX_LENGTH: number = configurable({
  key: "git.branch_suffix_length",
  default: 8,
  type: ConfigValueType.NUMBER,
  description: "Length in characters for generated branch name suffixes",
  min: 4,
  max: 16,
  swap: SwapClass.RESTART,
});

// ============================================================================
// Rate Limiting Validation Limits
// ============================================================================

// Rate limiting defaults
export const DEFAULT_RATE_LIMIT_ENABLED: boolean = configurable({
  key: "rate_limit.enabled",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether rate limiting is enabled for AI provider requests",
  swap: SwapClass.RESTART,
});
export const DEFAULT_RATE_LIMIT_MAX_CALLS_PER_MINUTE: number = configurable({
  key: "rate_limit.max_calls_per_minute",
  default: 60,
  type: ConfigValueType.NUMBER,
  description: "Maximum API calls allowed per minute",
  min: 1,
  max: 1000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_RATE_LIMIT_MAX_TOKENS_PER_HOUR: number = configurable({
  key: "rate_limit.max_tokens_per_hour",
  default: 100000,
  type: ConfigValueType.NUMBER,
  description: "Maximum tokens allowed per hour across all providers",
  min: 1000,
  max: 1000000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_RATE_LIMIT_MAX_COST_PER_DAY: number = configurable({
  key: "rate_limit.max_cost_per_day",
  default: 10.0,
  type: ConfigValueType.NUMBER,
  description: "Maximum USD cost allowed per day across all providers",
  min: 0.01,
  max: 1000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_RATE_LIMIT_COST_PER_1K_TOKENS: number = configurable({
  key: "rate_limit.cost_per_1k_tokens",
  default: 0.002,
  type: ConfigValueType.NUMBER,
  description: "Estimated USD cost per 1K tokens for rate limit budgeting",
  min: 0.001,
  max: 1,
  swap: SwapClass.RESTART,
});

// Rate limiting time windows (in milliseconds)
export const RATE_LIMIT_WINDOW_MINUTE_MS = 60_000; // 1 minute
export const RATE_LIMIT_WINDOW_HOUR_MS = 3_600_000; // 1 hour
export const RATE_LIMIT_WINDOW_DAY_MS = 86_400_000; // 1 day

// Token estimation constants
export const TOKEN_ESTIMATION_CHARS_PER_TOKEN = 4;
export const TOKEN_ESTIMATION_MAX_TOKENS = 2000;

// ============================================================================
// Prompt Budgeting (Phase 62)
// ============================================================================

/** Provider ID prefixes that identify local/self-hosted LLM providers. */
export const LOCAL_PROVIDER_PREFIXES = ["ollama:", "lmstudio:", "local:"] as const;

/** Conservative fallback context window for local models when model-specific window is unknown. */
export const LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK = 32_768;

/** Default budget enforcement policy by provider category. */
export const DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED: boolean = configurable({
  key: "budget.cloud_enforcement_enabled",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether budget enforcement is active for cloud AI providers",
  swap: SwapClass.RESTART,
});
export const DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED: boolean = configurable({
  key: "budget.local_enforcement_enabled",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether budget enforcement is active for local AI providers",
  swap: SwapClass.RESTART,
});

/** Default maximum character budget for formatted session memory context. */
export const DEFAULT_MEMORY_CONTEXT_CHAR_LIMIT: number = configurable({
  key: "budget.memory_context_char_limit",
  default: 4_000,
  type: ConfigValueType.NUMBER,
  description: "Maximum characters for formatted session memory context in prompt",
  min: 100,
  max: 100_000,
  swap: SwapClass.RESTART,
});

/** Default maximum character budget for formatted skills context. */
export const DEFAULT_SKILL_CONTEXT_CHAR_BUDGET: number = configurable({
  key: "budget.skills_context_char_budget",
  default: 2_000,
  type: ConfigValueType.NUMBER,
  description: "Maximum characters for formatted skills context in prompt",
  min: 100,
  max: 50_000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_SKILLS_MAX_PER_REQUEST: number = configurable({
  key: "skills.max_per_request",
  default: 5,
  type: ConfigValueType.NUMBER,
  description: "Maximum number of skills to inject per agent request",
  min: 0,
  max: 50,
  swap: SwapClass.RESTART,
});
export const DEFAULT_SKILLS_MATCH_THRESHOLD: number = configurable({
  key: "skills.match_threshold",
  default: 0.3,
  type: ConfigValueType.NUMBER,
  description: "Minimum similarity score (0-1) for skill matching",
  min: 0,
  max: 1,
  swap: SwapClass.RESTART,
});
export const DEFAULT_SKILLS_KEYWORD_MATCH_SATURATION: number = configurable({
  key: "skills.keyword_match_saturation",
  default: 2,
  type: ConfigValueType.NUMBER,
  description:
    "Number of matched trigger keywords that earns full keyword-match score, so a skill with a long trigger keyword list is not penalized for the keywords it doesn't match",
  min: 1,
  max: 20,
  swap: SwapClass.RESTART,
});
export const DEFAULT_SKILLS_INJECT_IN_PROMPT: boolean = configurable({
  key: "skills.inject_in_prompt",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether matched skills are injected into the agent prompt",
  swap: SwapClass.RESTART,
});
export const DEFAULT_SKILLS_LOG_MATCHED_IDS: boolean = configurable({
  key: "skills.log_matched_ids",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether matched skill IDs are logged for audit",
  swap: SwapClass.RESTART,
});

/** Maximum allowed length for a saved session-memory insight description. */
export const SESSION_MEMORY_INSIGHT_DESCRIPTION_MAX_CHARS = 2_000;

// HARDCODED_MODEL_ALLOWLIST removed in Step 7b — the gate served its transition purpose.
// All business logic now resolves models through IModelRegistry/IModelPricingLookup.
// The curated data file (packages/model-registry/src/static_overlay.ts) is intentionally
// exempt — it IS the Solo-tier data source, not an ad-hoc reference.

// Tokenizer backend modes
export const TOKENIZER_BACKEND_AUTO = "auto" as const;
export const TOKENIZER_BACKEND_LOCAL = "local" as const;
export const TOKENIZER_BACKEND_API = "api" as const;

/** Minimum reserved tokens for critical prompt sections. */
export const SECTION_FLOORS = {
  system: 1_000,
  plan: 2_000,
} as const;

/** Ratio-based weight floors for adaptive reallocation (0.0–1.0 scale, NOT token counts). */
export const SECTION_WEIGHT_RATIO_FLOORS = {
  system: 0.20,
  plan: 0.35,
} as const;

/** Safety buffer deducted from total context window before budget allocation. */
export const SAFETY_BUFFER_RATIO = 0.1;

/** Surplus redistribution ratios after waterfall reallocation. */
export const SURPLUS_PLAN_RATIO = 0.5;
export const SURPLUS_PORTAL_KNOWLEDGE_RATIO = 0.3;
export const SURPLUS_SYSTEM_RATIO = 0.2;

/** Weight deltas for request-adaptive budget reallocation (Step 103.5). */
export const ADJUSTMENT_PLAN_BOOST = 0.05;
export const ADJUSTMENT_PORTAL_KNOWLEDGE_BOOST = 0.05;
export const ADJUSTMENT_PLAN_REDUCTION = 0.10;
export const ADJUSTMENT_PORTAL_KNOWLEDGE_REDUCTION = 0.10;
export const ADJUSTMENT_FILE_COUNT_THRESHOLD = 10;

/** Epsilon for floating-point sum comparison during weight re-normalization. */
export const ADJUSTMENT_EPSILON = 0.001;

/** Decimal precision for re-normalized weight values. */
export const ADJUSTMENT_PRECISION = 4;

/** Minimum hint value to avoid surplus reallocation. */
export const MINIMUM_HINT_THRESHOLD = 100;

/** Promotion score threshold for WORKING → EPISODIC memory tier promotion. */
export const MEMORY_TIER_EPISODIC_PROMOTION_THRESHOLD = 50;

/** Access count threshold for EPISODIC → SEMANTIC memory tier promotion. */
export const MEMORY_TIER_SEMANTIC_PROMOTION_ACCESS_COUNT = 3;

/** Initial promotion score for high-confidence tiered memory entries. */
export const MEMORY_TIER_PROMOTION_SCORE_HIGH = 80;

/** Initial promotion score for medium-confidence tiered memory entries. */
export const MEMORY_TIER_PROMOTION_SCORE_MEDIUM = 50;

/** Initial promotion score for low-confidence tiered memory entries. */
export const MEMORY_TIER_PROMOTION_SCORE_LOW = 20;

/**
 * Base allocation weights for prompt budget sections (as proportions of usable context).
 * Sum should equal 1.0 after waterfall reallocation.
 */
export const SECTION_BASE_WEIGHTS = {
  system: 0.20,
  plan: 0.35,
  portalKnowledge: 0.20,
  memory: 0.10,
  skills: 0.10,
  loopHistory: 0.05,
} as const;

// ============================================================================
// Cost Tracking Validation Limits
// ============================================================================
export const COST_TRACKING_BATCH_DELAY_MS_MIN = 100;
export const COST_TRACKING_BATCH_DELAY_MS_MAX = 60000;
export const COST_TRACKING_MAX_BATCH_SIZE_MIN = 1;
export const COST_TRACKING_MAX_BATCH_SIZE_MAX = 1000;
export const COST_TRACKING_RATES_MIN = 0;
export const COST_TRACKING_RATES_MAX = 1;

// Cost tracking defaults
export const DEFAULT_COST_TRACKING_BATCH_DELAY_MS: number = configurable({
  key: "cost_tracking.batch_delay_ms",
  default: 5000,
  type: ConfigValueType.NUMBER,
  description: "Delay in milliseconds between cost tracking batch flushes",
  min: COST_TRACKING_BATCH_DELAY_MS_MIN,
  max: COST_TRACKING_BATCH_DELAY_MS_MAX,
  swap: SwapClass.RESTART,
});
export const DEFAULT_COST_TRACKING_MAX_BATCH_SIZE: number = configurable({
  key: "cost_tracking.max_batch_size",
  default: 50,
  type: ConfigValueType.NUMBER,
  description: "Maximum number of cost entries per batch flush",
  min: COST_TRACKING_MAX_BATCH_SIZE_MIN,
  max: COST_TRACKING_MAX_BATCH_SIZE_MAX,
  swap: SwapClass.RESTART,
});
/**
 * Phase 135 (§5.5.2, GAP-6) — fallback tolerance (percent) for reported-vs-computed
 * cost divergence when `config.model_registry.cost_divergence_tolerance_pct` is absent
 * (e.g. a Solo daemon with no `model_registry` block). The configurable value lives on
 * the `model_registry` config schema; this constant is the nullish-read default.
 */
export const DEFAULT_COST_DIVERGENCE_TOLERANCE_PCT = 5;
// Rates per 1K tokens. Based on 2025-2026 output pricing:
// OpenAI gpt-5-mini: $2.00/1M output → $0.002/1K
export const COST_RATE_OPENAI: number = configurable({
  key: "cost_tracking.rate_openai",
  default: 0.002,
  type: ConfigValueType.NUMBER,
  description: "USD cost per 1K tokens for openai provider",
  min: 0,
  max: 1,
  swap: SwapClass.RESTART,
});
// Anthropic claude-haiku-4-5: $5.00/1M output → $0.005/1K
export const COST_RATE_ANTHROPIC: number = configurable({
  key: "cost_tracking.rate_anthropic",
  default: 0.005,
  type: ConfigValueType.NUMBER,
  description: "USD cost per 1K tokens for anthropic provider",
  min: 0,
  max: 1,
  swap: SwapClass.RESTART,
});
// Google gemini-2.5-flash (Vertex AI): $2.50/1M output → $0.0025/1K
export const COST_RATE_GOOGLE: number = configurable({
  key: "cost_tracking.rate_google",
  default: 0.0025,
  type: ConfigValueType.NUMBER,
  description: "USD cost per 1K tokens for google provider",
  min: 0,
  max: 1,
  swap: SwapClass.RESTART,
});
// Vertex AI bills Gemini at the same output rate as the Google AI API.
export const COST_RATE_VERTEX: number = configurable({
  key: "cost_tracking.rate_vertex",
  default: 0.0025,
  type: ConfigValueType.NUMBER,
  description: "USD cost per 1K tokens for vertex provider",
  min: 0,
  max: 1,
  swap: SwapClass.RESTART,
});
// OpenRouter pricing varies per underlying sub-model; 0 is an unmetered
// sentinel — usage token counts are still recorded for auditing.
export const COST_RATE_OPENROUTER: number = configurable({
  key: "cost_tracking.rate_openrouter",
  default: 0.0,
  type: ConfigValueType.NUMBER,
  description: "USD cost per 1K tokens for openrouter provider",
  min: 0,
  max: 1,
  swap: SwapClass.RESTART,
});
export const COST_RATE_OLLAMA: number = configurable({
  key: "cost_tracking.rate_ollama",
  default: 0.0,
  type: ConfigValueType.NUMBER,
  description: "USD cost per 1K tokens for ollama provider",
  min: 0,
  max: 1,
  swap: SwapClass.RESTART,
});
// llama.cpp runs locally and incurs no provider cost.
export const COST_RATE_LLAMACPP: number = configurable({
  key: "cost_tracking.rate_llamacpp",
  default: 0.0,
  type: ConfigValueType.NUMBER,
  description: "USD cost per 1K tokens for llamacpp provider",
  min: 0,
  max: 1,
  swap: SwapClass.RESTART,
});
export const COST_RATE_MOCK: number = configurable({
  key: "cost_tracking.rate_mock",
  default: 0.0,
  type: ConfigValueType.NUMBER,
  description: "USD cost per 1K tokens for mock provider",
  min: 0,
  max: 1,
  swap: SwapClass.RESTART,
});
export const TOKENS_PER_COST_UNIT: number = configurable({
  key: "cost_tracking.tokens_per_unit",
  default: 1000,
  type: ConfigValueType.NUMBER,
  description: "Number of tokens per cost calculation unit",
  min: 1,
  max: 1_000_000,
  swap: SwapClass.RESTART,
});

// ============================================================================
// Health Check Validation Limits
// ============================================================================
export const HEALTH_MEMORY_WARN_PERCENT_MIN = 1;
export const HEALTH_MEMORY_WARN_PERCENT_MAX = 99;
export const HEALTH_MEMORY_CRITICAL_PERCENT_MIN = 1;
export const HEALTH_MEMORY_CRITICAL_PERCENT_MAX = 99;

// Health check defaults
export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS: number = configurable({
  key: "health.check_timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for health check probes",
  min: 1000,
  max: 300000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_HEALTH_CACHE_TTL_MS: number = configurable({
  key: "health.cache_ttl_ms",
  default: 300000,
  type: ConfigValueType.NUMBER,
  description: "Time-to-live in milliseconds for health check cache entries",
  min: 1000,
  max: 3600000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_MEMORY_WARN_PERCENT: number = configurable({
  key: "health.memory_warn_percent",
  default: 80,
  type: ConfigValueType.NUMBER,
  description: "Memory usage percentage that triggers a warning health state",
  min: HEALTH_MEMORY_WARN_PERCENT_MIN,
  max: HEALTH_MEMORY_WARN_PERCENT_MAX,
  swap: SwapClass.HOT,
});
export const DEFAULT_MEMORY_CRITICAL_PERCENT: number = configurable({
  key: "health.memory_critical_percent",
  default: 95,
  type: ConfigValueType.NUMBER,
  description: "Memory usage percentage that triggers a critical health state",
  min: HEALTH_MEMORY_CRITICAL_PERCENT_MIN,
  max: HEALTH_MEMORY_CRITICAL_PERCENT_MAX,
  swap: SwapClass.HOT,
});

// ============================================================================
// Provider Strategy Validation Limits
// ============================================================================
export const PROVIDER_STRATEGY_BUDGETS_MIN = 0;

// Provider strategy defaults
export const DEFAULT_PROVIDER_STRATEGY_PREFER_FREE: boolean = configurable({
  key: "provider_strategy.prefer_free",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether to prefer free tier providers when available",
  swap: SwapClass.RESTART,
});
export const DEFAULT_PROVIDER_STRATEGY_ALLOW_LOCAL: boolean = configurable({
  key: "provider_strategy.allow_local",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether to allow local/self-hosted providers in the strategy",
  swap: SwapClass.RESTART,
});
export const DEFAULT_PROVIDER_STRATEGY_MAX_DAILY_COST_USD: number = configurable({
  key: "provider_strategy.max_daily_cost_usd",
  default: 5.0,
  type: ConfigValueType.NUMBER,
  description: "Maximum USD spending per day across all providers",
  min: 0,
  max: 1000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_PROVIDER_STRATEGY_HEALTH_CHECK_ENABLED: boolean = configurable({
  key: "provider_strategy.health_check_enabled",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether to check provider health before selecting",
  swap: SwapClass.RESTART,
});
export const DEFAULT_HEALTH_POLL_INTERVAL_MS: number = configurable({
  key: "health.poll_interval_ms",
  default: 60_000,
  type: ConfigValueType.NUMBER,
  description: "Interval in milliseconds between health poll cycles",
  min: 1000,
  max: 600_000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_MEMORY_REMOTE_BUDGET_USD: number = configurable({
  key: "memory.remote_budget_usd",
  default: 2.0,
  type: ConfigValueType.NUMBER,
  description: "USD budget cap for remote memory operations per billing cycle",
  min: 0,
  max: 100,
  swap: SwapClass.RESTART,
});
export const DEFAULT_PROVIDER_STRATEGY_FALLBACK_ENABLED: boolean = configurable({
  key: "provider_strategy.fallback_enabled",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether to fall back to alternative providers on failure",
  swap: SwapClass.RESTART,
});
export const DEFAULT_PROVIDER_STRATEGY_FALLBACK_CHAINS = {
  "balanced": ["openai", "anthropic", "google"],
  "fast": ["google", "openai"],
  "local_first": ["ollama", "openai"],
};

// ============================================================================
// Milestone Streaming Defaults
// ============================================================================
/** Whether milestone streaming is enabled by default (Phase 92) */
export const DEFAULT_MILESTONE_STREAMING_ENABLED: boolean = configurable({
  key: "execution.milestone_streaming_enabled",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Whether milestone streaming events are enabled for execution tracking",
  swap: SwapClass.RESTART,
});

// ============================================================================
// Provider Validation Limits
// ============================================================================
export const PROVIDER_FREE_QUOTA_REQUESTS_PER_DAY_MIN = 0;
export const PROVIDER_TIMEOUT_MS_MIN = 1000;
export const PROVIDER_TIMEOUT_MS_MAX = 300000;
export const PROVIDER_RATE_LIMIT_RPM_MIN = 1;
export const PROVIDER_RATE_LIMIT_RPM_MAX = 1000;

// ============================================================================
// API Endpoint Defaults
// ============================================================================
export const DEFAULT_SUBPROCESS_TIMEOUT_MS: number = configurable({
  key: "execution.subprocess_timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Default timeout in milliseconds for spawned subprocesses",
  min: 1000,
  max: 600_000,
  swap: SwapClass.RESTART,
});

// ============================================================================
// Keyboard Key Constants - DEPRECATED: Use KEYS from src/t../helpers/keyboard.ts
// ============================================================================
// All KEY_ constants have been moved to the KEYS object in src/t../helpers/keyboard.ts
// for better type safety and consistency. Please import from there instead.

// ============================================================================
// Logging Defaults
// ============================================================================
export const DEFAULT_LOG_LEVEL: string = configurable({
  key: "logging.level",
  default: LogLevel.INFO as string,
  type: ConfigValueType.STRING,
  description: "Default log level (DEBUG, INFO, WARN, ERROR, FATAL)",
  swap: SwapClass.HOT,
});
export const DEFAULT_LOG_MAX_SIZE_MB: number = configurable({
  key: "logging.max_size_mb",
  default: 10,
  type: ConfigValueType.NUMBER,
  description: "Maximum log file size in megabytes before rotation",
  min: 1,
  max: 1000,
  swap: SwapClass.RESTART,
});
export const DEFAULT_LOG_MAX_FILES: number = configurable({
  key: "logging.max_files",
  default: 5,
  type: ConfigValueType.NUMBER,
  description: "Maximum number of rotated log files to retain",
  min: 1,
  max: 100,
  swap: SwapClass.RESTART,
});
export const LOG_FILE_PREFIX = "structured-log";
export const LOG_FILE_EXTENSION = ".jsonl";

// ============================================================================
// Trigger Adapter Constants
// ============================================================================
export const TRIGGER_PAYLOAD_MAX_BYTES = 1_048_576; // 1 MB

// ============================================================================
// CLI Display and Validation Constants
// ============================================================================
export const PORTAL_ALIAS_MAX_LENGTH = 50;

export const LOG_RENDERER_MAX_MESSAGE_LENGTH = 100;
export const LOG_RENDERER_TRACE_ID_LENGTH = 8;
export const LOG_RENDERER_SEPARATOR_LENGTH = 50;

export const TIME_MS_PER_SECOND = 1000;
export const TIME_MS_PER_MINUTE = 60_000;
export const TIME_MS_PER_HOUR = 3_600_000;
// ============================================================================
// Retry and Error Constants
// ============================================================================

/** Error types that should trigger a retry */
export const RETRYABLE_ERROR_TYPES = [
  "RateLimitError",
  "TimeoutError",
  "NetworkError",
  "ServiceUnavailable",
  "InternalServerError",
  "ConnectionError",
  "ECONNRESET",
  "ETIMEDOUT",
];

/** Message substrings that indicate a retryable condition */
export const RETRYABLE_MESSAGE_PATTERNS = [
  "rate limit",
  "timeout",
  "network",
  "unavailable",
  "internal server",
  "connection",
  "econnreset",
  "etimedout",
  "socket hang up",
];

/** HTTP status codes that are considered retryable */
export const RETRYABLE_HTTP_STATUS_CODES = [
  "429", // Too Many Requests
  "500", // Internal Server Error
  "502", // Bad Gateway
  "503", // Service Unavailable
  "504", // Gateway Timeout
];

// ============================================================================
// General System Limits and Thresholds
// ============================================================================

/** Maximum length for names (portals, agents, etc.) */
export const MAX_NAME_LENGTH = 50;

/** Maximum length for unique identifiers */
export const MAX_ID_LENGTH = 50;

/** Default limit for database and service queries */
export const DEFAULT_QUERY_LIMIT: number = configurable({
  key: "system.query_limit",
  default: 50,
  type: ConfigValueType.NUMBER,
  description: "Default limit for database and service query results",
  min: 1,
  max: 10_000,
  swap: SwapClass.RESTART,
});

/** Minimum length threshold for meaningful content (summary, prompt, etc.) */
export const MIN_CONTENT_THRESHOLD = 50;

/** Default refresh interval for TUI views */
export const DEFAULT_REFRESH_INTERVAL_MS: number = configurable({
  key: "ui.refresh_interval_ms",
  default: 5000,
  type: ConfigValueType.NUMBER,
  description: "Default refresh interval in milliseconds for TUI views",
  min: 100,
  max: 60_000,
  swap: SwapClass.HOT,
});

/** Seconds in one hour, used for time formatting calculations */
export const SECONDS_PER_HOUR = 3600;

/** Bytes per kilobyte, used for unit conversion calculations */
export const BYTES_PER_KB = 1024;

/** Timeout for acquiring file locks */
export const LOCK_ACQUIRE_TIMEOUT_MS: number = configurable({
  key: "system.lock_acquire_timeout_ms",
  default: 5000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for acquiring file locks",
  min: 100,
  max: 60_000,
  swap: SwapClass.RESTART,
});

/** Timeout for stopping the daemon */
export const DAEMON_STOP_TIMEOUT_MS: number = configurable({
  key: "daemon.stop_timeout_ms",
  default: 5000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for graceful daemon shutdown",
  min: 100,
  max: 120_000,
  swap: SwapClass.RESTART,
});

/** Identity ID used for the daemon actor in logs and permission checks */
export const DAEMON_IDENTITY_ID = "daemon";

/** Max delay for database retries */
export const DB_MAX_RETRY_DELAY_MS: number = configurable({
  key: "database.max_retry_delay_ms",
  default: 5000,
  type: ConfigValueType.NUMBER,
  description: "Maximum delay in milliseconds between database retry attempts",
  min: 10,
  max: 60_000,
  swap: SwapClass.RESTART,
});

/** Maximum length for blueprint names */
export const BLUEPRINT_NAME_MAX_LENGTH = 100;

/** Maximum length for user requests */
export const USER_REQUEST_MAX_LENGTH = 10000;

/** Maximum length for plan content */
export const PLAN_CONTENT_MAX_LENGTH = 50000;

/** Maximum length for model names */
export const MODEL_NAME_MAX_LENGTH = 100;

/** Maximum length for filenames */
export const FILENAME_MAX_LENGTH = 255;

/** Maximum length for file paths */
export const PATH_MAX_LENGTH = 4096;

/** Default timeout for agent execution in milliseconds */
export const DEFAULT_AGENT_TIMEOUT_MS: number = configurable({
  key: "agent.timeout_ms",
  default: 300000,
  type: ConfigValueType.NUMBER,
  description: "Default timeout in milliseconds for agent execution",
  min: 1000,
  max: 3_600_000,
  swap: SwapClass.RESTART,
});

/** Maximum length for system prompts */
export const MAX_PROMPT_LENGTH = 50000;

// ============================================================================
// Prompt Context Defaults
// ============================================================================

export const PORTAL_LABEL = "portal";
export const ACTIVITY_ACTOR_AGENT = "agent";
export const PORTAL_CONTEXT_KEY = "portal_context";
export const PORTAL_KNOWLEDGE_KEY = "portal_knowledge";
/** IParsedRequest.context key for memory context injected by SessionMemoryService (Phase 49). */
export const MEMORY_CONTEXT_KEY = "memory_context";
export const PORTAL_CONTEXT_SECTION_TITLE = "Portal Context (SYSTEM CONTROLLED)";
export const PORTAL_CONTEXT_ALIAS_LABEL = "Portal Alias";
export const PORTAL_CONTEXT_ROOT_LABEL = "Portal Root";
export const PORTAL_CONTEXT_REPOSITORY_LABEL = "Repository Root";
export const PORTAL_CONTEXT_REQUIRED_ACTIONS_TITLE = "Required Actions";
export const PORTAL_CONTEXT_REQUIRED_ACTIONS = [
  "Use list_directory and read_file to inspect the portal before responding.",
  "Base analysis and changes only on files under the portal root.",
  "Start in src/ when present; otherwise inspect top-level folders.",
];

export const PLAN_REVIEW_COMMENTS_HEADER = "## Review Comments";
export const PLAN_REVIEW_COMMENT_PREFIX = "⚠️ ";
export const REQUEST_REVISION_COMMENTS_HEADER = "## Revision Instructions";
export const REQUEST_REVISION_COMMENT_PREFIX = PLAN_REVIEW_COMMENT_PREFIX;

/** Confidence Score Thresholds */
export const CONFIDENCE_THRESHOLD_VERY_LOW = 30;
export const CONFIDENCE_THRESHOLD_LOW = 50;
export const CONFIDENCE_THRESHOLD_MEDIUM = 70;
export const CONFIDENCE_THRESHOLD_HIGH = 90;

/** Default Confidence Thresholds */
export const CONFIDENCE_DEFAULT_LOW_THRESHOLD = 50;
export const CONFIDENCE_DEFAULT_VERY_LOW_THRESHOLD = 30;
export const CONFIDENCE_DEFAULT_HIGH_THRESHOLD = 80;

/** Confidence Scoring Base Values */
export const CONFIDENCE_SCORE_BASE = 70;

/** Confidence Adjustments */
export const CONFIDENCE_ADJUSTMENT_CERTAIN = 3;
export const CONFIDENCE_ADJUSTMENT_UNCERTAIN = -8;
export const CONFIDENCE_ADJUSTMENT_HEDGING = -5;
export const CONFIDENCE_ADJUSTMENT_QUALIFIER = -2;
export const CONFIDENCE_ADJUSTMENT_QUESTION = -10;
export const CONFIDENCE_ADJUSTMENT_SHORT = -15;
export const CONFIDENCE_ADJUSTMENT_VERY_SHORT = -20;

/** Confidence Length Thresholds */
export const CONFIDENCE_LENGTH_THRESHOLD_SHORT = 50;
export const CONFIDENCE_LENGTH_THRESHOLD_VERY_SHORT = 20;

// ============================================================================
// Execution Artifacts
// ============================================================================

export const EXECUTION_ARTIFACT_SECTION_SEPARATOR = "\n\n---\n\n";
export const EXECUTION_ARTIFACT_PLAN_SECTION_TITLE = "## Plan Output";
export const EXECUTION_ARTIFACT_ANALYSIS_SECTION_TITLE = "## Analysis Output";

export const EXECUTION_REPORT_FILENAME = "analysis.md";
export const EXECUTION_REPORT_TOOL_OUTPUT_MAX_CHARS: number = configurable({
  key: "execution.report_tool_output_max_chars",
  default: 4000,
  type: ConfigValueType.NUMBER,
  description: "Maximum characters from tool output included in execution reports",
  min: 100,
  max: 100_000,
  swap: SwapClass.RESTART,
});
export const EXECUTION_REPORT_PROMPT_MAX_CHARS: number = configurable({
  key: "execution.report_prompt_max_chars",
  default: 20000,
  type: ConfigValueType.NUMBER,
  description: "Maximum characters from prompts included in execution reports",
  min: 100,
  max: 500_000,
  swap: SwapClass.RESTART,
});
export const EXECUTION_REPORT_TEMPERATURE = 0.2;
export const EXECUTION_REPORT_MAX_TOKENS = 2000;

// ============================================================================
// Shared UI Icons (used by both Core and TUI)
// ============================================================================

export const ICON_SUCCESS = "✅";
export const ICON_FAILURE = "❌";
export const ICON_WARNING = "⚠️";
export const ICON_INFO = "ℹ️";

export const SHARED_PRIORITY_ICONS: Record<string, string> = {
  [RequestPriority.CRITICAL]: "🔴",
  [RequestPriority.HIGH]: "🟠",
  [RequestPriority.NORMAL]: "⚪",
  [RequestPriority.LOW]: "🔵",
  default: "⚪",
};

export const SHARED_DEFAULT_ICONS: Record<string, string> = {
  info: ICON_SUCCESS,
  warn: ICON_WARNING,
  error: ICON_FAILURE,
  debug: "🔍",
  fatal: "💀",
};

// === Request Analysis ===

/** Actionability score below which hybrid mode escalates to LLM analysis. */
export const DEFAULT_ACTIONABILITY_THRESHOLD: number = configurable({
  key: "analysis.actionability_threshold",
  default: 60,
  type: ConfigValueType.NUMBER,
  description: "Score below which hybrid analysis escalates to LLM",
  min: 0,
  max: 100,
  swap: SwapClass.RESTART,
});

/** Default analysis mode when not configured. */
export const DEFAULT_ANALYZER_MODE: string = configurable({
  key: "analysis.analyzer_mode",
  default: "hybrid",
  type: ConfigValueType.STRING,
  description: "Default analysis mode (hybrid, heuristic, llm)",
  swap: SwapClass.RESTART,
});

/** Semantic version of the request analyzer. Bump on breaking schema changes. */
export const ANALYZER_VERSION = "1.0.0";

/** Semantic version for blueprints. Bump on breaking schema changes. */
export const DEFAULT_BLUEPRINT_VERSION = "1.0.0";

/** Semantic version for skill indexes. Bump on breaking schema changes. */
export const DEFAULT_SKILL_INDEX_VERSION = "1.0.0";

/** Semantic version for flows. Bump on breaking schema changes. */
export const DEFAULT_FLOW_VERSION = "1.0.0";

/** Default backoff for flow step retries and onError retry recovery. */
export const DEFAULT_FLOW_STEP_BACKOFF_MS: number = configurable({
  key: "flow.step_backoff_ms",
  default: 1000,
  type: ConfigValueType.NUMBER,
  description: "Backoff delay in milliseconds for flow step retries",
  min: 100,
  max: 60_000,
  swap: SwapClass.RESTART,
});

/** Lower bound for configurable flow retry counts. */

/** Upper bound for configurable flow retry counts. */

/** Default retry count for flow onError retry recovery. */
export const DEFAULT_FLOW_MAX_RETRIES: number = configurable({
  key: "flow.max_retries",
  default: 1,
  type: ConfigValueType.NUMBER,
  description: "Maximum retry attempts for flow step onError recovery",
  min: 1,
  max: 5,
  swap: SwapClass.RESTART,
});

/** Schema version for flow checkpoints. Bump on breaking checkpoint shape changes. */
export const FLOW_CHECKPOINT_SCHEMA_VERSION = "1";

// Flow event names
export const FLOW_EVENT_STEP_RETRY = "flow.step.retry";
export const FLOW_EVENT_STEP_FALLBACK = "flow.step.fallback";
export const FLOW_EVENT_STEP_SKIPPED = "flow.step.skipped";
export const FLOW_EVENT_STEP_COMPENSATED = "flow.step.compensated";
export const FLOW_EVENT_STEP_COMPENSATION_FAILED = "flow.step.compensation_failed";
export const FLOW_EVENT_CHECKPOINT_SAVED = "flow.checkpoint.saved";
export const FLOW_EVENT_CHECKPOINT_LOADED = "flow.checkpoint.loaded";
export const FLOW_EVENT_CHECKPOINT_CLEARED = "flow.checkpoint.cleared";
export const FLOW_EVENT_CHECKPOINT_STALE = "flow.checkpoint.stale";
export const FLOW_EVENT_NAMESPACE_INITIALIZED = "flow.namespace.initialized";
export const FLOW_EVENT_NAMESPACE_READ = "flow.namespace.read";
export const FLOW_EVENT_NAMESPACE_WRITE = "flow.namespace.write";
export const FLOW_EVENT_PARALLEL_GROUP_STARTED = "flow.parallel_group.started";
export const FLOW_EVENT_PARALLEL_GROUP_COMPLETED = "flow.parallel_group.completed";
export const FLOW_EVENT_PARALLEL_GROUP_MERGE_FAILED = "flow.parallel_group.merge_failed";
export const FLOW_EVENT_COMPLETED = "flow.completed";
export const FLOW_EVENT_ABORTED = "flow.aborted";
export const FLOW_EVENT_FAILED = "flow.failed";
export const FLOW_EVENT_VALIDATION_FAILED = "flow.validation.failed";

export const FLOW_EVENT_STEP_SKIPPED_BY_REUSE = "flow.step.skipped_by_reuse";

// Step durability success metric thresholds (Phase 82)
export const STEP_REPLAY_REUSE_TARGET_PERCENT = 80;
export const STEP_DURABILITY_OVERHEAD_TARGET_MS = 10;
export const STEP_DURABILITY_RECORD_TARGET_PERCENT = 100;

/** Default max serialized size for a flow namespace artifact in bytes. */
export const DEFAULT_NAMESPACE_MAX_BYTES = 65536;

/** Semantic version for global memory. Bump on breaking schema changes. */
export const DEFAULT_GLOBAL_MEMORY_VERSION = "1.0.0";

/** Baseline actionability score before bonuses/penalties are applied. */
export const HEURISTIC_SCORE_BASELINE = 70;

/** Actionability score penalty per ambiguity signal detected. */
export const HEURISTIC_SCORE_AMBIGUITY_PENALTY = 10;

/** Actionability score bonus awarded when complexity signals are detected. */
export const HEURISTIC_SCORE_COMPLEXITY_BONUS = 20;

/** Minimum character count for a request to be classified as anything above SIMPLE. */
export const ANALYSIS_SIMPLE_MAX_CHARS = 200;

/** Bullet / numbered list items above this count → COMPLEX classification. */
export const ANALYSIS_COMPLEX_BULLET_THRESHOLD = 10;

/** Referenced files above this count → COMPLEX classification. */
export const ANALYSIS_COMPLEX_FILE_THRESHOLD = 5;

/** Character count above this threshold → COMPLEX classification. */
export const ANALYSIS_COMPLEX_CHAR_THRESHOLD = 3000;

/** Regex pattern for detecting file path references in request text. */
export const ANALYSIS_FILE_REF_PATTERN =
  /(?:^|[\s`'"])(@?[a-zA-Z][a-zA-Z0-9_@/-]*\/[a-zA-Z0-9_/.-]+\.[a-z]{1,4})(?=[\s`'",)!]|$)/gm;

/** Keywords indicating a multi-phase / epic request. */
export const ANALYSIS_EPIC_KEYWORDS: string[] = [
  "phase 1",
  "phase 2",
  "phase 3",
  "phase 4",
  "phase 5",
  "phase one",
  "phase two",
  "phase three",
  "multi-phase",
  "multi phase",
  "roadmap",
];

/** Hedging words that signal ambiguity in the request. */
export const ANALYSIS_HEDGING_WORDS: string[] = [
  "maybe",
  "perhaps",
  "possibly",
  "probably",
  "somehow",
  "might",
  "could",
  "should probably",
  "not sure",
  "unclear",
  "whatever",
  "something like",
  "kind of",
  "sort of",
  "i think",
];

/** Action verbs mapped to task type classification. */
export const ANALYSIS_TASK_TYPE_VERBS: Record<string, string> = {
  fix: TaskType.BUGFIX,
  bug: TaskType.BUGFIX,
  repair: TaskType.BUGFIX,
  correct: TaskType.BUGFIX,
  resolve: TaskType.BUGFIX,
  refactor: TaskType.REFACTOR,
  restructure: TaskType.REFACTOR,
  reorganize: TaskType.REFACTOR,
  rewrite: TaskType.REFACTOR,
  cleanup: TaskType.REFACTOR,
  "clean up": TaskType.REFACTOR,
  test: TaskType.TEST,
  "add test": TaskType.TEST,
  "add tests": TaskType.TEST,
  "write test": TaskType.TEST,
  "write tests": TaskType.TEST,
  spec: TaskType.TEST,
  document: TaskType.DOCS,
  documentation: TaskType.DOCS,
  "update doc": TaskType.DOCS,
  "update docs": TaskType.DOCS,
  "add doc": TaskType.DOCS,
  readme: TaskType.DOCS,
  analyze: TaskType.ANALYSIS,
  analyse: TaskType.ANALYSIS,
  investigate: TaskType.ANALYSIS,
  research: TaskType.ANALYSIS,
  audit: "analysis",
  implement: "feature",
  add: "feature",
  create: "feature",
  build: "feature",
  introduce: "feature",
  new: "feature",
  commit: TaskType.COMMIT,
};

// === Portal Knowledge ===

/** Maximum files to scan in quick mode. */
export const DEFAULT_QUICK_SCAN_LIMIT: number = configurable({
  key: "portal_knowledge.quick_scan_limit",
  default: 200,
  type: ConfigValueType.NUMBER,
  description: "Maximum files to scan in quick portal analysis mode",
  min: 10,
  max: 10_000,
  swap: SwapClass.RESTART,
});

/** Maximum files whose content is read during analysis. */
export const DEFAULT_MAX_FILES_TO_READ: number = configurable({
  key: "portal_knowledge.max_files_to_read",
  default: 50,
  type: ConfigValueType.NUMBER,
  description: "Maximum files whose content is read during portal analysis",
  min: 1,
  max: 1000,
  swap: SwapClass.RESTART,
});

/** Hours before portal knowledge is considered stale (1 week). */
export const DEFAULT_KNOWLEDGE_STALENESS_HOURS: number = configurable({
  key: "portal_knowledge.staleness_hours",
  default: 168,
  type: ConfigValueType.NUMBER,
  description: "Hours before cached portal knowledge is considered stale",
  min: 1,
  max: 8760,
  swap: SwapClass.RESTART,
});

/** Default analysis mode applied when not overridden. */
export const DEFAULT_PORTAL_KNOWLEDGE_MODE: string = configurable({
  key: "portal_knowledge.analysis_mode",
  default: "quick",
  type: ConfigValueType.STRING,
  description: "Default portal knowledge analysis mode (quick, full)",
  swap: SwapClass.RESTART,
});

/** Max total assembled prompt tokens sent to LLM in ArchitectureInferrer. */
export const ARCHITECTURE_INFERRER_TOKEN_BUDGET = 8_000;

/** Max lines per file before truncation when assembling the LLM prompt. */
export const ARCHITECTURE_INFERRER_MAX_FILE_TOKENS = 200;

/** Default minimum sample size for PatternDetector content analysis. */
export const DEFAULT_MIN_PATTERN_DETECTOR_SAMPLE_SIZE = 10;

/** Default maximum sample size for PatternDetector content analysis. */
export const DEFAULT_MAX_PATTERN_DETECTOR_SAMPLE_SIZE = 50;

/** Maximum retry attempts for ArchitectureInferrer LLM call. */
export const ARCHITECTURE_INFERRER_MAX_RETRIES = 3;

/** Initial backoff delay (ms) for ArchitectureInferrer retries. */
export const ARCHITECTURE_INFERRER_BACKOFF_MS = 1_000;

/** Backoff multiplier per retry attempt. */
export const ARCHITECTURE_INFERRER_BACKOFF_MULTIPLIER = 2;

/** Subprocess timeout for deno check in AstAnalyzer (ms). */
export const AST_ANALYZER_TIMEOUT_MS: number = configurable({
  key: "tools.ast_analyzer_timeout_ms",
  default: 30_000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for AST analysis subprocess calls",
  min: 1000,
  max: 300_000,
  swap: SwapClass.RESTART,
});

/** Subprocess timeout for deno test --dry-run in TestRunner (ms). */
export const TEST_RUNNER_TIMEOUT_MS: number = configurable({
  key: "tools.test_runner_timeout_ms",
  default: 30_000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for test runner subprocess calls",
  min: 1000,
  max: 300_000,
  swap: SwapClass.RESTART,
});

/** Subprocess timeout for deno audit / npm audit in VulnerabilityScanner (ms). */
export const VULN_SCANNER_TIMEOUT_MS: number = configurable({
  key: "tools.vuln_scanner_timeout_ms",
  default: 60_000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for vulnerability scanner subprocess",
  min: 1000,
  max: 600_000,
  swap: SwapClass.RESTART,
});

/** Subprocess timeout for git queries in GitHistoryAnalyzer (ms). */
export const GIT_HISTORY_TIMEOUT_MS: number = configurable({
  key: "tools.git_history_timeout_ms",
  default: 30_000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for git history analysis",
  min: 1000,
  max: 300_000,
  swap: SwapClass.RESTART,
});

/** Default max commits to analyze in GitHistoryAnalyzer. */
export const GIT_HISTORY_COMMIT_LIMIT = 500;

/** Default git since filter for GitHistoryAnalyzer. */
export const GIT_HISTORY_SINCE = "1.year";

/** Minimum commit count required for GitHistoryAnalyzer to consider history sufficient. */
export const GIT_HISTORY_SUFFICIENT_COMMITS = 10;

/** Max lines in the portal knowledge Markdown summary injected into agent prompts. */
export const PORTAL_KNOWLEDGE_PROMPT_MAX_LINES: number = configurable({
  key: "portal_knowledge.prompt_max_lines",
  default: 60,
  type: ConfigValueType.NUMBER,
  description: "Maximum lines of portal knowledge injected into agent prompts",
  min: 5,
  max: 500,
  swap: SwapClass.RESTART,
});

/** Max ISymbolEntry records stored in symbolMap. */
export const DEFAULT_SYMBOL_MAP_LIMIT: number = configurable({
  key: "tools.symbol_map_limit",
  default: 100,
  type: ConfigValueType.NUMBER,
  description: "Maximum ISymbolEntry records stored in symbol map",
  min: 10,
  max: 10_000,
  swap: SwapClass.RESTART,
});

/** Subprocess timeout for `deno doc --json` call in milliseconds. */
export const DENO_DOC_TIMEOUT_MS: number = configurable({
  key: "tools.deno_doc_timeout_ms",
  default: 15_000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for deno doc --json subprocess",
  min: 1000,
  max: 120_000,
  swap: SwapClass.RESTART,
});

// ---------------------------------------------------------------------------
// Multi-language symbol extraction (Phase 119)
// ---------------------------------------------------------------------------

/** Source-file extensions per language recognized by the symbol extractors (Phase 119). */
export const LANGUAGE_SOURCE_EXTENSIONS: Record<string, readonly string[]> = {
  typescript: [".ts", ".tsx"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  python: [".py", ".pyi"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
};

/** Default extension set (TS/JS) used when a language has no LANGUAGE_SOURCE_EXTENSIONS entry. */
export const TS_JS_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/** Per-file byte cap for tree-sitter symbol extraction; larger files are skipped (DoS bound). */
export const SYMBOL_EXTRACT_MAX_FILE_BYTES: number = configurable({
  key: "symbol_extraction.max_file_bytes",
  default: 1_000_000,
  type: ConfigValueType.NUMBER,
  description: "Per-file byte cap for tree-sitter symbol extraction (DoS bound)",
  min: 10_000,
  max: 100_000_000,
  swap: SwapClass.RESTART,
});

/** Per-zone cap on source files scanned by a single symbol-extraction pass (DoS bound). */
export const SYMBOL_EXTRACT_MAX_FILES: number = configurable({
  key: "symbol_extraction.max_files",
  default: 2_000,
  type: ConfigValueType.NUMBER,
  description: "Per-zone cap on source files scanned per pass (DoS bound)",
  min: 10,
  max: 100_000,
  swap: SwapClass.RESTART,
});

/** Per-file syntax-tree node cap; files exceeding it are skipped (WASM-memory DoS bound). */
export const SYMBOL_EXTRACT_MAX_NODES = 200_000;

/** Total wall-clock budget for one symbol-extraction pass, in milliseconds. */
export const SYMBOL_EXTRACT_TIMEOUT_MS: number = configurable({
  key: "symbol_extraction.timeout_ms",
  default: 15_000,
  type: ConfigValueType.NUMBER,
  description: "Total wall-clock budget in milliseconds for one symbol extraction pass",
  min: 1000,
  max: 300_000,
  swap: SwapClass.RESTART,
});

/** The deno CLI executable name used when spawning subprocesses. */
export const DENO_COMMAND = "deno";

/** deno CLI subcommand for running tests (deno test). */
export const DENO_SUBCOMMAND_TEST = "test";

/** deno CLI subcommand for type-checking (deno check). */
export const DENO_SUBCOMMAND_CHECK = "check";

/** deno CLI subcommand for auditing dependencies (deno audit). */
export const DENO_SUBCOMMAND_AUDIT = "audit";

/** File/directory name patterns skipped during portal traversal by default. */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  "cov_profile",
  ".cache",
  "__pycache__",
  "target",
  "vendor",
  ".venv",
  "venv",
  ".DS_Store",
];

/** Well-known entrypoint file names used for priority-first traversal and key-file identification. */
export const PORTAL_ENTRYPOINT_NAMES: string[] = [
  "main.ts",
  "main.js",
  "mod.ts",
  "index.ts",
  "index.js",
  "index.mjs",
  "app.ts",
  "app.js",
  "server.ts",
  "server.js",
];

/** Config file extensions used for config file identification. */
export const PORTAL_KNOWLEDGE_CONFIG_EXTENSIONS: string[] = [
  ".json",
  ".toml",
  ".yaml",
  ".yml",
];

/**
 * File name/path patterns that are always collected before the scan cap applies
 * (priority-first traversal). Matched using substring/suffix checks.
 */
export const PORTAL_KNOWLEDGE_PRIORITY_PATTERNS: string[] = [
  "package.json",
  "deno.json",
  "deno.jsonc",
  "tsconfig.json",
  "jsconfig.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "Dockerfile",
  ".gitignore",
  "main.ts",
  "main.js",
  "mod.ts",
  "index.ts",
  "index.js",
  "app.ts",
  "server.ts",
];

/**
 * Maps well-known directory names to architecture layer descriptions.
 * Keys are directory names (relative path components). Values are responsibility strings.
 */
export const PORTAL_KNOWLEDGE_ARCH_LAYER_DIRS: Record<string, string> = {
  services: "Core business logic and service implementations",
  controllers: "Request handling and routing controllers",
  handlers: "Command and event handlers",
  routes: "URL routing definitions",
  models: "Data models and entities",
  repositories: "Data access and persistence layer",
  schemas: "Validation schemas and type definitions",
  types: "Shared TypeScript type definitions",
  interfaces: "Service and domain interfaces",
  config: "Configuration loading and validation",
  migrations: "Database migration scripts",
  scripts: "Build, deploy, and maintenance scripts",
  tests: "Automated test suite",
  docs: "Project documentation",
  middleware: "HTTP middleware and interceptors",
  utils: "Utility functions and helpers",
  helpers: "Helper utilities",
  adapters: "External system adapters",
  providers: "Service and dependency providers",
  hooks: "React/framework lifecycle hooks",
  components: "UI components",
  pages: "Page-level UI components",
  api: "API layer / route definitions",
  lib: "Shared library code",
  cli: "Command-line interface commands",
  tui: "Terminal user interface components",
  ai: "AI/LLM provider implementations",
  mcp: "Model Context Protocol server",
};

// === Request Quality Gate ===

/** Default quality gate assessment mode. */
export const DEFAULT_QG_MODE: string = configurable({
  key: "quality_gate.mode",
  default: "hybrid",
  type: ConfigValueType.STRING,
  description: "Quality gate assessment mode (hybrid, heuristic, llm)",
  swap: SwapClass.RESTART,
});

/**
 * Score below which a request requires clarification or is rejected.
 * Requests scoring below this are not actionable without human input.
 */
export const DEFAULT_QG_MINIMUM_THRESHOLD: number = configurable({
  key: "quality_gate.minimum_threshold",
  default: 20,
  type: ConfigValueType.NUMBER,
  description: "Score below which a request requires clarification or is rejected",
  min: 0,
  max: 100,
  swap: SwapClass.RESTART,
});

/**
 * Score below which auto-enrichment is applied (but above minimum).
 * Requests in the [minimum, enrichment) band are auto-enriched via LLM.
 */
export const DEFAULT_QG_ENRICHMENT_THRESHOLD: number = configurable({
  key: "quality_gate.enrichment_threshold",
  default: 50,
  type: ConfigValueType.NUMBER,
  description: "Score threshold below which auto-enrichment is applied",
  min: 0,
  max: 100,
  swap: SwapClass.RESTART,
});

/**
 * Score above which a request proceeds to execution without intervention.
 */
export const DEFAULT_QG_PROCEED_THRESHOLD: number = configurable({
  key: "quality_gate.proceed_threshold",
  default: 70,
  type: ConfigValueType.NUMBER,
  description: "Score above which request proceeds without intervention",
  min: 0,
  max: 100,
  swap: SwapClass.RESTART,
});

/** Maximum clarification rounds before forcing proceed-with-best-effort. */
export const DEFAULT_MAX_CLARIFICATION_ROUNDS: number = configurable({
  key: "quality_gate.max_clarification_rounds",
  default: 5,
  type: ConfigValueType.NUMBER,
  description: "Maximum clarification rounds before forcing proceed-with-best-effort",
  min: 1,
  max: 20,
  swap: SwapClass.RESTART,
});

// --- Heuristic signal thresholds ---

/** Minimum body character count; shorter bodies incur the short-body penalty. */
export const QG_SHORT_BODY_MAX_CHARS = 20;

/** Score penalty for a body shorter than QG_SHORT_BODY_MAX_CHARS. */
export const QG_SHORT_BODY_PENALTY = 40;

/** Score penalty when no action verbs are detected in the request body. */
export const QG_NO_ACTION_VERBS_PENALTY = 20;

/** Score penalty when the request consists only of questions and no directives. */
export const QG_QUESTIONS_ONLY_PENALTY = 15;

/** Score penalty when no specific nouns (file names, feature names) are detected. */
export const QG_NO_SPECIFIC_NOUNS_PENALTY = 15;

/** Score bonus when the request references specific files or code paths. */
export const QG_FILE_REFERENCE_BONUS = 15;

/** Score bonus when acceptance criteria keywords are detected. */
export const QG_ACCEPTANCE_CRITERIA_BONUS = 20;

/** Score bonus when the request contains multiple structured requirements. */
export const QG_STRUCTURED_REQUIREMENTS_BONUS = 15;

/** Score bonus when technical specifics (APIs, libraries, protocols) are referenced. */
export const QG_TECHNICAL_SPECIFICS_BONUS = 10;

/** Score bonus when the request contains a context or background section. */
export const QG_CONTEXT_SECTION_BONUS = 10;

/** Baseline score before heuristic bonuses/penalties are applied. */
export const QG_HEURISTIC_SCORE_BASELINE = 50;

/** Action verbs indicating the request is directive (not just descriptive). */
export const QG_ACTION_VERBS: string[] = [
  "implement",
  "fix",
  "add",
  "create",
  "update",
  "refactor",
  "test",
  "build",
  "write",
  "change",
  "remove",
  "delete",
  "migrate",
  "integrate",
  "deploy",
  "configure",
  "optimize",
  "debug",
  "extract",
  "rename",
];

/** Keywords that indicate explicit acceptance criteria are present. */
export const QG_ACCEPTANCE_CRITERIA_KEYWORDS: string[] = [
  "should",
  "must",
  "expect",
  "given",
  "when",
  "then",
  "assert",
  "verify",
  "ensure",
  "requirement",
  "acceptance criteria",
  "success criteria",
  "definition of done",
];

/** Regex patterns used to detect file path references in request text. */
export const QG_FILE_REF_PATTERNS: RegExp[] = [
  /[a-zA-Z][a-zA-Z0-9_/-]*\/[a-zA-Z0-9_/.-]+\.[a-z]{1,4}/,
  /`[^`]+\.[a-z]{1,4}`/,
];

/** Regex pattern to detect technical specifics (APIs, packages, protocols). */
export const QG_TECH_SPECIFICS_PATTERN =
  /\b(?:api|sdk|http|https|rest|graphql|sql|json|xml|yaml|toml|deno|node|python|typescript|javascript|react|vue|postgres|sqlite|redis|docker|kubernetes|jwt|oauth|websocket)\b/i;

// --- Cross-phase context keys ---

/**
 * Key used to store the `IRequestSpecification` produced by the quality gate
 * in `IParsedRequest.context`. Consumed by Phase 48 (planning) and Phase 49 (execution).
 */
export const REQUEST_SPECIFICATION_KEY = "requestSpecification";

/**
 * Key used to store the `IRequestQualityAssessment` snapshot in `IParsedRequest.context`.
 * Allows downstream phases to inspect heuristic/LLM gate results without recomputing.
 */
export const REQUEST_QUALITY_ASSESSMENT_KEY = "qualityAssessment";

/**
 * Config model-alias key for the Q&A clarification planning agent.
 * Resolved against the provider's model map; falls back to the fast/cheap model.
 */
export const DEFAULT_CLARIFICATION_MODEL_KEY: string = configurable({
  key: "quality_gate.clarification_model",
  default: "fast",
  type: ConfigValueType.STRING,
  description: "Model key used for request clarification generation",
  swap: SwapClass.RESTART,
});

// === Acceptance Criteria Propagation ===

/**
 * Maximum number of dynamically generated EvaluationCriterion objects that
 * CriteriaGenerator.fromAnalysis() may return. Input lists are sorted by
 * descending weight (tiebreak: ascending goal priority) and then truncated to
 * this limit. No similarity-based merging is performed in Phase 48.
 */
export const MAX_DYNAMIC_CRITERIA = 10;

/**
 * Default weight assigned to goal-derived criteria when the goal does not
 * hold priority === 1.
 */
export const DEFAULT_GOAL_WEIGHT: number = configurable({
  key: "agent.goal_weight",
  default: 1.0,
  type: ConfigValueType.NUMBER,
  description: "Default weight for agent execution goals",
  min: 0,
  max: 10,
  swap: SwapClass.RESTART,
});

/**
 * Weight assigned to criteria derived from priority-1 goals. Higher than
 * DEFAULT_GOAL_WEIGHT so that top-priority goals survive the cap-at-10
 * truncation.
 */
export const PRIORITY_1_GOAL_WEIGHT = 2.0;

/**
 * Weight assigned to acceptance-criterion-derived criteria. Sits between
 * PRIORITY_1_GOAL_WEIGHT and DEFAULT_GOAL_WEIGHT so that explicit acceptance
 * criteria are preferred over lower-priority goals under the cap.
 */
export const ACCEPTANCE_CRITERION_WEIGHT = 1.5;

/**
 * Blend weight for the goal-alignment component in ConfidenceScorer.assess()
 * when a ReflexiveAgent critique with requirementsFulfillment is available.
 * Final score = rawScore * EXISTING_SCORE_CONFIDENCE_WEIGHT
 *             + goalAlignmentScore * GOAL_ALIGNMENT_CONFIDENCE_WEIGHT
 */
export const GOAL_ALIGNMENT_CONFIDENCE_WEIGHT = 0.3;

/**
 * Blend weight for the pre-Phase-48 raw confidence score component when
 * goal-alignment data is present in the critique.
 */
export const EXISTING_SCORE_CONFIDENCE_WEIGHT = 0.7;

/**
 * Maximum length (characters) of a sanitized criterion name produced by
 * CriteriaGenerator. Names longer than this are sliced after sanitization.
 */
export const CRITERION_NAME_MAX_LENGTH = 50;

/**
 * Regex used by CriteriaGenerator.sanitizeName() to remove characters that are
 * not lowercase letters, digits, or underscores from a criterion name.
 * Applied after toLowerCase() and before slice(0, CRITERION_NAME_MAX_LENGTH).
 */
export const CRITERION_NAME_SANITIZE_PATTERN = /[^a-z0-9_]/g;

// === Quality Pipeline Hardening ===
// Constants for Phase 49 hardening improvements across the quality pipeline.

/**
 * Maximum number of requirement items (goals + acceptance criteria combined)
 * injected into the ReflexiveAgent critique prompt when IRequestAnalysis is
 * available. Items are sorted by goal priority ascending; excess items are
 * truncated. Prevents critique-prompt bloat on large requests.
 */
export const MAX_CRITIQUE_REQUIREMENTS = 10;

/**
 * Minimum number of bullet/list items in a request body that triggers a
 * COMPLEX complexity classification in checkContentHeuristics().
 * Requests with >= this many bullets (lines starting with "- " or "* ") are
 * considered multi-requirement and promoted to TaskComplexity.COMPLEX.
 */
export const COMPLEXITY_BULLET_THRESHOLD_HIGH = 8;

/**
 * Maximum number of bullet items below which a request qualifies as a
 * SIMPLE complexity candidate (combined with other low-signal checks).
 */
export const COMPLEXITY_BULLET_THRESHOLD_LOW = 2;

/**
 * Minimum number of distinct file references in a request body that triggers
 * a COMPLEX complexity classification in checkContentHeuristics().
 * File references are detected by COMPLEXITY_FILE_REF_PATTERN.
 */
export const COMPLEXITY_FILE_REF_THRESHOLD_HIGH = 5;

/**
 * Minimum request body character count that triggers a COMPLEX complexity
 * classification in checkContentHeuristics().
 */
export const COMPLEXITY_BODY_LENGTH_HIGH = 500;

/**
 * Maximum request body character count below which a request qualifies as a
 * SIMPLE complexity candidate (combined with other low-signal checks).
 */
export const COMPLEXITY_BODY_LENGTH_LOW = 50;

/**
 * Regex used by checkContentHeuristics() to detect file references in a
 * request body. Matches typical source-file paths and file extensions across
 * the most common programming languages.
 * Applied with the 'gi' flags (global, case-insensitive).
 */
export const COMPLEXITY_FILE_REF_PATTERN = /(\/[\w.-]+|[a-z0-9_]+\.(ts|js|md|json|py|go|rs|c|cpp|h))/gi;

// ============================================================================
// Tool IClassification for Dynamic Execution (Phase 56)
// ============================================================================

// MCP tool names and related work sets are now owned by @exaix/mcp.

// ============================================================================
// Agent Execution & Prompting (Phase 61 Cleanup)
// ============================================================================

/** Prefixes used for plan step execution prompts */
export const PROMPT_PLAN_STEP_TASK_PREFIX = "CURRENT TASK:\n";
export const PROMPT_PLAN_STEP_REASONING_PREFIX = "\n\nREASONING:\n";

/** Maximum length for sanitized user input in agent prompts */
export const MAX_USER_INPUT_LENGTH = 10000;

/** Regular expression for extracting TOML blocks from model responses */
export const TOML_BLOCK_PATTERN = /```toml\s*([\s\S]*?)```/g;

/**
 * Regular expression for extracting step-scoped TOML action blocks from a plan-generation
 * <content> response (Phase 151) — a fenced ```toml block whose first line is a
 * `# TOML_BLOCK:N` marker comment, distinct from the unscoped TOML_BLOCK_PATTERN above
 * (which has no per-step marker requirement and is used for single-turn execution actions,
 * not multi-step plan generation).
 */
export const TOML_ACTION_BLOCK_MARKER_PATTERN = /```toml\n# TOML_BLOCK:(\d+)\n([\s\S]*?)\n```/g;

/** Generic fallback timeout in milliseconds (30s). */
export const DEFAULT_TIMEOUT_MS: number = configurable({
  key: "default.timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Default timeout for operations in milliseconds",
  min: 1000,
  max: 300000,
});

/** Fallback model name when none is configured. */
export const DEFAULT_MODEL_FALLBACK = "default";

/** Default parameters for legacy agent execution */
export const LEGACY_EXECUTION_TEMPERATURE = 0.7;
export const LEGACY_EXECUTION_MAX_TOKENS = 4000;

/** Loop history compaction threshold: fraction of budget before auto-compaction triggers. */
export const LOOP_HISTORY_BUDGET_THRESHOLD = 0.8;

/** Token compression ratio applied to compacted loop history entries. */
export const LOOP_HISTORY_COMPRESSION_RATIO = 0.3;

/**
 * Max tokens for LLM summarization prompt during loop history compaction.
 * Must leave headroom for models whose thinking blocks count against
 * max_tokens — a cap sized only for the summary text can be consumed
 * entirely by thinking, yielding an empty summary.
 */
export const COMPACT_SUMMARY_MAX_TOKENS: number = configurable({
  key: "agent.compact_summary_max_tokens",
  default: 2048,
  type: ConfigValueType.NUMBER,
  description: "Maximum output tokens for LLM summarization calls during loop history compaction",
  min: 100,
  max: 100_000,
  swap: SwapClass.RESTART,
});

/** Number of most recent steps preserved in full during compaction. */
export const DEFAULT_KEEP_LAST_N_STEPS: number = configurable({
  key: "agent.loop_history_steps",
  default: 2,
  type: ConfigValueType.NUMBER,
  description: "Number of recent loop iteration steps retained in history",
  min: 1,
  max: 50,
  swap: SwapClass.RESTART,
});

/**
 * Event name emitted after initial budget allocation with full breakdown.
 * @deprecated Use `DomainEventType.ContextBudgetAllocated` from `@exaix/core/events` instead.
 */
export const CONTEXT_BUDGET_ALLOCATED = "context.budget.allocated";

/**
 * Event name emitted after each section is built in the execution prompt.
 * @deprecated Use `DomainEventType.ContextBudgetConsumed` from `@exaix/core/events` instead.
 */
export const CONTEXT_BUDGET_CONSUMED = "context.budget.consumed";

/**
 * Event name emitted when a section is truncated to fit budget.
 * @deprecated Use `DomainEventType.ContextSectionTruncated` from `@exaix/core/events` instead.
 */
export const CONTEXT_SECTION_TRUNCATED = "context.section.truncated";

/**
 * Event name emitted when total estimated tokens exceed context window.
 * @deprecated Use `DomainEventType.ContextBudgetExceeded` from `@exaix/core/events` instead.
 */
export const CONTEXT_BUDGET_EXCEEDED = "context.budget.exceeded";

// ============================================================================
// Context Budget Manager — Segment-Level Compaction (Phase 83)
// ============================================================================

/** Maximum median latency in ms for the synchronous compaction tier (no LLM calls). */
export const CONTEXT_BUDGET_OVERHEAD_TARGET_MS = 15;

/**
 * Segment priority constants (range 0–100, higher = more protected).
 * Tie-break rule: insertion order (FIFO).
 * Segments with kind "system", "request", "acceptance_criteria" are always kept
 * regardless of these values.
 */
export const CONTEXT_PRIORITY_SYSTEM = 100;
export const CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA = 90;
export const CONTEXT_PRIORITY_PLAN_STEP = 80;
export const CONTEXT_PRIORITY_REQUEST = 75;
export const CONTEXT_PRIORITY_PORTAL_KNOWLEDGE = 60;
export const CONTEXT_PRIORITY_REFLECTION = 40;
export const CONTEXT_PRIORITY_TOOL_RESULT = 30;
export const CONTEXT_PRIORITY_SUMMARY = 20;

/**
 * Fraction of the loopHistory section budget applied as a per-segment cap
 * for tool_result segments in dynamic (ReAct) execution mode.
 * Used in ReActLoopStrategy.applyContextBudget() to prevent any single
 * tool result from consuming the entire loopHistory budget.
 */
export const REACT_TOOL_RESULT_BUDGET_RATIO = 0.6;

/** Canonical section names in IPromptBudget.sections (used for budget tracking). */
export const CONTEXT_SECTION_SYSTEM = "system";
export const CONTEXT_SECTION_PLAN = "plan";
export const CONTEXT_SECTION_PORTAL_KNOWLEDGE = "portalKnowledge";
export const CONTEXT_SECTION_MEMORY = "memory";
export const CONTEXT_SECTION_SKILLS = "skills";
export const CONTEXT_SECTION_LOOP_HISTORY = "loopHistory";

/** Default parameters for internal report generation */
export const REPORT_GENERATION_TEMPERATURE = 0.1;
export const REPORT_GENERATION_MAX_TOKENS = 1000;

/** Regex pattern to match portal-prefixed paths like @portal/file.ts */
export const PORTAL_PREFIX_PATTERN = /@[a-zA-Z0-9_-]+\//g;

/** Programming language identifiers */
export const LANG_TYPESCRIPT = "typescript";
export const LANG_JAVASCRIPT = "javascript";
export const LANG_PYTHON = "python";
export const LANG_RUST = "rust";
export const LANG_GO = "go";
export const LANG_JAVA = "java";

/** JSON Schema draft-07 primitive type name constants. Used in tool manifest output_schema fields. */
export const JsonSchemaType = {
  STRING: "string",
  NUMBER: "number",
  BOOLEAN: "boolean",
  OBJECT: "object",
  ARRAY: "array",
  NULL: "null",
} as const;

// ============================================================================
// Tool Result Validation (Phase 78)
// ============================================================================

/** Maximum retries for schema validation failures — applies only to idempotent, side-effect-free tools. */
export const TOOL_RESULT_VALIDATION_MAX_RETRIES: number = configurable({
  key: "tools.validation_max_retries",
  default: 3,
  type: ConfigValueType.NUMBER,
  description: "Maximum retries for tool result schema validation failures",
  min: 0,
  max: 20,
  swap: SwapClass.RESTART,
});

/** Semantic version for tool result schema descriptors returned via exaix/tools/result_schema. */
export const TOOL_RESULT_SCHEMA_VERSION = "1.0.0";

// ============================================================================
// Tool Confirmation Interceptor (Phase 79)
// ============================================================================

/** Default timeout in seconds for human tool confirmation requests. Auto-deny on expiry. */
export const DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S: number = configurable({
  key: "tools.confirmation_timeout_s",
  default: 120,
  type: ConfigValueType.NUMBER,
  description: "Timeout in seconds for human tool confirmation before auto-deny",
  min: 5,
  max: 3600,
  swap: SwapClass.RESTART,
});

/** Polling interval in milliseconds for NotificationQueueConfirmationInterceptor. */
export const TOOL_CONFIRMATION_POLL_INTERVAL_MS: number = configurable({
  key: "tools.confirmation_poll_interval_ms",
  default: 1000,
  type: ConfigValueType.NUMBER,
  description: "Polling interval in ms for tool confirmation interceptor",
  min: 100,
  max: 60_000,
  swap: SwapClass.RESTART,
});

/** Sentinel value for `decidedBy` when the confirmation interceptor auto-denies on timeout. */
export const TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT = "system:timeout";

/** Activity journal event: confirmation request written to DB and notification sent. */
export const TOOL_CONFIRMATION_EVENT_REQUESTED = "tool.confirmation.requested";

/** Activity journal event: interceptor received an approved decision. */
export const TOOL_CONFIRMATION_EVENT_APPROVED = "tool.confirmation.approved";

/** Activity journal event: interceptor received a denied decision or timed out. */
export const TOOL_CONFIRMATION_EVENT_DENIED = "tool.confirmation.denied";

/** Notification type string used when surfacing a pending tool approval to the user. */
export const TOOL_CONFIRMATION_NOTIFY_TYPE = "tool_approval_pending";

/** Sleep for the given number of milliseconds using setTimeout. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Maximum parallel deno doc --json processes for SymbolExtractor. */
export const SYMBOL_EXTRACTOR_CONCURRENCY: number = configurable({
  key: "symbol_extraction.concurrency",
  default: 4,
  type: ConfigValueType.NUMBER,
  description: "Maximum parallel processes for symbol extraction",
  min: 1,
  max: 16,
  swap: SwapClass.RESTART,
});

/** Directory name for session-delegation handoffs under the workspace root. */
export const SESSION_DELEGATE_DIR = "Session";

/** Sub-directory for session wait-state files: Memory/Execution/{traceId}/. */
export const SESSION_WAIT_STATE_DIR = "Memory/Execution";

/** Default delegation deadline in hours from brief creation. */
export const SESSION_DEFAULT_DEADLINE_HOURS: number = configurable({
  key: "session.default_deadline_hours",
  default: 24,
  type: ConfigValueType.NUMBER,
  description: "Default delegation deadline in hours from brief creation",
  min: 1,
  max: 720,
  swap: SwapClass.RESTART,
});

/** Default token budget bounds passed in every brief. */
export const SESSION_DEFAULT_MAX_INPUT_TOKENS: number = configurable({
  key: "session.max_input_tokens",
  default: 50_000,
  type: ConfigValueType.NUMBER,
  description: "Default maximum input tokens for session briefs",
  min: 100,
  max: 1_000_000,
  swap: SwapClass.RESTART,
});
export const SESSION_DEFAULT_MAX_OUTPUT_TOKENS: number = configurable({
  key: "session.max_output_tokens",
  default: 50_000,
  type: ConfigValueType.NUMBER,
  description: "Default maximum output tokens for session briefs",
  min: 100,
  max: 1_000_000,
  swap: SwapClass.RESTART,
});
export const SESSION_DEFAULT_MAX_TOTAL_TOKENS: number = configurable({
  key: "session.max_total_tokens",
  default: 100_000,
  type: ConfigValueType.NUMBER,
  description: "Default maximum total tokens for session briefs",
  min: 1000,
  max: 2_000_000,
  swap: SwapClass.RESTART,
});

/**
 * Token-budget environment variables injected into a delegated session tool's
 * launch. Tool-agnostic; the adapter sets only these (never inherits secrets).
 */
export const SESSION_ENV_MAX_INPUT_TOKENS = "EXA_SESSION_MAX_INPUT_TOKENS";
export const SESSION_ENV_MAX_OUTPUT_TOKENS = "EXA_SESSION_MAX_OUTPUT_TOKENS";
export const SESSION_ENV_MAX_TOTAL_TOKENS = "EXA_SESSION_MAX_TOTAL_TOKENS";

/** Lookback window for crash recovery (24h) — delegations older than this are considered stale. */
export const CRASH_RECOVERY_LOOKBACK_MS: number = configurable({
  key: "session.crash_recovery_lookback_ms",
  default: 86_400_000,
  type: ConfigValueType.NUMBER,
  description: "Lookback window in ms for crash recovery (delegations older than this are stale)",
  min: 3_600_000,
  max: 7_776_000_000,
  swap: SwapClass.RESTART,
});

/** CLI-adapter argv flags pointing the tool at the brief and its token ceiling. */
export const SESSION_FLAG_BRIEF = "--brief";
export const SESSION_FLAG_MAX_TOTAL_TOKENS = "--max-total-tokens";
/** Headless-mode flags: claude -p <objective>, opencode run <objective>, and output-format json. */
export const SESSION_FLAG_PRINT = "-p";
export const SESSION_SUBCMD_RUN = "run";
export const SESSION_FLAG_OUTPUT_FORMAT = "--output-format";
/** OpenCode-specific: --format json (differs from claude's --output-format). */
export const SESSION_FLAG_FORMAT = "--format";
export const SESSION_OUTPUT_FORMAT_JSON = "json";
/** Headless model selector: `claude --model <m>` / `opencode run --model <m>` (Phase 122 Step 0b). */
export const SESSION_FLAG_MODEL = "--model";

/**
 * Claude Code headless output-streaming flags: `claude -p <objective>
 * --output-format stream-json --verbose` emits newline-delimited JSON events
 * for one turn, then exits — used by CliDelegateStrategy to parse tool-use
 * and usage out of a single cold-spawn call.
 */
export const SESSION_FLAG_INPUT_FORMAT = "--input-format";
export const SESSION_INPUT_FORMAT_STREAM_JSON = "stream-json";
export const SESSION_FLAG_VERBOSE = "--verbose";

/** OpenCode session-continuation flag: `opencode run -s <session-id>` — session state lives server-side, resumed on each cold spawn. */
export const SESSION_FLAG_SESSION_ID = "--session";

/**
 * Claude Code session-continuation flag: `claude -p <objective> --resume
 * <session-id>` resumes a prior turn's conversation on a fresh cold spawn —
 * the officially documented multi-turn mechanism (Claude Code CLI reference),
 * mirroring opencode's own cold-spawn + session-id-resume shape. Captured
 * from the first turn's `system`/init event's `session_id` field.
 */
export const SESSION_FLAG_RESUME = "--resume";

/**
 * Maximum time (ms) CliDelegateStrategy waits for ONE cold-spawned claude/
 * opencode subprocess call to finish. A turn can involve real tool use (file
 * reads, edits, running the target project's test suite) — this must be much
 * larger than SafeSubprocess.run's generic 30s default, which a plan step
 * doing substantive work reliably exceeds.
 */
export const CLI_DELEGATE_TURN_TIMEOUT_MS: number = configurable({
  key: "cli_delegate.turn_timeout_ms",
  default: 300_000,
  type: ConfigValueType.NUMBER,
  description: "Maximum time in milliseconds to wait for one CliDelegateStrategy turn's result event",
  min: 5_000,
  max: 1_800_000,
  swap: SwapClass.HOT,
});

/** Claude Code permission-mode flag (Phase 128 R3 Step 3). */
export const SESSION_FLAG_PERMISSION_MODE = "--permission-mode";

/** Claude Code allowed-tools flag (Phase 128 R3 Step 3). */
export const SESSION_FLAG_ALLOWED_TOOLS = "--allowedTools";
export const SESSION_FLAG_JSON_SCHEMA = "--json-schema";

/** Default binary names per built-in session adapter (override via config). */
export const SESSION_BIN_CLAUDE_CODE = "claude";
export const SESSION_BIN_OPENCODE = "opencode";
export const SESSION_BIN_CURSOR = "cursor";
export const SESSION_BIN_VSCODE = "code";

/** Dogfood-developer identity ID — source of truth for the machine name used in OpenCode agent config keys (Phase 128 R3 Step 4). Must match `Blueprints/Identities/dogfood-developer.md:identity_id`. */
export const DOGFOOD_DEVELOPER_IDENTITY_ID = "dogfood-developer";
/**
 * Minimum supported versions for delegate tool permission-hardening features
 * (Phase 128 R3). Below these, the tool may not support --permission-mode /
 * --allowedTools (Claude Code) or agent-level permission blocks (OpenCode).
 * The probe warns but does not block, allowing users to upgrade at their own pace.
 */
export const MINIMUM_VERSION_OPENCODE = "1.0.0";
export const MINIMUM_VERSION_CLAUDE_CODE = "2.0.0";
export const MINIMUM_VERSION_CLAUDE_CODE_JSON_SCHEMA = "2.1.205";

/** Filesystem event kinds that indicate a (re)written file worth processing. */
export const FS_WRITE_EVENT_KINDS: ReadonlySet<string> = new Set(["create", "modify", "rename"]);

/** Cost-record provider prefix for a delegated (human-run) session tool. */
export const SESSION_COST_PROVIDER_PREFIX = "session:";

// ============================================================================
// Daemon Least-Privilege Spawn Permissions (Phase 124)
// ============================================================================

/**
 * Binaries the daemon is allowed to run via `--allow-run`. This is the SINGLE
 * source of truth for the run allowlist — both `DaemonCommands.start()` and
 * `scripts/dogfood_daemon.ts` import it (Phase 124 GAP-6), so the list cannot
 * drift between the two launch paths. Mirrors the historical `deno task dev`
 * allowlist plus the delegate binaries (`opencode`, `claude`).
 */
export const DAEMON_SPAWN_RUN_BINARIES: readonly string[] = [
  "git",
  "deno",
  "npm",
  "node",
  "exactl",
  SESSION_BIN_OPENCODE,
  SESSION_BIN_CLAUDE_CODE,
  "ls",
  "grep",
  "echo",
  "printf",
  "pwd",
  "whoami",
  "id",
  "date",
  "uptime",
  "which",
  "type",
  "command",
  "hash",
  "alias",
];

/**
 * Default outbound hosts the daemon may reach when `config.system.allow_net` is
 * `undefined`. An explicit `[]` blocks outbound entirely; a non-empty list
 * narrows to those hosts (enforced by `buildSpawnFlags` in Phase 124 Step 2).
 */
export const DAEMON_DEFAULT_NET_HOSTS: readonly string[] = [
  "api.anthropic.com",
  "api.openai.com",
  "localhost:11434",
];

/**
 * Structured least-privilege permission set for the daemon spawn (Phase 124).
 * `buildSpawnFlags(config)` assembles the concrete `--allow-*` flags from these
 * typed fields, so per-flag scoping is expressible (GAP-7).
 *
 * Read scope decision (GAP-3): `--allow-read` is kept UNSCOPED. The daemon reads
 * far beyond `config.system.root` — the Deno module/plug cache (incl. the sqlite
 * native plugin), `$HOME` for identity, and the repo root for dynamic import —
 * and a scoped `--allow-read` that omits any of these fails the sqlite FFI load
 * at boot. Narrowing the headline SSRF surface is achieved by the `write` scope
 * (`config.system.root`) and the `net` allowlist, not by scoping reads.
 */
export interface IDaemonSpawnPermissions {
  /** Read scopes; empty array means unscoped `--allow-read` (see GAP-3 above). */
  readonly read: readonly string[];
  /** Write scopes (resolved absolute paths); empty means unscoped. */
  readonly write: readonly string[];
  /** Run-binary allowlist (the single source of truth). */
  readonly run: readonly string[];
  /** Default outbound host list when `allow_net` is undefined. */
  readonly net: readonly string[];
  /** Whether `--allow-env` is granted. */
  readonly env: boolean;
  /** Whether `--allow-ffi` is granted (sqlite native plugin). */
  readonly ffi: boolean;
  /** Whether `--allow-import` is granted (Deno dynamic module loading). */
  readonly import: boolean;
}

/**
 * The daemon's least-privilege permission template. `read`/`write` are left as
 * empty arrays here (meaning "decided at spawn time from the resolved config
 * root"); `buildSpawnFlags` resolves the write scope to `config.system.root`.
 */
export const DAEMON_SPAWN_PERMISSIONS: IDaemonSpawnPermissions = {
  read: [],
  write: [],
  run: DAEMON_SPAWN_RUN_BINARIES,
  net: DAEMON_DEFAULT_NET_HOSTS,
  env: true,
  ffi: true,
  import: true,
};

/**
 * Permission flags for spawning the `exactl` CLI to run a `daemon` subcommand
 * (used by the TUI Daemon Control view). This is the CLI-dispatch layer — it
 * reads config, writes the PID file, runs git/deno, and opens sqlite for status;
 * the actual long-lived daemon it launches is separately narrowed via
 * `DAEMON_SPAWN_PERMISSIONS`/`buildSpawnFlags`. Scoped instead of `--allow-all`
 * (Phase 124 full-alignment).
 */
export const EXACTL_CLI_SPAWN_FLAGS: readonly string[] = [
  "--allow-read",
  "--allow-write",
  "--allow-net",
  "--allow-env",
  "--allow-ffi",
  "--allow-import",
  `--allow-run=${DAEMON_SPAWN_RUN_BINARIES.join(",")}`,
];

// Plan document constants
export const MAX_PLAN_FILE_BYTES = 1_048_576; // 1 MB — safety bound for check_step_manifests.ts

/**
 * Phase 135 Step 6 (§5.7.3, GAP-7) — composite route_health_score sub-signal weights.
 * The score is Σ(wᵢ·sᵢ) / Σ(wᵢ) over the sub-signals that have data: a sub-signal with
 * no value drops out and its weight is redistributed across the remaining ones (the
 * denominator is the sum of only the present weights), so the score stays well-defined
 * (and meaningful) before the latency / rate-limit data planes are populated. Only the
 * two circuit-breaker sub-signals are active in Step 6; latency (0.2) and rate-limit
 * (0.1) weights are omitted until those data planes are read (§10 / F4, out of scope).
 */
export const ROUTE_HEALTH_WEIGHT_CIRCUIT = 0.4;
export const ROUTE_HEALTH_WEIGHT_FAILURE_COUNT = 0.3;

/**
 * Run async tasks with bounded concurrency.
 * Processes items in batches of `concurrency`, ensuring at most `concurrency`
 * promises are in-flight at any time.
 */
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const executing: Promise<void>[] = [];
  for (const item of items) {
    const p = fn(item).finally(() => {
      const idx = executing.indexOf(p);
      if (idx >= 0) executing.splice(idx, 1);
    });
    executing.push(p);
    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}
