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
import { ProviderType, TaskType, TokenizerBackend } from "@exaix/core";
import {
  DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
  DEFAULT_AI_RETRY_MAX_ATTEMPTS,
  DEFAULT_AI_RETRY_TIMEOUT_PER_REQUEST_MS,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_FAST_MODEL_NAME,
  DEFAULT_LOCAL_MODEL_NAME,
  MOCK_DELAY_MS,
  MOCK_INPUT_TOKENS,
  MOCK_OUTPUT_TOKENS,
  PROVIDER_ANTHROPIC,
  PROVIDER_GOOGLE,
  PROVIDER_MOCK,
  PROVIDER_OLLAMA,
  PROVIDER_OPENAI,
  PROVIDER_OPENROUTER,
  PROVIDER_VERTEX,
} from "@exaix/core";
import { resolveConfigurableBounds } from "@exaix/core/config";
import {
  DEFAULT_MCP_AUTH_TOKEN_EXPIRY_SECONDS,
  DEFAULT_MCP_ENABLED,
  DEFAULT_MCP_IDENTITY_ID,
  DEFAULT_MCP_REQUIRE_AUTH,
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
import { GuardrailConfigSchema } from "./guardrail.ts";
import { CliDelegateConfigSchema, SessionDelegateConfigSchema } from "./session_delegate.ts";
import { HitlRuleSchema } from "./hitl.ts";

export interface IPortalConfig {
  alias: string;
  target_path: string;
  description?: string;
  default_branch?: string;
  execution_strategy?: string;
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

/**
 * Build a z.number() schema from a configurable key's registered metadata.
 * Reads min/max/default from the registry at module-eval time, eliminating
 * the need for separate MIN/MAX named constants.
 */
function c(key: string): z.ZodDefault<z.ZodNumber> {
  const { min, max, default: def } = resolveConfigurableBounds(key);
  let s: z.ZodNumber = z.number();
  if (min !== undefined) s = s.min(min);
  if (max !== undefined) s = s.max(max);
  return s.default(def as number);
}

/**
 * Build a z.number() schema with only min/max bounds (no default).
 * Used for nested provider-override schemas inside z.record().
 */
function cBounds(key: string): z.ZodNumber {
  const { min, max } = resolveConfigurableBounds(key);
  let s: z.ZodNumber = z.number();
  if (min !== undefined) s = s.min(min);
  if (max !== undefined) s = s.max(max);
  return s;
}

const DEFAULT_COST_TRACKING_RATES: Record<string, number> = {
  [PROVIDER_OPENAI]: DEFAULTS.COST_RATE_OPENAI,
  [PROVIDER_ANTHROPIC]: DEFAULTS.COST_RATE_ANTHROPIC,
  [PROVIDER_GOOGLE]: DEFAULTS.COST_RATE_GOOGLE,
  [PROVIDER_VERTEX]: DEFAULTS.COST_RATE_VERTEX,
  [PROVIDER_OPENROUTER]: DEFAULTS.COST_RATE_OPENROUTER,
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
}).optional().prefault({});

/**
 * Phase 135 — Team live model-registry block. Opt-in (`enabled` master gate);
 * absent by default so a Solo daemon is byte-identical to Phase 134. Later steps
 * (5/6/7/8) extend this block with route-policy, benchmark, and task-type fields
 * as their features land. Stays `.optional()`: Solo reads of nested fields use a
 * constant fallback (GAP-6, wired in Step 2).
 */
/** §5.8 benchmark ingest fetch timeout — models.dev is larger than a catalog GET. */
const DEFAULT_BENCHMARK_FETCH_TIMEOUT_MS = 30_000;
/** Canonical tracked-benchmark names (§5.8), shared across the defaults below. */
const SWE_BENCH_VERIFIED = "swe_bench_verified";
const SWE_BENCH_PRO = "swe_bench_pro";
const GPQA = "gpqa";
/** §5.8.4 (GAP-B) default task-type → ranking-benchmark(s) map the `best` scorer reads. */
const DEFAULT_BENCHMARK_MAP: Record<string, string[]> = {
  [TaskType.FEATURE]: [SWE_BENCH_VERIFIED],
  [TaskType.BUGFIX]: [SWE_BENCH_VERIFIED],
  [TaskType.REFACTOR]: [SWE_BENCH_VERIFIED, SWE_BENCH_PRO],
  [TaskType.TEST]: [SWE_BENCH_VERIFIED],
  [TaskType.ANALYSIS]: [GPQA],
};

export const ModelRegistryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  catalog_refresh_cron: z.string().default("0 */6 * * *"),
  pricing_refresh_cron: z.string().default("0 3 * * *"),
  price_staleness_max_days: z.number().int().positive().default(90),
  refresh_timeout_ms: z.number().int().positive().default(15000),
  refresh_on_start: z.boolean().default(false),
  // §5.9 (F12) admission bounds — read by the Step 5 refresh scheduler when it builds
  // per-provider admission inputs. top_n is defined but inert until Step 7's benchmarks.
  admission: z.object({
    top_n: z.number().int().positive().default(25),
    keep_native_whole: z.boolean().default(true),
  }).prefault({}),
  // §5.7 (F9 + G4) multi-route selection — read by the Step 6 route sub-step (Team).
  route_policy: z.enum(["cheapest", "reliability", "native_first", "user_order"]).default("cheapest"),
  // Near-tie fraction under `cheapest`: routes within this of the cheapest are health-broken.
  route_policy_price_tolerance: z.number().min(0).default(0.05),
  // G4: per-model provider order for `user_order` (model → provider list). Empty ⇒ cheapest.
  route_order: z.record(z.string(), z.array(z.string())).default({}),
  // §5.8 (F13/G8) benchmark data plane — opt-in models.dev ingest read by the Step 7
  // scheduler benchmark pass. Double-gated: enabled AND model_registry.enabled.
  // G8 data-license: models.dev is MIT-licensed, community-maintained.
  benchmark_source: z.object({
    enabled: z.boolean().default(true),
    dataset_url: z.string().default("https://models.dev/models.json"),
    // §5.9 (GAP-A) widened beyond swe_bench_verified so "any tracked benchmark"
    // top-N admission and the Step 8 best scorer are genuinely exercisable.
    tracked_benchmarks: z.array(z.string()).default([SWE_BENCH_VERIFIED, SWE_BENCH_PRO, GPQA]),
    refresh_cron: z.string().default("0 5 * * 0"), // weekly
    fetch_timeout_ms: z.number().int().positive().default(DEFAULT_BENCHMARK_FETCH_TIMEOUT_MS),
  }).prefault({}),
  // §5.5.2 (Solo-read, D9): tolerance (percent) for reported-vs-computed cost
  // divergence before emitting model.cost.divergence.
  cost_divergence_tolerance_pct: z.number().min(0).default(5),
  // §5.8.4 (GAP-B) — task-type → ranking benchmark(s), canonical TaskType keys only (G7).
  // Read by the Step 8 `best` scorer (IResolutionStrategy.scoreBest).
  benchmark_map: z.record(z.nativeEnum(TaskType), z.array(z.string())).default(DEFAULT_BENCHMARK_MAP),
  // §5.8.8 — entity name → TaskType soft-match fallback for task-type derivation.
  // Never shadows an entity's own declaration (anti-drift). Canonical values only (G7).
  task_type_map: z.record(z.string(), z.nativeEnum(TaskType)).default({}),
  // F8 opt-in — last-resort MFU/MRU usage tiebreak (IResolutionStrategy.rankUsage).
  usage_tiebreak: z.boolean().default(false),
  // GAP-C9 (Step 9) — per-provider catalog-adapter base URL override, read by
  // apps/daemon/src/bootstrap_team.ts:createBuildContext. Test-only seam: lets a real
  // daemon boot point its adapters at local stub HTTP servers instead of the vendor
  // hosts. Empty by default — production never overrides a vendor base URL.
  adapter_base_urls: z.record(z.string(), z.string()).default({}),
}).optional();

/**
 * Phase 132 ModelPreset — capability profile for model_size-based selection.
 */
export const ModelPresetSchema = z.object({
  max_cost_per_mtok: z.number().min(0),
  min_context_window: z.number().int().min(1),
  supports_thinking: z.boolean(),
  candidates: z.array(z.string()).optional(),
  characteristics: z.record(z.string(), z.array(z.string())).optional(),
});

export type ModelPreset = z.infer<typeof ModelPresetSchema>;

export const DEFAULT_MODEL_PRESETS: Record<string, ModelPreset> = {
  S: { max_cost_per_mtok: 0.5, min_context_window: 8_192, supports_thinking: false },
  M: { max_cost_per_mtok: 3, min_context_window: 32_000, supports_thinking: true },
  L: { max_cost_per_mtok: 15, min_context_window: 128_000, supports_thinking: true },
  XL: { max_cost_per_mtok: 75, min_context_window: 200_000, supports_thinking: true },
};

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
  }).prefault({}),

  // Search limits
  grep_search: z.object({
    max_results: z.number().default(50),
    exclude_dirs: z.array(z.string()).default([".git", "node_modules", "dist", "coverage"]),
  }).prefault({}),

  // Tool confirmation interceptor timeout (Phase 79 — seconds; min 10, max 3600; fallback: DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S)
  confirmation_timeout_s: z.number().min(10).max(3600).optional(),
});

export const ConfigSchema = z.object({
  tools: ToolsConfigSchema.optional().prefault({}),
  system: z.object({
    root: z.string().default(getCwdSafe()),
    log_level: z.nativeEnum(LogLevel).default(LogLevel.INFO),
    version: z.string().optional(),
    schema_version: z.string().default(WORKSPACE_SCHEMA_VERSION),
    allow_net: z.array(
      z.string().regex(/^[\w.-]+(:\d+)?$/, "Must be a hostname or IP with optional :port"),
    )
      .describe("Host:port entries for outbound network access; empty array blocks all, omitted = default list")
      .optional(),
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
    flows: z.string().default(DEFAULTS.ExaPathDefaults.flows),
    waitStates: z.string().default(DEFAULTS.DEFAULT_WAIT_STATES_PATH),
    memoryProjects: z.string().default(DEFAULTS.ExaPathDefaults.memoryProjects),
    memoryExecution: z.string().default(DEFAULTS.ExaPathDefaults.memoryExecution),
    memoryIndex: z.string().default(DEFAULTS.ExaPathDefaults.memoryIndex),
    memorySkills: z.string().default(DEFAULTS.ExaPathDefaults.memorySkills),
    memoryPending: z.string().default(DEFAULTS.ExaPathDefaults.memoryPending),
    memoryTasks: z.string().default(DEFAULTS.ExaPathDefaults.memoryTasks),
    memoryGlobal: z.string().default(DEFAULTS.ExaPathDefaults.memoryGlobal),
  }).prefault({}),
  database: z.object({
    batch_flush_ms: c("database.batch_flush_ms"),
    batch_max_size: c("database.batch_max_size"),
    path: z.string().optional(),
    sqlite: z.object({
      journal_mode: z.nativeEnum(SqliteJournalMode)
        .default(DEFAULTS.DEFAULT_DATABASE_JOURNAL_MODE as SqliteJournalMode),
      foreign_keys: z.boolean().default(DEFAULTS.DEFAULT_DATABASE_FOREIGN_KEYS),
      busy_timeout_ms: c("database.busy_timeout_ms"),
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
    debounce_ms: c("watcher.debounce_ms"),
    stability_check: z.boolean().default(DEFAULTS.DEFAULT_WATCHER_STABILITY_CHECK),
  }).default({
    debounce_ms: DEFAULTS.DEFAULT_WATCHER_DEBOUNCE_MS,
    stability_check: DEFAULTS.DEFAULT_WATCHER_STABILITY_CHECK,
  }),
  agents: z.object({
    default_model: z.string().default(DEFAULTS.DEFAULT_AGENT_MODEL),
    timeout_sec: c("agent.timeout_sec"),
    max_iterations: c("agent.max_iterations"),
    inject_aci_docs: z.boolean().default(DEFAULTS.DEFAULT_AGENT_INJECT_ACI_DOCS),
    aci_doc_prompt_max_chars: c("agent.aci_doc_prompt_max_chars"),
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
        .min(resolveConfigurableBounds("agent.max_iterations").min!)
        .max(resolveConfigurableBounds("agent.max_iterations").max!)
        .default(DEFAULTS.DEFAULT_AGENT_MAX_ITERATIONS),
      complexity_scale_factor: z.number().min(0).max(3)
        .default(1.0),
      absolute_max_iterations: z.number().int().min(1).max(20)
        .default(DEFAULTS.DEFAULT_REFLEXIVE_CONVERGENCE_ABSOLUTE_MAX_ITERATIONS),
      score_every_n_iterations: z.number().int().min(1).max(5)
        .default(DEFAULTS.DEFAULT_REFLEXIVE_CONVERGENCE_SCORE_EVERY_N_ITERATIONS),
    }).optional().prefault({}),
  }).prefault({
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
    }).prefault({}),
    embedding: z.object({
      provider: z.nativeEnum(ProviderType).default(ProviderType.OLLAMA),
      model: z.string().default("nomic-embed-text"),
      dimension: z.number().int().positive().default(768),
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      chunkSize: z.number().int().min(1).max(100).optional(),
      timeoutMs: z.number().int().positive().optional(),
    }).optional(),
  }).optional().prefault({}),
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
  models: z.record(
    z.string(),
    z.object({
      provider: ProviderTypeSchema,
      model: z.string(),
      timeout_ms: z.number().positive().optional(),
      max_tokens: z.number().positive().optional(),
      temperature: z.number()
        .min(resolveConfigurableBounds("ai.temperature_min").min!)
        .max(resolveConfigurableBounds("ai.temperature_max").max!)
        .optional(),
      base_url: z.string().optional(),
    }),
  ).default({
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
  /** Phase 132 — capability presets keyed by model_size (S/M/L/XL). */
  model_presets: z.record(z.string(), ModelPresetSchema).default(DEFAULT_MODEL_PRESETS),
  /** AI provider endpoints configuration */
  ai_endpoints: z.record(z.string(), z.string()).optional().default({}),
  /** AI retry configuration */
  ai_retry: z.object({
    max_attempts: c("ai.retry.max_attempts"),
    backoff_base_ms: c("ai.retry.backoff_base_ms"),
    timeout_per_request_ms: c("ai.retry.timeout_per_request_ms"),
    providers: z.record(
      z.string(),
      z.object({
        max_attempts: cBounds("ai.retry.max_attempts"),
        backoff_base_ms: cBounds("ai.retry.backoff_base_ms"),
      }),
    ).optional(),
  }).optional().default({
    max_attempts: DEFAULT_AI_RETRY_MAX_ATTEMPTS,
    backoff_base_ms: DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
    timeout_per_request_ms: DEFAULT_AI_RETRY_TIMEOUT_PER_REQUEST_MS,
  }),
  /** AI timeout configuration */
  ai_timeout: z.object({
    default_ms: c("ai.timeout_ms"),
    providers: z.record(
      z.string(),
      cBounds("ai.timeout_ms"),
    ).optional(),
  }).optional().default({
    default_ms: DEFAULT_AI_TIMEOUT_MS,
  }),
  /** Anthropic-specific configuration */
  ai_anthropic: z.object({
    api_version: z.string().default("2023-06-01"),
    default_model: z.string().default("claude-haiku-4-5-20251001"),
    max_tokens_default: z.number().positive().default(4096),
    /**
     * When false, disable the model's default adaptive thinking on every call that
     * does not set a per-call thinking option. Undefined leaves the API default
     * (adaptive thinking) untouched.
     */
    thinking_default: z.boolean().optional(),
  }).optional().default({
    api_version: "2023-06-01",
    default_model: "claude-haiku-4-5-20251001",
    max_tokens_default: 4096,
  }),
  /** Google Vertex AI provider options (service-account auth, regional endpoints) */
  ai_vertex: z.object({
    service_account_env: z.string().default("VERTEX_AI_SERVICE_ACCOUNT"),
    region: z.string().default("us-central1"),
  }).optional().default({
    service_account_env: "VERTEX_AI_SERVICE_ACCOUNT",
    region: "us-central1",
  }),
  /** OpenRouter unified-gateway provider options (API key + ranking headers + routing). */
  ai_openrouter: z.object({
    api_key_env: z.string().default("OPENROUTER_API_KEY"),
    site_name: z.string().default("Exaix"),
    site_url: z.string().url().default("https://exaix.dev"),
    /** Control-surface passthrough: model fallbacks, provider routing, privacy (Phase 123 R10). */
    routing: z.object({
      models: z.array(z.string()).max(3).optional(),
      provider: z.object({
        order: z.array(z.string()).optional(),
        only: z.array(z.string()).optional(),
        ignore: z.array(z.string()).optional(),
        sort: z.enum(["throughput", "latency", "cost"]).optional(),
        max_price: z.object({
          prompt: z.number().nonnegative().optional(),
          completion: z.number().nonnegative().optional(),
          request: z.number().nonnegative().optional(),
          image: z.number().nonnegative().optional(),
        }).optional(),
      }).optional(),
      zdr: z.boolean().optional(),
      data_collection: z.enum(["allow", "deny"]).optional(),
    }).optional(),
  }).optional().default({
    api_key_env: "OPENROUTER_API_KEY",
    site_name: "Exaix",
    site_url: "https://exaix.dev",
  }),
  /** MCP (Model Context Protocol) server configuration */
  mcp: MCPConfigSchema.optional().default({
    enabled: DEFAULT_MCP_ENABLED,
    transport: DEFAULT_MCP_TRANSPORT,
    server_name: DEFAULT_MCP_SERVER_NAME,
    version: DEFAULT_MCP_VERSION,
    require_auth: DEFAULT_MCP_REQUIRE_AUTH,
    auth_token_env: "MCP_AUTH_TOKEN",
    auth_token_expiry_seconds: DEFAULT_MCP_AUTH_TOKEN_EXPIRY_SECONDS,
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
    max_calls_per_minute: c("rate_limit.max_calls_per_minute"),
    max_tokens_per_hour: c("rate_limit.max_tokens_per_hour"),
    max_cost_per_day: c("rate_limit.max_cost_per_day"),
    cost_per_1k_tokens: c("rate_limit.cost_per_1k_tokens"),
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
      max_retries: c("git.max_retries"),
      retry_backoff_base_ms: c("git.retry_backoff_base_ms"),
      branch_name_collision_max_retries: c("git.branch_collision_max_retries"),
      trace_id_short_length: c("git.trace_id_short_length"),
      branch_suffix_length: c("git.branch_suffix_length"),
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
    max_daily_cost_usd: c("provider_strategy.max_daily_cost_usd"),
    health_check_enabled: z.boolean().default(DEFAULTS.DEFAULT_PROVIDER_STRATEGY_HEALTH_CHECK_ENABLED),
    fallback_enabled: z.boolean().default(DEFAULTS.DEFAULT_PROVIDER_STRATEGY_FALLBACK_ENABLED),
    fallback_chains: z.record(z.string(), z.array(z.string()))
      .default(DEFAULTS.DEFAULT_PROVIDER_STRATEGY_FALLBACK_CHAINS),
    budgets: z.record(z.string(), z.number().min(DEFAULTS.PROVIDER_STRATEGY_BUDGETS_MIN)).optional(),
    task_routing: z.record(z.string(), z.array(z.string())).optional(),
    /** Phase 132 — rate-limit headroom weight for provider scoring. 0=disabled, 1=max influence. */
    rate_limit_weight: z.number().min(0).max(1).default(0),
  }).optional().prefault({
    prefer_free: DEFAULTS.DEFAULT_PROVIDER_STRATEGY_PREFER_FREE,
    allow_local: DEFAULTS.DEFAULT_PROVIDER_STRATEGY_ALLOW_LOCAL,
    max_daily_cost_usd: DEFAULTS.DEFAULT_PROVIDER_STRATEGY_MAX_DAILY_COST_USD,
    health_check_enabled: DEFAULTS.DEFAULT_PROVIDER_STRATEGY_HEALTH_CHECK_ENABLED,
    fallback_enabled: DEFAULTS.DEFAULT_PROVIDER_STRATEGY_FALLBACK_ENABLED,
    rate_limit_weight: 0,
  }),
  routing: RoutingConfigSchema,
  /** Phase 135 — optional Team live model-registry block. Disabled by default. */
  model_registry: ModelRegistryConfigSchema,
  /** Phase 106 — optional session-delegation block (global scope). */
  session_delegate: SessionDelegateConfigSchema.optional(),
  /** Optional per-step CLI-delegate execution block (headless claude/opencode as an IExecutionStrategy). */
  cli_delegate: CliDelegateConfigSchema.optional(),
  /** Phase 107 — optional guardrail block. Disabled by default (enabled: false). */
  guardrail: GuardrailConfigSchema.optional(),
  /**
   * Per-action HITL governance (Phase 118).
   * Distinct from `amendment.hitl_timeout_ms` — this governs per-tool action policy,
   * not plan-amendment approval.
   */
  hitl: z.object({
    enabled: z.boolean().default(false),
    mandatory_rules: z.array(HitlRuleSchema).default([]),
  }).default({
    enabled: false,
    mandatory_rules: [],
  }),
  /** Provider-specific configuration overrides */
  providers: z.record(
    z.string(),
    z.object({
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
    }),
  ).optional().default({}),
  /** Mock provider configuration */
  mock: z.object({
    delay_ms: c("mock.delay_ms"),
    input_tokens: c("mock.input_tokens"),
    output_tokens: c("mock.output_tokens"),
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
    batch_delay_ms: c("cost_tracking.batch_delay_ms"),
    max_batch_size: c("cost_tracking.max_batch_size"),
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
    check_timeout_ms: c("health.check_timeout_ms"),
    cache_ttl_ms: c("health.cache_ttl_ms"),
    poll_interval_ms: z.number().int().positive().default(DEFAULTS.DEFAULT_HEALTH_POLL_INTERVAL_MS),
    memory_warn_percent: c("health.memory_warn_percent"),
    memory_critical_percent: c("health.memory_critical_percent"),
  }).optional().default({
    check_timeout_ms: DEFAULTS.DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
    cache_ttl_ms: DEFAULTS.DEFAULT_HEALTH_CACHE_TTL_MS,
    poll_interval_ms: DEFAULTS.DEFAULT_HEALTH_POLL_INTERVAL_MS,
    memory_warn_percent: DEFAULTS.DEFAULT_MEMORY_WARN_PERCENT,
    memory_critical_percent: DEFAULTS.DEFAULT_MEMORY_CRITICAL_PERCENT,
  }),
  /** Portal codebase knowledge gathering configuration (Phase 119) */
  portal_knowledge: z.object({
    /** Whether request-time portal knowledge resolution/injection runs at all (Phase 143 ablation switch; default on, off disables the request-side injection only). */
    injection_enabled: z.boolean().default(true),
    /** Automatically trigger knowledge analysis after portal mount. */
    auto_analyze_on_mount: z.boolean().default(false),
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
    /** Maximum files to sample for PatternDetector content analysis. */
    max_pattern_detector_sample_size: z.number().int().min(1).optional()
      .default(DEFAULTS.DEFAULT_MAX_PATTERN_DETECTOR_SAMPLE_SIZE),
    /** Minimum files to sample for PatternDetector content analysis. */
    min_pattern_detector_sample_size: z.number().int().min(1).optional()
      .default(DEFAULTS.DEFAULT_MIN_PATTERN_DETECTOR_SAMPLE_SIZE),
    /** Whether to run AST-level analysis in standard/deep modes. */
    enable_ast_analysis: z.boolean().optional().default(true),
    /** Whether to run test execution analysis (deep mode only, opt-in). */
    enable_test_execution: z.boolean().optional().default(false),
    /** Whether to run dependency vulnerability scan (deep mode only, opt-in). */
    enable_vulnerability_scan: z.boolean().optional().default(false),
    /** Whether to run git history analysis in standard/deep modes. */
    enable_git_history_analysis: z.boolean().optional().default(true),
    /** Max commits to analyze in git history. */
    git_history_commit_limit: z.number().int().min(1).optional()
      .default(DEFAULTS.GIT_HISTORY_COMMIT_LIMIT),
    /** Git since filter (e.g. "1.year", "30.days"). */
    git_history_since: z.string().optional().default(DEFAULTS.GIT_HISTORY_SINCE),
  }).optional().default({
    injection_enabled: true,
    auto_analyze_on_mount: false,
    default_mode: DEFAULTS.DEFAULT_PORTAL_KNOWLEDGE_MODE as PortalAnalysisMode,
    quick_scan_limit: DEFAULTS.DEFAULT_QUICK_SCAN_LIMIT,
    max_files_to_read: DEFAULTS.DEFAULT_MAX_FILES_TO_READ,
    staleness_hours: DEFAULTS.DEFAULT_KNOWLEDGE_STALENESS_HOURS,
    use_llm_inference: true,
    ignore_patterns: DEFAULTS.DEFAULT_IGNORE_PATTERNS,
    relevance_search_embedding_enabled: false,
    max_pattern_detector_sample_size: DEFAULTS.DEFAULT_MAX_PATTERN_DETECTOR_SAMPLE_SIZE,
    min_pattern_detector_sample_size: DEFAULTS.DEFAULT_MIN_PATTERN_DETECTOR_SAMPLE_SIZE,
    enable_ast_analysis: true,
    enable_test_execution: false,
    enable_vulnerability_scan: false,
    enable_git_history_analysis: true,
    git_history_commit_limit: DEFAULTS.GIT_HISTORY_COMMIT_LIMIT,
    git_history_since: DEFAULTS.GIT_HISTORY_SINCE,
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
    /** Whether semantic progress milestone streaming is enabled (Phase 92) */
    milestone_streaming_enabled: z.boolean().default(DEFAULTS.DEFAULT_MILESTONE_STREAMING_ENABLED),
    /** Optional: file path for milestone NDJSON journal (Phase 92 E2E test / debugging). */
    milestone_journal_path: z.string().optional(),
    /** Opt in to provider-enforced native tool selection (Anthropic + ReActLoopStrategy).
     *  When true and the provider supports it, ReActLoopStrategy uses native tool_choice
     *  instead of TOML-block prose. Defaults to false. */
    native_tools_enabled: z.boolean().optional().default(false),
  }).optional().prefault({ summarization_model: undefined, native_tools_enabled: false }),
}).superRefine((data, ctx: z.RefinementCtx) => {
  // Type assertion to avoid circular reference
  const configData = data as z.infer<typeof ConfigSchema>;

  // `paths.flows` shipped as the bare `"Flows"` before Phase 142, which resolves to `<root>/Flows`
  // — a directory the catalog has never lived in. The symptom was `exactl flow list` reporting
  // "No flows found" against a workspace holding twenty flows, four layers from the cause. An
  // existing config carrying that value would silently resolve to an empty catalog again, so it
  // is rejected at load where the operator can act on it.
  //
  // Deliberately narrow: only the stale default is refused. Bare subfolder names in general are a
  // legitimate choice for an operator who really does keep the catalog at the workspace root.
  if (configData.paths?.flows === DEFAULTS.DEFAULT_FLOWS_PATH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `paths.flows = "${DEFAULTS.DEFAULT_FLOWS_PATH}" is the pre-Phase-142 default and resolves to an ` +
        `empty catalog. Use the composite form "${DEFAULTS.ExaPathDefaults.flows}", or an explicit ` +
        `path if the catalog genuinely lives elsewhere.`,
      path: ["paths", "flows"],
    });
  }

  // Validate that default_model exists in models keys or is a fallback chain
  const modelKeys = Object.keys(configData.models || {});
  const fallbackChainKeys = Object.keys(configData.provider_strategy?.fallback_chains || {});
  const providerTypes = [
    PROVIDER_OLLAMA,
    PROVIDER_ANTHROPIC,
    PROVIDER_OPENAI,
    PROVIDER_GOOGLE,
    PROVIDER_VERTEX,
    PROVIDER_OPENROUTER,
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
