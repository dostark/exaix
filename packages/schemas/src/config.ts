/**
 * @module ConfigSchema
 * @path packages/schemas/src/config.ts
 * @description Defines the master Zod schema for Exaix's configuration file (), orchestrating system, path, AI, and portal settings.
 * @architectural-layer Config
 * @related-files [packages/core/src/config/service.ts, "packages/core/src/types/constants.ts"]
 */

import { z } from "zod";
import { AiConfigSchema, ProviderTypeSchema } from "./ai_config.ts";
import { MCPConfigSchema } from "./mcp.ts";
import * as DEFAULTS from "@exaix/core";
import { TokenizerBackend } from "@exaix/core";
import {
  AI_RETRY_BACKOFF_BASE_MS_MAX,
  AI_RETRY_BACKOFF_BASE_MS_MIN,
  AI_RETRY_MAX_ATTEMPTS_MAX,
  AI_RETRY_MAX_ATTEMPTS_MIN,
  AI_RETRY_TIMEOUT_PER_REQUEST_MS_MAX,
  AI_RETRY_TIMEOUT_PER_REQUEST_MS_MIN,
  AI_TIMEOUT_MS_MAX,
  AI_TIMEOUT_MS_MIN,
  DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
  DEFAULT_AI_RETRY_MAX_ATTEMPTS,
  DEFAULT_AI_RETRY_TIMEOUT_PER_REQUEST_MS,
  DEFAULT_AI_TEMPERATURE_MAX,
  DEFAULT_AI_TEMPERATURE_MIN,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_FAST_MODEL_NAME,
  DEFAULT_LOCAL_MODEL_NAME,
  MOCK_DELAY_MS,
  MOCK_DELAY_MS_MAX,
  MOCK_DELAY_MS_MIN,
  MOCK_INPUT_TOKENS,
  MOCK_INPUT_TOKENS_MAX,
  MOCK_INPUT_TOKENS_MIN,
  MOCK_OUTPUT_TOKENS,
  MOCK_OUTPUT_TOKENS_MAX,
  MOCK_OUTPUT_TOKENS_MIN,
  PROVIDER_ANTHROPIC,
  PROVIDER_GOOGLE,
  PROVIDER_MOCK,
  PROVIDER_OLLAMA,
  PROVIDER_OPENAI,
} from "@exaix/core";
import {
  DEFAULT_MCP_ENABLED,
  DEFAULT_MCP_IDENTITY_ID,
  DEFAULT_MCP_SERVER_NAME,
  DEFAULT_MCP_TRANSPORT,
  DEFAULT_MCP_VERSION,
} from "@exaix/core";
import {
  ConfidenceAssessmentLevel,
  LogLevel,
  MemoryBankSource,
  PortalAnalysisMode,
  ProviderCostTier,
  QualityGateMode,
  SqliteJournalMode,
} from "@exaix/core";
import type { PortalOperation } from "@exaix/core";
import { WORKSPACE_SCHEMA_VERSION } from "@exaix/core";
import { AnalysisMode } from "@exaix/core/request";

import { PortalPermissionsSchema } from "./portal_permissions.ts";
import { ZBudgetPolicy } from "./prompt_budget.ts";

export interface IPortalConfig {
  alias: string;
  target_path: string;
  description?: string;
  default_branch?: string;
  identities_allowed?: string[];
  operations?: PortalOperation[];
  created?: string;
}

export type Config = z.infer<typeof ConfigSchema>;

// Helper to get current working directory safely
function getCwdSafe(): string {
  try {
    return Deno.cwd();
  } catch {
    // Fallback to /tmp if cwd doesn't exist (can happen in tests)
    return "/tmp";
  }
}

const DEFAULT_COST_TRACKING_RATES: Record<string, number> = {
  [PROVIDER_OPENAI]: DEFAULTS.COST_RATE_OPENAI,
  [PROVIDER_ANTHROPIC]: DEFAULTS.COST_RATE_ANTHROPIC,
  [PROVIDER_GOOGLE]: DEFAULTS.COST_RATE_GOOGLE,
  [PROVIDER_OLLAMA]: DEFAULTS.COST_RATE_OLLAMA,
  [PROVIDER_MOCK]: DEFAULTS.COST_RATE_MOCK,
};

const DEFAULT_GIT_OPERATIONS = {
  status_timeout_ms: DEFAULTS.DEFAULT_GIT_STATUS_TIMEOUT_MS,
  ls_files_timeout_ms: DEFAULTS.DEFAULT_GIT_LS_FILES_TIMEOUT_MS,
  checkout_timeout_ms: DEFAULTS.DEFAULT_GIT_CHECKOUT_TIMEOUT_MS,
  clean_timeout_ms: DEFAULTS.DEFAULT_GIT_CLEAN_TIMEOUT_MS,
  log_timeout_ms: DEFAULTS.DEFAULT_GIT_LOG_TIMEOUT_MS,
  diff_timeout_ms: DEFAULTS.DEFAULT_GIT_DIFF_TIMEOUT_MS,
  command_timeout_ms: DEFAULTS.DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  max_retries: DEFAULTS.DEFAULT_GIT_MAX_RETRIES,
  retry_backoff_base_ms: DEFAULTS.DEFAULT_GIT_RETRY_BACKOFF_BASE_MS,
  branch_name_collision_max_retries: DEFAULTS.DEFAULT_GIT_BRANCH_NAME_COLLISION_MAX_RETRIES,
  trace_id_short_length: DEFAULTS.DEFAULT_GIT_TRACE_ID_SHORT_LENGTH,
  branch_suffix_length: DEFAULTS.DEFAULT_GIT_BRANCH_SUFFIX_LENGTH,
} as const;

const AutoApproveSourceSchema = z.union([
  z.nativeEnum(MemoryBankSource),
  z.enum(["EXECUTION", "USER", "IDENTITY", "AGENT", "LEARNED", "CORE", "PROJECT", "FILE", "DATABASE", "LLM"]),
]);

const RoutingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  policy_path: z.string().min(1).default(".exaix/routing.policy.yaml"),
  experiment_salt: z.string().min(1).default("exaix-routing-experiments"),
  enable_dynamic_routing: z.boolean().default(false),
}).optional().default({});

export const ToolsConfigSchema = z.object({
  // Network capability control
  fetch_url: z.object({
    enabled: z.boolean().default(false),
    allowed_domains: z.array(z.string()).default([
      "deno.land",
      "docs.deno.com",
      "npmjs.com",
      "github.com",
      "stackoverflow.com",
    ]),
    timeout_ms: z.number().default(5000),
    max_response_size_kb: z.number().default(50), // Prevent context flooding
  }).default({}),

  // Search limits
  grep_search: z.object({
    max_results: z.number().default(50),
    exclude_dirs: z.array(z.string()).default([".git", "node_modules", "dist", "coverage"]),
  }).default({}),

  // Tool confirmation interceptor timeout (Phase 79 — seconds; min 10, max 3600; fallback: DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S)
  confirmation_timeout_s: z.number().min(10).max(3600).optional(),
});

export const ConfigSchema = z.object({
  tools: ToolsConfigSchema.optional().default({}),
  system: z.object({
    root: z.string().default(getCwdSafe()),
    log_level: z.nativeEnum(LogLevel).default(LogLevel.INFO),
    version: z.string().optional(),
    schema_version: z.string().default(WORKSPACE_SCHEMA_VERSION),
  }),
  paths: z.object({
    workspace: z.string().default(DEFAULTS.DEFAULT_WORKSPACE_PATH),
    runtime: z.string().default(DEFAULTS.DEFAULT_RUNTIME_PATH),
    memory: z.string().default(DEFAULTS.DEFAULT_MEMORY_PATH),
    portals: z.string().default(DEFAULTS.DEFAULT_PORTALS_PATH),
    blueprints: z.string().default(DEFAULTS.DEFAULT_BLUEPRINTS_PATH),
    active: z.string().default(DEFAULTS.DEFAULT_ACTIVE_PATH),
    archive: z.string().default(DEFAULTS.DEFAULT_ARCHIVE_PATH),
    plans: z.string().default(DEFAULTS.DEFAULT_PLANS_PATH),
    requests: z.string().default(DEFAULTS.DEFAULT_REQUESTS_PATH),
    rejected: z.string().default(DEFAULTS.DEFAULT_REJECTED_PATH),
    identities: z.string().default(DEFAULTS.DEFAULT_IDENTITIES_PATH),
    flows: z.string().default(DEFAULTS.DEFAULT_FLOWS_PATH),
    memoryProjects: z.string().default(DEFAULTS.DEFAULT_PROJECTS_MEMORY_PATH),
    memoryExecution: z.string().default(DEFAULTS.DEFAULT_EXECUTION_MEMORY_PATH),
    memoryIndex: z.string().default(DEFAULTS.DEFAULT_INDEX_MEMORY_PATH),
    memorySkills: z.string().default(DEFAULTS.DEFAULT_SKILLS_MEMORY_PATH),
    memoryPending: z.string().default(DEFAULTS.DEFAULT_PENDING_MEMORY_PATH),
    memoryTasks: z.string().default(DEFAULTS.DEFAULT_TASKS_MEMORY_PATH),
    memoryGlobal: z.string().default(DEFAULTS.DEFAULT_GLOBAL_MEMORY_PATH),
  }),
  database: z.object({
    batch_flush_ms: z.number()
      .min(DEFAULTS.DATABASE_BATCH_FLUSH_MS_MIN)
      .max(DEFAULTS.DATABASE_BATCH_FLUSH_MS_MAX)
      .default(DEFAULTS.DEFAULT_DATABASE_BATCH_FLUSH_MS),
    batch_max_size: z.number()
      .min(DEFAULTS.DATABASE_BATCH_MAX_SIZE_MIN)
      .max(DEFAULTS.DATABASE_BATCH_MAX_SIZE_MAX)
      .default(DEFAULTS.DEFAULT_DATABASE_BATCH_MAX_SIZE),
    path: z.string().optional(),
    sqlite: z.object({
      journal_mode: z.nativeEnum(SqliteJournalMode)
        .default(DEFAULTS.DEFAULT_DATABASE_JOURNAL_MODE as SqliteJournalMode),
      foreign_keys: z.boolean().default(DEFAULTS.DEFAULT_DATABASE_FOREIGN_KEYS),
      busy_timeout_ms: z.number()
        .min(DEFAULTS.DATABASE_BUSY_TIMEOUT_MS_MIN)
        .max(DEFAULTS.DATABASE_BUSY_TIMEOUT_MS_MAX)
        .default(DEFAULTS.DEFAULT_DATABASE_BUSY_TIMEOUT_MS),
    }).default({
      journal_mode: DEFAULTS.DEFAULT_DATABASE_JOURNAL_MODE as SqliteJournalMode.WAL,
      foreign_keys: DEFAULTS.DEFAULT_DATABASE_FOREIGN_KEYS,
      busy_timeout_ms: DEFAULTS.DEFAULT_DATABASE_BUSY_TIMEOUT_MS,
    }),
    failure_threshold: z.number().default(DEFAULTS.DEFAULT_DATABASE_FAILURE_THRESHOLD),
    reset_timeout_ms: z.number().default(DEFAULTS.DEFAULT_DATABASE_RESET_TIMEOUT_MS),
    half_open_success_threshold: z.number().default(DEFAULTS.DEFAULT_DATABASE_HALF_OPEN_SUCCESS_THRESHOLD),
  }).default({
    batch_flush_ms: DEFAULTS.DEFAULT_DATABASE_BATCH_FLUSH_MS,
    batch_max_size: DEFAULTS.DEFAULT_DATABASE_BATCH_MAX_SIZE,
    sqlite: {
      journal_mode: DEFAULTS.DEFAULT_DATABASE_JOURNAL_MODE as SqliteJournalMode.WAL,
      foreign_keys: DEFAULTS.DEFAULT_DATABASE_FOREIGN_KEYS,
      busy_timeout_ms: DEFAULTS.DEFAULT_DATABASE_BUSY_TIMEOUT_MS,
    },
    failure_threshold: DEFAULTS.DEFAULT_DATABASE_FAILURE_THRESHOLD,
    reset_timeout_ms: DEFAULTS.DEFAULT_DATABASE_RESET_TIMEOUT_MS,
    half_open_success_threshold: DEFAULTS.DEFAULT_DATABASE_HALF_OPEN_SUCCESS_THRESHOLD,
  }),
  watcher: z.object({
    debounce_ms: z.number()
      .min(DEFAULTS.WATCHER_DEBOUNCE_MS_MIN)
      .max(DEFAULTS.WATCHER_DEBOUNCE_MS_MAX)
      .default(DEFAULTS.DEFAULT_WATCHER_DEBOUNCE_MS),
    stability_check: z.boolean().default(DEFAULTS.DEFAULT_WATCHER_STABILITY_CHECK),
  }).default({
    debounce_ms: DEFAULTS.DEFAULT_WATCHER_DEBOUNCE_MS,
    stability_check: DEFAULTS.DEFAULT_WATCHER_STABILITY_CHECK,
  }),
  agents: z.object({
    default_model: z.string().default(DEFAULTS.DEFAULT_AGENT_MODEL),
    timeout_sec: z.number()
      .min(DEFAULTS.AGENT_TIMEOUT_SEC_MIN)
      .max(DEFAULTS.AGENT_TIMEOUT_SEC_MAX)
      .default(DEFAULTS.DEFAULT_AGENT_TIMEOUT_SEC),
    max_iterations: z.number()
      .min(DEFAULTS.AGENT_MAX_ITERATIONS_MIN)
      .max(DEFAULTS.AGENT_MAX_ITERATIONS_MAX)
      .default(DEFAULTS.DEFAULT_AGENT_MAX_ITERATIONS),
    convergence: z.object({
      quality_exit_threshold: z.number()
        .min(0)
        .max(100)
        .default(DEFAULTS.DEFAULT_REFLEXIVE_CONVERGENCE_QUALITY_EXIT_THRESHOLD),
      min_improvement_delta: z.number()
        .min(0)
        .max(20)
        .default(DEFAULTS.DEFAULT_REFLEXIVE_CONVERGENCE_MIN_IMPROVEMENT_DELTA),
      oscillation_window: z.number().int().min(2).max(4)
        .default(DEFAULTS.DEFAULT_REFLEXIVE_CONVERGENCE_OSCILLATION_WINDOW),
      base_max_iterations: z.number().int()
        .min(DEFAULTS.AGENT_MAX_ITERATIONS_MIN)
        .max(DEFAULTS.AGENT_MAX_ITERATIONS_MAX)
        .default(DEFAULTS.DEFAULT_AGENT_MAX_ITERATIONS),
      complexity_scale_factor: z.number().min(0).max(3)
        .default(1.0),
      absolute_max_iterations: z.number().int().min(1).max(20)
        .default(DEFAULTS.DEFAULT_REFLEXIVE_CONVERGENCE_ABSOLUTE_MAX_ITERATIONS),
      score_every_n_iterations: z.number().int().min(1).max(5)
        .default(DEFAULTS.DEFAULT_REFLEXIVE_CONVERGENCE_SCORE_EVERY_N_ITERATIONS),
    }).optional().default({}),
  }).default({
    default_model: DEFAULTS.DEFAULT_AGENT_MODEL,
    timeout_sec: DEFAULTS.DEFAULT_AGENT_TIMEOUT_SEC,
    max_iterations: DEFAULTS.DEFAULT_AGENT_MAX_ITERATIONS,
    convergence: {},
  }),
  memory: z.object({
    auto_approve: z.object({
      enabled: z.boolean().default(false),
      confidence_threshold: z.nativeEnum(ConfidenceAssessmentLevel)
        .default(ConfidenceAssessmentLevel.HIGH),
      delay_hours: z.number().int().min(1).max(720).default(24),
      sources_allowed: z.array(AutoApproveSourceSchema).default(["AGENT"]),
      max_batch_size: z.number().int().min(1).max(100).default(20),
    }).default({}),
    embedding: z.object({
      model: z.string().default("nomic-embed-text"),
      dimension: z.number().int().positive().default(768),
    }).optional(),
  }).optional().default({}),
  skills: z.object({
    max_per_request: z.number().int().min(1).default(DEFAULTS.DEFAULT_SKILLS_MAX_PER_REQUEST),
    match_threshold: z.number().min(0).max(1).default(DEFAULTS.DEFAULT_SKILLS_MATCH_THRESHOLD),
    inject_in_prompt: z.boolean().default(DEFAULTS.DEFAULT_SKILLS_INJECT_IN_PROMPT),
    log_matched_ids: z.boolean().default(DEFAULTS.DEFAULT_SKILLS_LOG_MATCHED_IDS),
    context_budget_chars: z.number().int().min(0).default(DEFAULTS.DEFAULT_SKILL_CONTEXT_CHAR_BUDGET),
  }).default({
    max_per_request: DEFAULTS.DEFAULT_SKILLS_MAX_PER_REQUEST,
    match_threshold: DEFAULTS.DEFAULT_SKILLS_MATCH_THRESHOLD,
    inject_in_prompt: DEFAULTS.DEFAULT_SKILLS_INJECT_IN_PROMPT,
    log_matched_ids: DEFAULTS.DEFAULT_SKILLS_LOG_MATCHED_IDS,
    context_budget_chars: DEFAULTS.DEFAULT_SKILL_CONTEXT_CHAR_BUDGET,
  }),
  portals: z.array(PortalPermissionsSchema).default([]),
  /** AI/LLM provider configuration (legacy/single) */
  ai: AiConfigSchema.optional(),
  /** Named model configurations (default, fast, local, etc.) */
  models: z.record(z.object({
    provider: ProviderTypeSchema, // Use ProviderTypeSchema directly instead of AiConfigSchema.shape.provider
    model: z.string(),
    timeout_ms: z.number().positive().optional(),
    max_tokens: z.number().positive().optional(),
    temperature: z.number()
      .min(DEFAULT_AI_TEMPERATURE_MIN)
      .max(DEFAULT_AI_TEMPERATURE_MAX)
      .optional(),
    base_url: z.string().optional(),
  })).default({
    [DEFAULTS.DEFAULT_AGENT_MODEL]: {
      provider: PROVIDER_GOOGLE,
      model: DEFAULT_FAST_MODEL_NAME,
      timeout_ms: DEFAULT_AI_TIMEOUT_MS,
    },
    fast: {
      provider: PROVIDER_GOOGLE,
      model: DEFAULT_FAST_MODEL_NAME,
      timeout_ms: DEFAULT_AI_TIMEOUT_MS,
    },
    local: {
      provider: PROVIDER_OLLAMA,
      model: DEFAULT_LOCAL_MODEL_NAME,
      timeout_ms: 120000,
    },
  }),
  /** AI provider endpoints configuration */
  ai_endpoints: z.record(z.string(), z.string()).optional().default({}),
  /** AI retry configuration */
  ai_retry: z.object({
    max_attempts: z.number()
      .min(AI_RETRY_MAX_ATTEMPTS_MIN)
      .max(AI_RETRY_MAX_ATTEMPTS_MAX)
      .default(DEFAULT_AI_RETRY_MAX_ATTEMPTS),
    backoff_base_ms: z.number()
      .min(AI_RETRY_BACKOFF_BASE_MS_MIN)
      .max(AI_RETRY_BACKOFF_BASE_MS_MAX)
      .default(DEFAULT_AI_RETRY_BACKOFF_BASE_MS),
    timeout_per_request_ms: z.number()
      .min(AI_RETRY_TIMEOUT_PER_REQUEST_MS_MIN)
      .max(AI_RETRY_TIMEOUT_PER_REQUEST_MS_MAX)
      .default(DEFAULT_AI_RETRY_TIMEOUT_PER_REQUEST_MS),
    providers: z.record(
      z.string(),
      z.object({
        max_attempts: z.number()
          .min(AI_RETRY_MAX_ATTEMPTS_MIN)
          .max(AI_RETRY_MAX_ATTEMPTS_MAX),
        backoff_base_ms: z.number()
          .min(AI_RETRY_BACKOFF_BASE_MS_MIN)
          .max(AI_RETRY_BACKOFF_BASE_MS_MAX),
      }),
    ).optional(),
  }).optional().default({
    max_attempts: DEFAULT_AI_RETRY_MAX_ATTEMPTS,
    backoff_base_ms: DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
    timeout_per_request_ms: DEFAULT_AI_RETRY_TIMEOUT_PER_REQUEST_MS,
  }),
  /** AI timeout configuration */
  ai_timeout: z.object({
    default_ms: z.number()
      .min(AI_TIMEOUT_MS_MIN)
      .max(AI_TIMEOUT_MS_MAX)
      .default(DEFAULT_AI_TIMEOUT_MS),
    providers: z.record(
      z.string(),
      z.number()
        .min(AI_TIMEOUT_MS_MIN)
        .max(AI_TIMEOUT_MS_MAX),
    ).optional(),
  }).optional().default({
    default_ms: DEFAULT_AI_TIMEOUT_MS,
  }),
  /** Anthropic-specific configuration */
  ai_anthropic: z.object({
    api_version: z.string().default("2023-06-01"),
    default_model: z.string().default("claude-haiku-4-5-20251001"),
    max_tokens_default: z.number().positive().default(4096),
  }).optional().default({
    api_version: "2023-06-01",
    default_model: "claude-haiku-4-5-20251001",
    max_tokens_default: 4096,
  }),
  /** MCP (Model Context Protocol) server configuration */
  mcp: MCPConfigSchema.optional().default({
    enabled: DEFAULT_MCP_ENABLED,
    transport: DEFAULT_MCP_TRANSPORT,
    server_name: DEFAULT_MCP_SERVER_NAME,
    version: DEFAULT_MCP_VERSION,
  }),
  /** MCP defaults */
  mcp_defaults: z.object({
    identity_id: z.string().default(DEFAULT_MCP_IDENTITY_ID),
  }).optional().default({
    identity_id: DEFAULT_MCP_IDENTITY_ID,
  }),
  /** Request quality gate configuration (Phase 47) */
  quality_gate: z.object({
    /** Whether the quality gate runs at all. */
    enabled: z.boolean().default(true),

    /** Gate strategy: heuristic, llm, or hybrid. */
    mode: z.nativeEnum(QualityGateMode).default(QualityGateMode.HYBRID),

    /** Whether to automatically enrich requests that score between enrichment and proceed thresholds. */
    auto_enrich: z.boolean().default(true),

    /** Whether to hard-block requests deemed unactionable instead of letting them proceed. */
    block_unactionable: z.boolean().default(false),

    /** Maximum number of clarification rounds before auto-proceeding. */
    max_clarification_rounds: z.number().int().min(1).max(20)
      .default(DEFAULTS.DEFAULT_MAX_CLARIFICATION_ROUNDS),

    /** Score thresholds (0-100) controlling gate behaviour. */
    thresholds: z.object({
      minimum: z.number().int().min(0).max(100).default(DEFAULTS.DEFAULT_QG_MINIMUM_THRESHOLD),
      enrichment: z.number().int().min(0).max(100).default(DEFAULTS.DEFAULT_QG_ENRICHMENT_THRESHOLD),
      proceed: z.number().int().min(0).max(100).default(DEFAULTS.DEFAULT_QG_PROCEED_THRESHOLD),
    }).default({
      minimum: DEFAULTS.DEFAULT_QG_MINIMUM_THRESHOLD,
      enrichment: DEFAULTS.DEFAULT_QG_ENRICHMENT_THRESHOLD,
      proceed: DEFAULTS.DEFAULT_QG_PROCEED_THRESHOLD,
    }),
  }).optional().default({
    enabled: true,
    mode: QualityGateMode.HYBRID,
    auto_enrich: true,
    block_unactionable: false,
    max_clarification_rounds: DEFAULTS.DEFAULT_MAX_CLARIFICATION_ROUNDS,
    thresholds: {
      minimum: DEFAULTS.DEFAULT_QG_MINIMUM_THRESHOLD,
      enrichment: DEFAULTS.DEFAULT_QG_ENRICHMENT_THRESHOLD,
      proceed: DEFAULTS.DEFAULT_QG_PROCEED_THRESHOLD,
    },
  }),
  /** Plan amendment configuration (Phase 66) */
  amendment: z.object({
    enabled: z.boolean().default(false),
    threshold: z.number().min(0).max(100).default(DEFAULTS.DEFAULT_AMENDMENT_THRESHOLD),
    expiryMs: z.number().int().positive().default(DEFAULTS.DEFAULT_AMENDMENT_EXPIRY_MS),
    hitl_timeout_ms: z.number().int().positive().default(DEFAULTS.DEFAULT_AMENDMENT_HITL_TIMEOUT_MS),
    on_timeout: z.enum(["abort", "reject", "approve"]).default(DEFAULTS.DEFAULT_AMENDMENT_ON_TIMEOUT),
  }).optional().default({
    enabled: false,
    threshold: DEFAULTS.DEFAULT_AMENDMENT_THRESHOLD,
    expiryMs: DEFAULTS.DEFAULT_AMENDMENT_EXPIRY_MS,
    hitl_timeout_ms: DEFAULTS.DEFAULT_AMENDMENT_HITL_TIMEOUT_MS,
    on_timeout: DEFAULTS.DEFAULT_AMENDMENT_ON_TIMEOUT,
  }),
  /** Prompt budget enforcement policy overrides (Phase 62) */
  budget_enforcement: ZBudgetPolicy.optional(),
  /** Flow retry cost budget guard (Phase 63). Omit or set to 0 to disable. */
  max_flow_retry_cost_usd: z.number().min(0).optional(),
  /** Request intent analysis configuration (Phase 45) */
  request_analysis: z.object({
    /**
     * Whether request analysis runs at all.
     * Set to false to skip analysis entirely (for performance or testing).
     */
    enabled: z.boolean().default(true),

    /**
     * Analysis strategy: heuristic, llm, or hybrid.
     * Default depends on environment (usually hybrid in production).
     */
    mode: z.nativeEnum(AnalysisMode).default(AnalysisMode.HYBRID),

    /** Score (0-100) below which hybrid mode escalates to LLM. */
    actionability_threshold: z.number().int().min(0).max(100).default(60),

    /** Whether to infer acceptance criteria from imperatives. */
    infer_acceptance_criteria: z.boolean().default(true),

    /**
     * Whether to write the analysis result to a sibling `_analysis.json` file.
     * Disable to run analysis in-memory only (useful in read-only environments).
     */
    persist_analysis: z.boolean().default(true),
  }).optional().default({
    enabled: true,
    mode: AnalysisMode.HYBRID,
    actionability_threshold: 60,
    infer_acceptance_criteria: true,
    persist_analysis: true,
  }),
  /** Rate limiting configuration for cost exhaustion attack prevention */
  rate_limiting: z.object({
    enabled: z.boolean().default(DEFAULTS.DEFAULT_RATE_LIMIT_ENABLED),
    max_calls_per_minute: z.number()
      .min(DEFAULTS.RATE_LIMIT_MAX_CALLS_PER_MINUTE_MIN)
      .max(DEFAULTS.RATE_LIMIT_MAX_CALLS_PER_MINUTE_MAX)
      .default(DEFAULTS.DEFAULT_RATE_LIMIT_MAX_CALLS_PER_MINUTE),
    max_tokens_per_hour: z.number()
      .min(DEFAULTS.RATE_LIMIT_MAX_TOKENS_PER_HOUR_MIN)
      .max(DEFAULTS.RATE_LIMIT_MAX_TOKENS_PER_HOUR_MAX)
      .default(DEFAULTS.DEFAULT_RATE_LIMIT_MAX_TOKENS_PER_HOUR),
    max_cost_per_day: z.number()
      .min(DEFAULTS.RATE_LIMIT_MAX_COST_PER_DAY_MIN)
      .max(DEFAULTS.RATE_LIMIT_MAX_COST_PER_DAY_MAX)
      .default(DEFAULTS.DEFAULT_RATE_LIMIT_MAX_COST_PER_DAY),
    cost_per_1k_tokens: z.number()
      .min(DEFAULTS.RATE_LIMIT_COST_PER_1K_TOKENS_MIN)
      .max(DEFAULTS.RATE_LIMIT_COST_PER_1K_TOKENS_MAX)
      .default(DEFAULTS.DEFAULT_RATE_LIMIT_COST_PER_1K_TOKENS),
  }).optional().default({
    enabled: DEFAULTS.DEFAULT_RATE_LIMIT_ENABLED,
    max_calls_per_minute: DEFAULTS.DEFAULT_RATE_LIMIT_MAX_CALLS_PER_MINUTE,
    max_tokens_per_hour: DEFAULTS.DEFAULT_RATE_LIMIT_MAX_TOKENS_PER_HOUR,
    max_cost_per_day: DEFAULTS.DEFAULT_RATE_LIMIT_MAX_COST_PER_DAY,
    cost_per_1k_tokens: DEFAULTS.DEFAULT_RATE_LIMIT_COST_PER_1K_TOKENS,
  }),
  /** Git operations configuration */
  git: z.object({
    branch_prefix_pattern: z.string().default(DEFAULTS.DEFAULT_GIT_BRANCH_PREFIX_PATTERN),
    allowed_prefixes: z.array(z.string()).default(DEFAULTS.DEFAULT_GIT_ALLOWED_PREFIXES),
    operations: z.object({
      status_timeout_ms: z.number()
        .min(DEFAULTS.GIT_TIMEOUT_MS_MIN)
        .max(DEFAULTS.GIT_TIMEOUT_MS_MAX)
        .default(DEFAULTS.DEFAULT_GIT_STATUS_TIMEOUT_MS),
      ls_files_timeout_ms: z.number()
        .min(DEFAULTS.GIT_TIMEOUT_MS_MIN)
        .max(DEFAULTS.GIT_TIMEOUT_MS_MAX)
        .default(DEFAULTS.DEFAULT_GIT_LS_FILES_TIMEOUT_MS),
      checkout_timeout_ms: z.number()
        .min(DEFAULTS.GIT_TIMEOUT_MS_MIN)
        .max(DEFAULTS.GIT_TIMEOUT_MS_MAX)
        .default(DEFAULTS.DEFAULT_GIT_CHECKOUT_TIMEOUT_MS),
      clean_timeout_ms: z.number()
        .min(DEFAULTS.GIT_TIMEOUT_MS_MIN)
        .max(DEFAULTS.GIT_TIMEOUT_MS_MAX)
        .default(DEFAULTS.DEFAULT_GIT_CLEAN_TIMEOUT_MS),
      log_timeout_ms: z.number()
        .min(DEFAULTS.GIT_TIMEOUT_MS_MIN)
        .max(DEFAULTS.GIT_TIMEOUT_MS_MAX)
        .default(DEFAULTS.DEFAULT_GIT_LOG_TIMEOUT_MS),
      diff_timeout_ms: z.number()
        .min(DEFAULTS.GIT_TIMEOUT_MS_MIN)
        .max(DEFAULTS.GIT_TIMEOUT_MS_MAX)
        .default(DEFAULTS.DEFAULT_GIT_DIFF_TIMEOUT_MS),
      command_timeout_ms: z.number()
        .min(DEFAULTS.GIT_TIMEOUT_MS_MIN)
        .max(DEFAULTS.GIT_TIMEOUT_MS_MAX)
        .default(DEFAULTS.DEFAULT_GIT_COMMAND_TIMEOUT_MS),
      max_retries: z.number()
        .min(DEFAULTS.GIT_MAX_RETRIES_MIN)
        .max(DEFAULTS.GIT_MAX_RETRIES_MAX)
        .default(DEFAULTS.DEFAULT_GIT_MAX_RETRIES),
      retry_backoff_base_ms: z.number()
        .min(DEFAULTS.GIT_RETRY_BACKOFF_BASE_MS_MIN)
        .max(DEFAULTS.GIT_RETRY_BACKOFF_BASE_MS_MAX)
        .default(DEFAULTS.DEFAULT_GIT_RETRY_BACKOFF_BASE_MS),
      branch_name_collision_max_retries: z.number()
        .min(DEFAULTS.GIT_BRANCH_NAME_COLLISION_MAX_RETRIES_MIN)
        .max(DEFAULTS.GIT_BRANCH_NAME_COLLISION_MAX_RETRIES_MAX)
        .default(DEFAULTS.DEFAULT_GIT_BRANCH_NAME_COLLISION_MAX_RETRIES),
      trace_id_short_length: z.number()
        .min(DEFAULTS.GIT_TRACE_ID_SHORT_LENGTH_MIN)
        .max(DEFAULTS.GIT_TRACE_ID_SHORT_LENGTH_MAX)
        .default(DEFAULTS.DEFAULT_GIT_TRACE_ID_SHORT_LENGTH),
      branch_suffix_length: z.number()
        .min(DEFAULTS.GIT_BRANCH_SUFFIX_LENGTH_MIN)
        .max(DEFAULTS.GIT_BRANCH_SUFFIX_LENGTH_MAX)
        .default(DEFAULTS.DEFAULT_GIT_BRANCH_SUFFIX_LENGTH),
    }).optional().default(DEFAULT_GIT_OPERATIONS),
  }).optional().default({
    branch_prefix_pattern: DEFAULTS.DEFAULT_GIT_BRANCH_PREFIX_PATTERN,
    allowed_prefixes: DEFAULTS.DEFAULT_GIT_ALLOWED_PREFIXES,
    operations: DEFAULT_GIT_OPERATIONS,
  }),
  /** Provider strategy configuration for intelligent provider selection */
  provider_strategy: z.object({
    prefer_free: z.boolean().default(DEFAULTS.DEFAULT_PROVIDER_STRATEGY_PREFER_FREE),
    allow_local: z.boolean().default(DEFAULTS.DEFAULT_PROVIDER_STRATEGY_ALLOW_LOCAL),
    max_daily_cost_usd: z.number()
      .min(DEFAULTS.PROVIDER_STRATEGY_MAX_DAILY_COST_USD_MIN)
      .max(DEFAULTS.PROVIDER_STRATEGY_MAX_DAILY_COST_USD_MAX)
      .default(DEFAULTS.DEFAULT_PROVIDER_STRATEGY_MAX_DAILY_COST_USD),
    health_check_enabled: z.boolean().default(DEFAULTS.DEFAULT_PROVIDER_STRATEGY_HEALTH_CHECK_ENABLED),
    fallback_enabled: z.boolean().default(DEFAULTS.DEFAULT_PROVIDER_STRATEGY_FALLBACK_ENABLED),
    fallback_chains: z.record(z.array(z.string()))
      .default(DEFAULTS.DEFAULT_PROVIDER_STRATEGY_FALLBACK_CHAINS),
    budgets: z.record(z.number().min(DEFAULTS.PROVIDER_STRATEGY_BUDGETS_MIN)).optional(),
    task_routing: z.record(z.array(z.string())).optional(),
  }).optional().default({
    prefer_free: DEFAULTS.DEFAULT_PROVIDER_STRATEGY_PREFER_FREE,
    allow_local: DEFAULTS.DEFAULT_PROVIDER_STRATEGY_ALLOW_LOCAL,
    max_daily_cost_usd: DEFAULTS.DEFAULT_PROVIDER_STRATEGY_MAX_DAILY_COST_USD,
    health_check_enabled: DEFAULTS.DEFAULT_PROVIDER_STRATEGY_HEALTH_CHECK_ENABLED,
    fallback_enabled: DEFAULTS.DEFAULT_PROVIDER_STRATEGY_FALLBACK_ENABLED,
  }),
  routing: RoutingConfigSchema,
  /** Provider-specific configuration overrides */
  providers: z.record(z.object({
    cost_tier: z.nativeEnum(ProviderCostTier).optional(),
    free_quota_requests_per_day: z.number()
      .min(DEFAULTS.PROVIDER_FREE_QUOTA_REQUESTS_PER_DAY_MIN)
      .optional(),
    base_url: z.string().optional(),
    timeout_ms: z.number()
      .min(DEFAULTS.PROVIDER_TIMEOUT_MS_MIN)
      .max(DEFAULTS.PROVIDER_TIMEOUT_MS_MAX)
      .optional(),
    rate_limit_rpm: z.number()
      .min(DEFAULTS.PROVIDER_RATE_LIMIT_RPM_MIN)
      .max(DEFAULTS.PROVIDER_RATE_LIMIT_RPM_MAX)
      .optional(),
  })).optional().default({}),
  /** Mock provider configuration */
  mock: z.object({
    delay_ms: z.number()
      .min(MOCK_DELAY_MS_MIN)
      .max(MOCK_DELAY_MS_MAX)
      .default(MOCK_DELAY_MS),
    input_tokens: z.number()
      .min(MOCK_INPUT_TOKENS_MIN)
      .max(MOCK_INPUT_TOKENS_MAX)
      .default(MOCK_INPUT_TOKENS),
    output_tokens: z.number()
      .min(MOCK_OUTPUT_TOKENS_MIN)
      .max(MOCK_OUTPUT_TOKENS_MAX)
      .default(MOCK_OUTPUT_TOKENS),
  }).optional().default({
    delay_ms: MOCK_DELAY_MS,
    input_tokens: MOCK_INPUT_TOKENS,
    output_tokens: MOCK_OUTPUT_TOKENS,
  }),
  /** UI/Preview configuration */
  ui: z.object({
    prompt_preview_length: z.number()
      .min(DEFAULTS.PROMPT_PREVIEW_LENGTH_MIN)
      .max(DEFAULTS.PROMPT_PREVIEW_LENGTH_MAX)
      .default(DEFAULTS.PROMPT_PREVIEW_LENGTH),
    prompt_preview_extended: z.number()
      .min(DEFAULTS.PROMPT_PREVIEW_EXTENDED_MIN)
      .max(DEFAULTS.PROMPT_PREVIEW_EXTENDED_MAX)
      .default(DEFAULTS.PROMPT_PREVIEW_EXTENDED),
  }).optional().default({
    prompt_preview_length: DEFAULTS.PROMPT_PREVIEW_LENGTH,
    prompt_preview_extended: DEFAULTS.PROMPT_PREVIEW_EXTENDED,
  }),
  /** Cost tracking configuration */
  cost_tracking: z.object({
    batch_delay_ms: z.number()
      .min(DEFAULTS.COST_TRACKING_BATCH_DELAY_MS_MIN)
      .max(DEFAULTS.COST_TRACKING_BATCH_DELAY_MS_MAX)
      .default(DEFAULTS.DEFAULT_COST_TRACKING_BATCH_DELAY_MS),
    max_batch_size: z.number()
      .min(DEFAULTS.COST_TRACKING_MAX_BATCH_SIZE_MIN)
      .max(DEFAULTS.COST_TRACKING_MAX_BATCH_SIZE_MAX)
      .default(DEFAULTS.DEFAULT_COST_TRACKING_MAX_BATCH_SIZE),
    rates: z.record(
      z.string(),
      z.number()
        .min(DEFAULTS.COST_TRACKING_RATES_MIN)
        .max(DEFAULTS.COST_TRACKING_RATES_MAX),
    ).optional().default(DEFAULT_COST_TRACKING_RATES),
  }).optional().default({
    batch_delay_ms: DEFAULTS.DEFAULT_COST_TRACKING_BATCH_DELAY_MS,
    max_batch_size: DEFAULTS.DEFAULT_COST_TRACKING_MAX_BATCH_SIZE,
    rates: DEFAULT_COST_TRACKING_RATES,
  }),
  /** Health check configuration */
  health: z.object({
    check_timeout_ms: z.number()
      .min(DEFAULTS.HEALTH_CHECK_TIMEOUT_MS_MIN)
      .max(DEFAULTS.HEALTH_CHECK_TIMEOUT_MS_MAX)
      .default(DEFAULTS.DEFAULT_HEALTH_CHECK_TIMEOUT_MS),
    cache_ttl_ms: z.number()
      .min(DEFAULTS.HEALTH_CACHE_TTL_MS_MIN)
      .max(DEFAULTS.HEALTH_CACHE_TTL_MS_MAX)
      .default(DEFAULTS.DEFAULT_HEALTH_CACHE_TTL_MS),
    poll_interval_ms: z.number().int().positive().default(DEFAULTS.DEFAULT_HEALTH_POLL_INTERVAL_MS),
    memory_warn_percent: z.number()
      .min(DEFAULTS.HEALTH_MEMORY_WARN_PERCENT_MIN)
      .max(DEFAULTS.HEALTH_MEMORY_WARN_PERCENT_MAX)
      .default(DEFAULTS.DEFAULT_MEMORY_WARN_PERCENT),
    memory_critical_percent: z.number()
      .min(DEFAULTS.HEALTH_MEMORY_CRITICAL_PERCENT_MIN)
      .max(DEFAULTS.HEALTH_MEMORY_CRITICAL_PERCENT_MAX)
      .default(DEFAULTS.DEFAULT_MEMORY_CRITICAL_PERCENT),
  }).optional().default({
    check_timeout_ms: DEFAULTS.DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
    cache_ttl_ms: DEFAULTS.DEFAULT_HEALTH_CACHE_TTL_MS,
    poll_interval_ms: DEFAULTS.DEFAULT_HEALTH_POLL_INTERVAL_MS,
    memory_warn_percent: DEFAULTS.DEFAULT_MEMORY_WARN_PERCENT,
    memory_critical_percent: DEFAULTS.DEFAULT_MEMORY_CRITICAL_PERCENT,
  }),
  /** Portal codebase knowledge gathering configuration (Phase 46) */
  portal_knowledge: z.object({
    /** Automatically trigger knowledge analysis after portal mount. */
    auto_analyze_on_mount: z.boolean().default(true),
    /** Default analysis depth when not overridden per-call. */
    default_mode: z.nativeEnum(PortalAnalysisMode)
      .default(DEFAULTS.DEFAULT_PORTAL_KNOWLEDGE_MODE as PortalAnalysisMode),
    /** Maximum files to stat/list in quick scan mode. */
    quick_scan_limit: z.number().int().min(1)
      .default(DEFAULTS.DEFAULT_QUICK_SCAN_LIMIT),
    /** Maximum files to read content from during analysis. */
    max_files_to_read: z.number().int().min(1)
      .default(DEFAULTS.DEFAULT_MAX_FILES_TO_READ),
    /** Hours before cached knowledge is considered stale. */
    staleness_hours: z.number().positive()
      .default(DEFAULTS.DEFAULT_KNOWLEDGE_STALENESS_HOURS),
    /** Whether to use an LLM call for architecture inference. */
    use_llm_inference: z.boolean().default(true),
    /** Directory/file patterns to skip during analysis. */
    ignore_patterns: z.array(z.string())
      .default(DEFAULTS.DEFAULT_IGNORE_PATTERNS),
    /** Whether to send request text to embedding service for relevance search (opt-in, default false). */
    relevance_search_embedding_enabled: z.boolean().optional().default(false),
  }).optional().default({
    auto_analyze_on_mount: true,
    default_mode: DEFAULTS.DEFAULT_PORTAL_KNOWLEDGE_MODE as PortalAnalysisMode,
    quick_scan_limit: DEFAULTS.DEFAULT_QUICK_SCAN_LIMIT,
    max_files_to_read: DEFAULTS.DEFAULT_MAX_FILES_TO_READ,
    staleness_hours: DEFAULTS.DEFAULT_KNOWLEDGE_STALENESS_HOURS,
    use_llm_inference: true,
    ignore_patterns: DEFAULTS.DEFAULT_IGNORE_PATTERNS,
    relevance_search_embedding_enabled: false,
  }),
  /** Tokenizer backend configuration (Phase 103) */
  tokenizer: z.object({
    backend: z.enum([TokenizerBackend.AUTO, TokenizerBackend.LOCAL, TokenizerBackend.API])
      .default(TokenizerBackend.AUTO),
  }).optional().default({ backend: TokenizerBackend.AUTO }),
  /** Execution configuration (Phase 103) */
  execution: z.object({
    /** Model to use for step summarization. Falls back to agent provider if unset. */
    summarization_model: z.string().optional(),
  }).optional().default({ summarization_model: undefined }),
}).superRefine((data, ctx: z.RefinementCtx) => {
  // Type assertion to avoid circular reference
  const configData = data as z.infer<typeof ConfigSchema>;

  // Validate that default_model exists in models keys or is a fallback chain
  const modelKeys = Object.keys(configData.models || {});
  const fallbackChainKeys = Object.keys(configData.provider_strategy?.fallback_chains || {});
  const providerTypes = [
    PROVIDER_OLLAMA,
    PROVIDER_ANTHROPIC,
    PROVIDER_OPENAI,
    PROVIDER_GOOGLE,
    PROVIDER_MOCK,
  ];
  const allAvailable = [...modelKeys, ...fallbackChainKeys, ...providerTypes, DEFAULTS.DEFAULT_AGENT_MODEL];

  if (data.agents?.default_model && !allAvailable.includes(data.agents.default_model)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        `default_model '${data.agents.default_model}' not found in [models] or [provider_strategy.fallback_chains]`,
      path: ["agents", "default_model"],
    });
  }

  // Validate fallback chains point to valid models or fallback chains
  if (data.provider_strategy?.fallback_chains) {
    for (
      const [chainName, chain] of Object.entries(data.provider_strategy.fallback_chains as Record<string, string[]>)
    ) {
      chain.forEach((target: string, index: number) => {
        // A target in a fallback chain can be another model or a global provider name (though models are preferred)
        if (!allAvailable.includes(target)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Fallback chain '${chainName}' contains unknown target '${target}' at index ${index}`,
            path: ["provider_strategy", "fallback_chains", chainName, index],
          });
        }
      });
    }
  }
});
