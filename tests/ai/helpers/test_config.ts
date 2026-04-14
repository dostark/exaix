/**
 * @module AIProviderTestConfig
 * @path tests/ai/helpers/test_config.ts
 * @description Provides a baseline AI configuration for provider tests, ensuring
 * consistent model names and base URLs for Mock/Live backend testing.
 */

import { type AiConfig, AiConfigSchema } from "../../../src/shared/schemas/ai_config.ts";
import type { Config } from "../../../src/shared/schemas/config.ts";
import { ExaPathDefaults } from "../../../src/shared/constants.ts";
import {
  LogLevel,
  McpTransportType,
  PortalAnalysisMode,
  ProviderType,
  QualityGateMode,
  SqliteJournalMode,
} from "../../../src/shared/enums.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";
import type { IModelProvider } from "../../../src/ai/types.ts";
import { ProviderFactory } from "../../../src/ai/provider_factory.ts";
import { WORKSPACE_SCHEMA_VERSION } from "../../../src/shared/version.ts";

/**
 * Create a minimal config for testing.
 * The aiConfig parameter is a partial input that gets parsed through AiConfigSchema
 * to apply defaults.
 */
export function createTestConfig(aiConfig?: Partial<AiConfig>): Config {
  // Parse through schema to apply defaults
  const parsedAi = aiConfig ? AiConfigSchema.parse(aiConfig) : undefined;

  return {
    tools: {
      fetch_url: {
        enabled: false,
        allowed_domains: ["deno.land", "docs.deno.com", "npmjs.com", "github.com", "stackoverflow.com"],
        timeout_ms: 5000,
        max_response_size_kb: 50,
      },
      grep_search: {
        max_results: 50,
        exclude_dirs: [".git", "node_modules", "dist", "coverage"],
      },
    },
    system: {
      version: "1.0.0",
      schema_version: WORKSPACE_SCHEMA_VERSION,
      root: "/tmp/exaix-test",
      log_level: LogLevel.INFO,
    },
    paths: { ...ExaPathDefaults },
    database: {
      batch_flush_ms: 100,
      batch_max_size: 50,
      sqlite: {
        journal_mode: SqliteJournalMode.WAL,
        foreign_keys: true,
        busy_timeout_ms: 5000,
      },
      failure_threshold: 5,
      reset_timeout_ms: 30000,
      half_open_success_threshold: 1,
    },
    watcher: { debounce_ms: 200, stability_check: true },
    agents: {
      default_model: "default",
      timeout_sec: 60,
      max_iterations: 10,
    },
    portals: [],
    mcp: {
      enabled: true,
      transport: McpTransportType.STDIO,
      server_name: "exaix",
      version: "1.0.0",
    },
    ai_endpoints: {},
    ai_retry: {
      max_attempts: 3,
      backoff_base_ms: 1000,
      timeout_per_request_ms: 30000,
    },
    ai_anthropic: {
      api_version: "2023-06-01",
      default_model: "claude-opus-4.5",
      max_tokens_default: 4096,
    },
    mcp_defaults: { identity_id: "system" },
    rate_limiting: {
      enabled: true,
      max_calls_per_minute: 60,
      max_tokens_per_hour: 100000,
      max_cost_per_day: 50,
      cost_per_1k_tokens: 0.03,
    },
    git: {
      branch_prefix_pattern: "^(feat|fix|docs|chore|refactor|test)/",
      allowed_prefixes: ["feat", "fix", "docs", "chore", "refactor", "test"],
      operations: {
        status_timeout_ms: 10000,
        ls_files_timeout_ms: 5000,
        checkout_timeout_ms: 10000,
        clean_timeout_ms: 5000,
        log_timeout_ms: 5000,
        diff_timeout_ms: 10000,
        command_timeout_ms: 30000,
        max_retries: 3,
        retry_backoff_base_ms: 100,
        branch_name_collision_max_retries: 5,
        trace_id_short_length: 8,
        branch_suffix_length: 6,
      },
    },
    ai: parsedAi,
    ai_timeout: {
      default_ms: 30000,
      providers: {
        openai: 30000,
        anthropic: 60000,
        google: 30000,
        ollama: 120000,
      },
    },
    models: {
      default: { provider: ProviderType.OPENAI, model: "gpt-5.2-pro", timeout_ms: 30000 },
      fast: { provider: ProviderType.OPENAI, model: "gpt-5.2-pro-mini", timeout_ms: 15000 },
      local: { provider: ProviderType.OLLAMA, model: "llama3.2", timeout_ms: 60000 },
    },
    provider_strategy: {
      prefer_free: true,
      allow_local: true,
      max_daily_cost_usd: 5.00,
      health_check_enabled: true,
      fallback_enabled: true,
      fallback_chains: {},
    },
    providers: {},
    cost_tracking: {
      batch_delay_ms: 5000,
      max_batch_size: 50,
      rates: {
        openai: 0.01,
        anthropic: 0.015,
        google: 0,
        ollama: 0,
        mock: 0,
      },
    },
    mock: {
      delay_ms: 500,
      input_tokens: 100,
      output_tokens: 50,
    },
    ui: {
      prompt_preview_length: 50,
      prompt_preview_extended: 100,
    },
    health: {
      check_timeout_ms: 30000,
      cache_ttl_ms: 60000,
      memory_warn_percent: 80,
      memory_critical_percent: 95,
    },
    request_analysis: {
      enabled: true,
      persist_analysis: true,
      mode: AnalysisMode.HYBRID,
      actionability_threshold: 60,
      infer_acceptance_criteria: true,
    },
    portal_knowledge: {
      auto_analyze_on_mount: true,
      default_mode: PortalAnalysisMode.QUICK,
      quick_scan_limit: 200,
      max_files_to_read: 50,
      staleness_hours: 168,
      use_llm_inference: true,
      ignore_patterns: ["node_modules", ".git", "dist", "build"],
    },
    quality_gate: {
      enabled: true,
      mode: QualityGateMode.HYBRID,
      auto_enrich: true,
      block_unactionable: false,
      max_clarification_rounds: 5,
      thresholds: { minimum: 20, enrichment: 50, proceed: 70 },
    },
    amendment: {
      enabled: true,
      threshold: 80,
      expiryMs: 3600000,
    },
    skills: {
      max_per_request: 5,
      match_threshold: 0.3,
      inject_in_prompt: true,
      log_matched_ids: true,
      context_budget_chars: 4000,
    },
  };
}

/**
 * Helper for tests: get provider by model name
 */
export async function getProviderForModel(model: string): Promise<IModelProvider> {
  const config = createTestConfig();
  config.ai = {
    provider: ProviderType.OLLAMA,
    model,
    timeout_ms: 30000,
  };
  return await ProviderFactory.create(config);
}
