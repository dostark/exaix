/**
 * @module SharedConstants
 * @path packages/core/src/types/constants.ts
 * @description Centralized registry of system-wide constants shared between Core and TUI.
 * @architectural-layer Shared
 * @related-files ["packages/core/src/types/enums.ts", "packages/schemas/src/config.ts"]
 */

import { LogLevel, McpTransportType, MockStrategy, ProviderType, RequestPriority, TaskType } from "./enums.ts";

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
export const GUARDRAIL_SCREEN_TIMEOUT_MS = 10_000;

/** Maximum characters to include in the flagged_excerpt field of a GuardrailIncident. */
export const GUARDRAIL_FLAGGED_EXCERPT_MAX_CHARS = 500;

// ============================================================================
// HITL / Governance (Phase 118)
// ============================================================================
/** Maximum time (ms) for a HitlPolicyEvaluator.evaluate() call to stay within. */
export const HITL_EVAL_BUDGET_MS = 5;

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
export const DEFAULT_AMENDMENT_EXPIRY_MS = 86_400_000; // 24 hours
export const DEFAULT_AMENDMENT_THRESHOLD = 60; // ConfidenceScorer 0-100
export const DEFAULT_AMENDMENT_HITL_TIMEOUT_MS = 300_000; // 5 minutes
export const DEFAULT_AMENDMENT_ON_TIMEOUT = "abort";

// Live execution streaming constants (Phase 67)
export const STREAMING_EVENT_HEARTBEAT = "agent.heartbeat";
export const STREAMING_EVENT_TOOL_START = "tool.start";
export const STREAMING_EVENT_TOOL_END = "tool.end";
export const STREAMING_EVENT_LLM_STREAM = "llm.stream";
export const STREAMING_EVENT_FLOW_STATUS = "flow.status";
export const STREAMING_EVENT_MILESTONE = "milestone";
export const EXECUTION_HEARTBEAT_INTERVAL_MS = 5000; // 5 seconds
export const EVENT_BUS_MAX_SUBSCRIBER_QUEUE = 1000; // events before backpressure drop

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

// ============================================================================
// Database Validation Limits
// ============================================================================
export const DATABASE_BATCH_FLUSH_MS_MIN = 10;
export const DATABASE_BATCH_FLUSH_MS_MAX = 10000;
export const DATABASE_BATCH_MAX_SIZE_MIN = 1;
export const DATABASE_BATCH_MAX_SIZE_MAX = 1000;
export const DATABASE_BUSY_TIMEOUT_MS_MIN = 0;
export const DATABASE_BUSY_TIMEOUT_MS_MAX = 30000;

// Database defaults
export const DEFAULT_DATABASE_BATCH_FLUSH_MS = 1000;
export const DEFAULT_DATABASE_BATCH_MAX_SIZE = 100;
export const DEFAULT_DATABASE_JOURNAL_MODE = "WAL";
export const DEFAULT_DATABASE_FOREIGN_KEYS = true;
export const DEFAULT_DATABASE_BUSY_TIMEOUT_MS = 5000;
export const DEFAULT_DATABASE_FAILURE_THRESHOLD = 5;
export const DEFAULT_DATABASE_RESET_TIMEOUT_MS = 60000;
export const DEFAULT_DATABASE_HALF_OPEN_SUCCESS_THRESHOLD = 2;

// ============================================================================
// File Watcher Validation Limits
// ============================================================================
export const WATCHER_DEBOUNCE_MS_MIN = 50;
export const WATCHER_DEBOUNCE_MS_MAX = 5000;

// Watcher defaults
export const DEFAULT_WATCHER_DEBOUNCE_MS = 200;
export const DEFAULT_WATCHER_STABILITY_CHECK = true;
export const DEFAULT_WATCHER_STABILITY_BACKOFF_MS = [50, 100, 200, 500, 1000];
export const DEFAULT_WATCHER_STABILITY_MAX_ATTEMPTS = 5;
export const DEFAULT_WATCHER_STABILITY_MIN_FILE_SIZE = 1;

// ============================================================================

// ============================================================================
// Service Limits and Batch Sizes
// ============================================================================
export const DEFAULT_LOG_BUFFER_SIZE = 10000;
export const DEFAULT_COST_PRECISION_FACTOR = 10000;
export const DEFAULT_TITLE_PLACEHOLDER = "Untitled";
export const DEFAULT_NONE_LABEL = "None";
export const DEFAULT_NONE_VALUE = "none";
export const DEFAULT_DESCRIPTION_PLACEHOLDER = "(no description)";

// Agent Validation Limits
// ============================================================================
export const AGENT_TIMEOUT_SEC_MIN = 1;
export const AGENT_TIMEOUT_SEC_MAX = 300;
export const AGENT_MAX_ITERATIONS_MIN = 1;
export const AGENT_MAX_ITERATIONS_MAX = 100;

// Agent defaults
export const DEFAULT_AGENT_MODEL = "default";
export const DEFAULT_IDENTITY_ID = "default";
export const DEFAULT_UNKNOWN_LABEL = "Unknown";
export const DEFAULT_UNKNOWN_ERROR_MESSAGE = "Unknown error";
export const DEFAULT_AGENT_TIMEOUT_SEC = 60;
export const DEFAULT_AGENT_MAX_ITERATIONS = 10;
export const DEFAULT_REFLEXIVE_CONVERGENCE_QUALITY_EXIT_THRESHOLD = 85;
export const DEFAULT_REFLEXIVE_CONVERGENCE_MIN_IMPROVEMENT_DELTA = 3;
export const DEFAULT_REFLEXIVE_CONVERGENCE_OSCILLATION_WINDOW = 2;
export const DEFAULT_REFLEXIVE_CONVERGENCE_ABSOLUTE_MAX_ITERATIONS = 12;
export const DEFAULT_REFLEXIVE_CONVERGENCE_SCORE_EVERY_N_ITERATIONS = 1;

// Agent event names
export const AGENT_EVENT_EXECUTION_STARTED = "agent.execution_started";
export const AGENT_EVENT_EXECUTION_COMPLETED = "agent.execution_completed";
export const AGENT_EVENT_EXECUTION_FAILED = "agent.execution_failed";
export const AGENT_EVENT_OUTPUT = "agent.output";
export const AGENT_EVENT_SECURITY_VIOLATION = "security.violation";
export const AGENT_GENERATION_COMPLETED = "agent.generation_completed";
export const AGENT_EVENT_PROMPT_ASSEMBLED = "agent.prompt_assembled";

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
export const MEMORY_MIN_VECTORS_FOR_LOCAL_SEARCH = 5;

/** Example execution time used in AgentExecutor response-shape examples. */
export const AGENT_EXECUTION_EXAMPLE_TIME_MS = 2_000;

// ReAct loop constants
export const REACT_THOUGHT_PREFIX = "THOUGHT: ";
export const REACT_STATUS_COMPLETE = "STATUS: COMPLETE";
export const REACT_SUMMARY_PREFIX = "SUMMARY: ";
export const REACT_CALLING_TOOL_PREFIX = "CALLING TOOL: ";
export const REACT_TOOL_ERROR_PREFIX = "TOOL ERROR: ";
export const REACT_DEFAULT_TEMPERATURE = 0.1;
export const REACT_DEFAULT_MAX_TOKENS = 4000;

// General Agent & MCP constants
export const DEFAULT_AGENT_HANDSHAKE_TIMEOUT_MS = 30000;
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
export const DEFAULT_AI_TIMEOUT_MS = 30000;
export const DEFAULT_AI_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_AI_RETRY_BACKOFF_BASE_MS = 1000;
export const DEFAULT_AI_RETRY_TIMEOUT_PER_REQUEST_MS = 30000;
export const DEFAULT_AI_MODEL = "gemini-flash-latest";
export const DEFAULT_AI_TEMPERATURE_MIN = 0;
export const DEFAULT_AI_TEMPERATURE_MAX = 2;
export const AI_RETRY_MAX_ATTEMPTS_MIN = 1;
export const AI_RETRY_MAX_ATTEMPTS_MAX = 10;
export const AI_RETRY_BACKOFF_BASE_MS_MIN = 100;
export const AI_RETRY_BACKOFF_BASE_MS_MAX = 10000;
export const AI_RETRY_TIMEOUT_PER_REQUEST_MS_MIN = 1000;
export const AI_RETRY_TIMEOUT_PER_REQUEST_MS_MAX = 300000;
export const AI_TIMEOUT_MS_MIN = 1000;
export const AI_TIMEOUT_MS_MAX = 300000;
export const MOCK_DELAY_MS_MIN = 0;
export const MOCK_DELAY_MS_MAX = 5000;
export const MOCK_INPUT_TOKENS_MIN = 1;
export const MOCK_INPUT_TOKENS_MAX = 10000;
export const MOCK_OUTPUT_TOKENS_MIN = 1;
export const MOCK_OUTPUT_TOKENS_MAX = 10000;
export const MOCK_DELAY_MS = 100;
export const MOCK_INPUT_TOKENS = 100;
export const MOCK_OUTPUT_TOKENS = 200;
export const DEFAULT_MOCK_MODEL = "mock-model";
export const DEFAULT_MOCK_STRATEGY = MockStrategy.RECORDED;
export const DEFAULT_FAST_MODEL_NAME = "gemini-flash-latest";
export const DEFAULT_LOCAL_MODEL_NAME = "llama3.2";
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
export const PROMPT_PREVIEW_LENGTH = 100;
export const PROMPT_PREVIEW_EXTENDED = 500;

// ============================================================================
// MCP Defaults
// ============================================================================
export const DEFAULT_MCP_ENABLED = true;
export const DEFAULT_MCP_TRANSPORT = McpTransportType.STDIO;
export const DEFAULT_MCP_SERVER_NAME = "exaix";
export const DEFAULT_MCP_VERSION = "1.0.0";
export const DEFAULT_MCP_IDENTITY_ID = "system";
export const DEFAULT_MCP_HTTP_PORT = 3000;

// ============================================================================
// Git Defaults
// ============================================================================
export const GIT_TIMEOUT_MS_MIN = 1000;
export const GIT_TIMEOUT_MS_MAX = 60000;
export const GIT_MAX_RETRIES_MIN = 1;
export const GIT_MAX_RETRIES_MAX = 10;
export const GIT_RETRY_BACKOFF_BASE_MS_MIN = 100;
export const GIT_RETRY_BACKOFF_BASE_MS_MAX = 10000;
export const GIT_BRANCH_NAME_COLLISION_MAX_RETRIES_MIN = 1;
export const GIT_BRANCH_NAME_COLLISION_MAX_RETRIES_MAX = 10;
export const GIT_TRACE_ID_SHORT_LENGTH_MIN = 4;
export const GIT_TRACE_ID_SHORT_LENGTH_MAX = 16;
export const GIT_BRANCH_SUFFIX_LENGTH_MIN = 4;
export const GIT_BRANCH_SUFFIX_LENGTH_MAX = 16;
export const DEFAULT_GIT_BRANCH_PREFIX_PATTERN = "^(feature|bugfix|hotfix|chore)/";
export const DEFAULT_GIT_ALLOWED_PREFIXES = ["feature/", "bugfix/", "hotfix/", "chore/"];
export const DEFAULT_GIT_STATUS_TIMEOUT_MS = 10000;
export const DEFAULT_GIT_LS_FILES_TIMEOUT_MS = 15000;
export const DEFAULT_GIT_CHECKOUT_TIMEOUT_MS = 30000;
export const DEFAULT_GIT_CLEAN_TIMEOUT_MS = 20000;
export const DEFAULT_GIT_LOG_TIMEOUT_MS = 20000;
export const DEFAULT_GIT_DIFF_TIMEOUT_MS = 30000;
export const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 60000;
export const DEFAULT_GIT_MAX_RETRIES = 3;
export const DEFAULT_GIT_RETRY_BACKOFF_BASE_MS = 1000;
export const DEFAULT_GIT_BRANCH_NAME_COLLISION_MAX_RETRIES = 5;
export const DEFAULT_GIT_TRACE_ID_SHORT_LENGTH = 8;
export const DEFAULT_GIT_BRANCH_SUFFIX_LENGTH = 8;

// ============================================================================
// Rate Limiting Validation Limits
// ============================================================================
export const RATE_LIMIT_MAX_CALLS_PER_MINUTE_MIN = 1;
export const RATE_LIMIT_MAX_CALLS_PER_MINUTE_MAX = 1000;
export const RATE_LIMIT_MAX_TOKENS_PER_HOUR_MIN = 1000;
export const RATE_LIMIT_MAX_TOKENS_PER_HOUR_MAX = 1000000;
export const RATE_LIMIT_MAX_COST_PER_DAY_MIN = 0.01;
export const RATE_LIMIT_MAX_COST_PER_DAY_MAX = 1000;
export const RATE_LIMIT_COST_PER_1K_TOKENS_MIN = 0.001;
export const RATE_LIMIT_COST_PER_1K_TOKENS_MAX = 1;

// Rate limiting defaults
export const DEFAULT_RATE_LIMIT_ENABLED = true;
export const DEFAULT_RATE_LIMIT_MAX_CALLS_PER_MINUTE = 60;
export const DEFAULT_RATE_LIMIT_MAX_TOKENS_PER_HOUR = 100000;
export const DEFAULT_RATE_LIMIT_MAX_COST_PER_DAY = 10.0;
export const DEFAULT_RATE_LIMIT_COST_PER_1K_TOKENS = 0.002;

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

/**
 * Model context windows (tokens) used for prompt budget allocation.
 * Keys are provider:model identifiers.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "openai:gpt-4o-mini": 128_000,
  "openai:gpt-4o": 128_000,
  "anthropic:claude-3-5-sonnet": 200_000,
  "anthropic:claude-3-7-sonnet": 200_000,
  "google:gemini-2.5-flash": 1_000_000,
};

/** Provider ID prefixes that identify local/self-hosted LLM providers. */
export const LOCAL_PROVIDER_PREFIXES = ["ollama:", "lmstudio:", "local:"] as const;

/** Conservative fallback context window for local models when model-specific window is unknown. */
export const LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK = 32_768;

/** Default budget enforcement policy by provider category. */
export const DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED = true;
export const DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED = true;

/** Default maximum character budget for formatted session memory context. */
export const DEFAULT_MEMORY_CONTEXT_CHAR_LIMIT = 4_000;

/** Default maximum character budget for formatted skills context. */
export const DEFAULT_SKILL_CONTEXT_CHAR_BUDGET = 2_000;
export const DEFAULT_SKILLS_MAX_PER_REQUEST = 5;
export const DEFAULT_SKILLS_MATCH_THRESHOLD = 0.3;
export const DEFAULT_SKILLS_INJECT_IN_PROMPT = true;
export const DEFAULT_SKILLS_LOG_MATCHED_IDS = true;

/** Maximum allowed length for a saved session-memory insight description. */
export const SESSION_MEMORY_INSIGHT_DESCRIPTION_MAX_CHARS = 2_000;

/**
 * Model pricing map in USD per 1K tokens for cost estimation.
 * Keys are provider:model identifiers.
 */
export const MODEL_PRICING_MAP: Record<string, number> = {
  "openai:gpt-4o-mini": 0.0003,
  "openai:gpt-4o": 0.005,
  "anthropic:claude-3-5-sonnet": 0.003,
  "anthropic:claude-3-7-sonnet": 0.003,
  "google:gemini-2.5-flash": 0.00035,
};

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
export const DEFAULT_COST_TRACKING_BATCH_DELAY_MS = 5000;
export const DEFAULT_COST_TRACKING_MAX_BATCH_SIZE = 50;
// Rates per 1K tokens. Based on 2025-2026 output pricing:
// OpenAI gpt-5-mini: $2.00/1M output → $0.002/1K
export const COST_RATE_OPENAI = 0.002;
// Anthropic claude-haiku-4-5: $5.00/1M output → $0.005/1K
export const COST_RATE_ANTHROPIC = 0.005;
// Google gemini-2.5-flash (Vertex AI): $2.50/1M output → $0.0025/1K
export const COST_RATE_GOOGLE = 0.0025;
// Vertex AI bills Gemini at the same output rate as the Google AI API.
export const COST_RATE_VERTEX = 0.0025;
// OpenRouter pricing varies per underlying sub-model; 0 is an unmetered
// sentinel — usage token counts are still recorded for auditing.
export const COST_RATE_OPENROUTER = 0.0;
export const COST_RATE_OLLAMA = 0.0;
// llama.cpp runs locally and incurs no provider cost.
export const COST_RATE_LLAMACPP = 0.0;
export const COST_RATE_MOCK = 0.0;
export const TOKENS_PER_COST_UNIT = 1000;

// ============================================================================
// Health Check Validation Limits
// ============================================================================
export const HEALTH_CHECK_TIMEOUT_MS_MIN = 1000;
export const HEALTH_CHECK_TIMEOUT_MS_MAX = 300000;
export const HEALTH_CACHE_TTL_MS_MIN = 1000;
export const HEALTH_CACHE_TTL_MS_MAX = 3600000;
export const HEALTH_MEMORY_WARN_PERCENT_MIN = 1;
export const HEALTH_MEMORY_WARN_PERCENT_MAX = 99;
export const HEALTH_MEMORY_CRITICAL_PERCENT_MIN = 1;
export const HEALTH_MEMORY_CRITICAL_PERCENT_MAX = 99;

// Health check defaults
export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 30000;
export const DEFAULT_HEALTH_CACHE_TTL_MS = 300000;
export const DEFAULT_MEMORY_WARN_PERCENT = 80;
export const DEFAULT_MEMORY_CRITICAL_PERCENT = 95;

// ============================================================================
// Provider Strategy Validation Limits
// ============================================================================
export const PROVIDER_STRATEGY_MAX_DAILY_COST_USD_MIN = 0;
export const PROVIDER_STRATEGY_MAX_DAILY_COST_USD_MAX = 1000;
export const PROVIDER_STRATEGY_BUDGETS_MIN = 0;

// Provider strategy defaults
export const DEFAULT_PROVIDER_STRATEGY_PREFER_FREE = true;
export const DEFAULT_PROVIDER_STRATEGY_ALLOW_LOCAL = true;
export const DEFAULT_PROVIDER_STRATEGY_MAX_DAILY_COST_USD = 5.0;
export const DEFAULT_PROVIDER_STRATEGY_HEALTH_CHECK_ENABLED = true;
export const DEFAULT_HEALTH_POLL_INTERVAL_MS = 60_000;
export const DEFAULT_MEMORY_REMOTE_BUDGET_USD = 2.0;
export const DEFAULT_PROVIDER_STRATEGY_FALLBACK_ENABLED = true;
export const DEFAULT_PROVIDER_STRATEGY_FALLBACK_CHAINS = {
  "balanced": ["openai", "anthropic", "google"],
  "fast": ["google", "openai"],
  "local_first": ["ollama", "openai"],
};

// ============================================================================
// Milestone Streaming Defaults
// ============================================================================
/** Whether milestone streaming is enabled by default (Phase 92) */
export const DEFAULT_MILESTONE_STREAMING_ENABLED = true;

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
export const DEFAULT_SUBPROCESS_TIMEOUT_MS = 30000;

// ============================================================================
// Keyboard Key Constants - DEPRECATED: Use KEYS from src/t../helpers/keyboard.ts
// ============================================================================
// All KEY_ constants have been moved to the KEYS object in src/t../helpers/keyboard.ts
// for better type safety and consistency. Please import from there instead.

// ============================================================================
// Logging Defaults
// ============================================================================
export const DEFAULT_LOG_LEVEL = LogLevel.INFO;
export const DEFAULT_LOG_MAX_SIZE_MB = 10;
export const DEFAULT_LOG_MAX_FILES = 5;
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
export const DEFAULT_QUERY_LIMIT = 50;

/** Minimum length threshold for meaningful content (summary, prompt, etc.) */
export const MIN_CONTENT_THRESHOLD = 50;

/** Default refresh interval for TUI views */
export const DEFAULT_REFRESH_INTERVAL_MS = 5000;

/** Seconds in one hour, used for time formatting calculations */
export const SECONDS_PER_HOUR = 3600;

/** Bytes per kilobyte, used for unit conversion calculations */
export const BYTES_PER_KB = 1024;

/** Timeout for acquiring file locks */
export const LOCK_ACQUIRE_TIMEOUT_MS = 5000;

/** Timeout for stopping the daemon */
export const DAEMON_STOP_TIMEOUT_MS = 5000;

/** Identity ID used for the daemon actor in logs and permission checks */
export const DAEMON_IDENTITY_ID = "daemon";

/** Max delay for database retries */
export const DB_MAX_RETRY_DELAY_MS = 5000;

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
export const DEFAULT_AGENT_TIMEOUT_MS = 300000;

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
export const EXECUTION_REPORT_TOOL_OUTPUT_MAX_CHARS = 4000;
export const EXECUTION_REPORT_PROMPT_MAX_CHARS = 20000;
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
export const DEFAULT_ACTIONABILITY_THRESHOLD = 60;

/** Default analysis mode when not configured. */
export const DEFAULT_ANALYZER_MODE = "hybrid";

/** Semantic version of the request analyzer. Bump on breaking schema changes. */
export const ANALYZER_VERSION = "1.0.0";

/** Semantic version for blueprints. Bump on breaking schema changes. */
export const DEFAULT_BLUEPRINT_VERSION = "1.0.0";

/** Semantic version for skill indexes. Bump on breaking schema changes. */
export const DEFAULT_SKILL_INDEX_VERSION = "1.0.0";

/** Semantic version for flows. Bump on breaking schema changes. */
export const DEFAULT_FLOW_VERSION = "1.0.0";

/** Default backoff for flow step retries and onError retry recovery. */
export const DEFAULT_FLOW_STEP_BACKOFF_MS = 1000;

/** Lower bound for configurable flow retry counts. */
export const FLOW_MAX_RETRIES_MIN = 1;

/** Upper bound for configurable flow retry counts. */
export const FLOW_MAX_RETRIES_MAX = 5;

/** Default retry count for flow onError retry recovery. */
export const DEFAULT_FLOW_MAX_RETRIES = 1;

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
export const DEFAULT_QUICK_SCAN_LIMIT = 200;

/** Maximum files whose content is read during analysis. */
export const DEFAULT_MAX_FILES_TO_READ = 50;

/** Hours before portal knowledge is considered stale (1 week). */
export const DEFAULT_KNOWLEDGE_STALENESS_HOURS = 168;

/** Default analysis mode applied when not overridden. */
export const DEFAULT_PORTAL_KNOWLEDGE_MODE = "quick";

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
export const AST_ANALYZER_TIMEOUT_MS = 30_000;

/** Subprocess timeout for deno test --dry-run in TestRunner (ms). */
export const TEST_RUNNER_TIMEOUT_MS = 30_000;

/** Subprocess timeout for deno audit / npm audit in VulnerabilityScanner (ms). */
export const VULN_SCANNER_TIMEOUT_MS = 60_000;

/** Subprocess timeout for git queries in GitHistoryAnalyzer (ms). */
export const GIT_HISTORY_TIMEOUT_MS = 30_000;

/** Default max commits to analyze in GitHistoryAnalyzer. */
export const GIT_HISTORY_COMMIT_LIMIT = 500;

/** Default git since filter for GitHistoryAnalyzer. */
export const GIT_HISTORY_SINCE = "1.year";

/** Minimum commit count required for GitHistoryAnalyzer to consider history sufficient. */
export const GIT_HISTORY_SUFFICIENT_COMMITS = 10;

/** Max lines in the portal knowledge Markdown summary injected into agent prompts. */
export const PORTAL_KNOWLEDGE_PROMPT_MAX_LINES = 60;

/** Max ISymbolEntry records stored in symbolMap. */
export const DEFAULT_SYMBOL_MAP_LIMIT = 100;

/** Subprocess timeout for `deno doc --json` call in milliseconds. */
export const DENO_DOC_TIMEOUT_MS = 15_000;

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
export const SYMBOL_EXTRACT_MAX_FILE_BYTES = 1_000_000;

/** Per-zone cap on source files scanned by a single symbol-extraction pass (DoS bound). */
export const SYMBOL_EXTRACT_MAX_FILES = 2_000;

/** Per-file syntax-tree node cap; files exceeding it are skipped (WASM-memory DoS bound). */
export const SYMBOL_EXTRACT_MAX_NODES = 200_000;

/** Total wall-clock budget for one symbol-extraction pass, in milliseconds. */
export const SYMBOL_EXTRACT_TIMEOUT_MS = 15_000;

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
export const DEFAULT_QG_MODE = "hybrid";

/**
 * Score below which a request requires clarification or is rejected.
 * Requests scoring below this are not actionable without human input.
 */
export const DEFAULT_QG_MINIMUM_THRESHOLD = 20;

/**
 * Score below which auto-enrichment is applied (but above minimum).
 * Requests in the [minimum, enrichment) band are auto-enriched via LLM.
 */
export const DEFAULT_QG_ENRICHMENT_THRESHOLD = 50;

/**
 * Score above which a request proceeds to execution without intervention.
 */
export const DEFAULT_QG_PROCEED_THRESHOLD = 70;

/** Maximum clarification rounds before forcing proceed-with-best-effort. */
export const DEFAULT_MAX_CLARIFICATION_ROUNDS = 5;

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
export const DEFAULT_CLARIFICATION_MODEL_KEY = "fast";

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
export const DEFAULT_GOAL_WEIGHT = 1.0;

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
// Tool Classification for Dynamic Execution (Phase 56)
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

/** Default parameters for legacy agent execution */
export const LEGACY_EXECUTION_TEMPERATURE = 0.7;
export const LEGACY_EXECUTION_MAX_TOKENS = 4000;

/** Loop history compaction threshold: fraction of budget before auto-compaction triggers. */
export const LOOP_HISTORY_BUDGET_THRESHOLD = 0.8;

/** Token compression ratio applied to compacted loop history entries. */
export const LOOP_HISTORY_COMPRESSION_RATIO = 0.3;

/** Max tokens for LLM summarization prompt during loop history compaction. */
export const COMPACT_SUMMARY_MAX_TOKENS = 200;

/** Number of most recent steps preserved in full during compaction. */
export const DEFAULT_KEEP_LAST_N_STEPS = 2;

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
export const TOOL_RESULT_VALIDATION_MAX_RETRIES = 3;

/** Semantic version for tool result schema descriptors returned via exaix/tools/result_schema. */
export const TOOL_RESULT_SCHEMA_VERSION = "1.0.0";

// ============================================================================
// Tool Confirmation Interceptor (Phase 79)
// ============================================================================

/** Default timeout in seconds for human tool confirmation requests. Auto-deny on expiry. */
export const DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S = 120;

/** Polling interval in milliseconds for NotificationQueueConfirmationInterceptor. */
export const TOOL_CONFIRMATION_POLL_INTERVAL_MS = 1000;

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
export const SYMBOL_EXTRACTOR_CONCURRENCY = 4;

/** Directory name for session-delegation handoffs under the workspace root. */
export const SESSION_DELEGATE_DIR = "Session";

/** Sub-directory for session wait-state files: Memory/Execution/{traceId}/. */
export const SESSION_WAIT_STATE_DIR = "Memory/Execution";

/** Default delegation deadline in hours from brief creation. */
export const SESSION_DEFAULT_DEADLINE_HOURS = 24;

/** Default token budget bounds passed in every brief. */
export const SESSION_DEFAULT_MAX_INPUT_TOKENS = 50_000;
export const SESSION_DEFAULT_MAX_OUTPUT_TOKENS = 50_000;
export const SESSION_DEFAULT_MAX_TOTAL_TOKENS = 100_000;

/**
 * Token-budget environment variables injected into a delegated session tool's
 * launch. Tool-agnostic; the adapter sets only these (never inherits secrets).
 */
export const SESSION_ENV_MAX_INPUT_TOKENS = "EXA_SESSION_MAX_INPUT_TOKENS";
export const SESSION_ENV_MAX_OUTPUT_TOKENS = "EXA_SESSION_MAX_OUTPUT_TOKENS";
export const SESSION_ENV_MAX_TOTAL_TOKENS = "EXA_SESSION_MAX_TOTAL_TOKENS";

/** Lookback window for crash recovery (24h) — delegations older than this are considered stale. */
export const CRASH_RECOVERY_LOOKBACK_MS = 86_400_000;

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

/** Default binary names per built-in session adapter (override via config). */
export const SESSION_BIN_CLAUDE_CODE = "claude";
export const SESSION_BIN_OPENCODE = "opencode";
export const SESSION_BIN_CURSOR = "cursor";
export const SESSION_BIN_VSCODE = "code";

/** Filesystem event kinds that indicate a (re)written file worth processing. */
export const FS_WRITE_EVENT_KINDS: ReadonlySet<string> = new Set(["create", "modify", "rename"]);

/** Cost-record provider prefix for a delegated (human-run) session tool. */
export const SESSION_COST_PROVIDER_PREFIX = "session:";

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
