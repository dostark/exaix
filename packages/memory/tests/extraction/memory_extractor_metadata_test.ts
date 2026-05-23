/**
 * @module MemoryExtractorMetadataTest
 * @path packages/memory/tests/extraction/memory_extractor_metadata_test.ts
 * @related-files []
 * @architectural-layer Memory
 * @description Tests that MemoryExtractorService correctly attaches confidence, source, and extractedAt metadata.
 */

import { assertEquals, assertExists } from "@std/assert";
import { MemoryExtractorService } from "@exaix/memory";
import {
  ConfidenceAssessmentLevel,
  ExecutionStatus,
  LearningCategory,
  LogLevel,
  MemoryBankSource,
  MemoryScope,
  PortalAnalysisMode,
  ProviderType,
  SqliteJournalMode,
} from "@exaix/core";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { IDatabaseService } from "@exaix/core";
import type { IMemoryBankService } from "@exaix/core/types";
import type { IExecutionMemory, IMemoryUpdateProposal, IProposalLearning } from "@exaix/schemas/memory_bank.ts";
import type { JSONValue } from "@exaix/core/types";

Deno.test("Step 71.1: MemoryExtractorService attaches required metadata to proposals", async () => {
  // Use a more structured mock to avoid casting if possible
  const rawConfig = {
    system: { root: ".", log_level: LogLevel.INFO, schema_version: "1.0.0", version: "0.1.0" },
    paths: {
      memory: "Memory",
      blueprints: "Blueprints",
      runtime: ".exa",
      workspace: "Workspace",
      portals: "Portals",
      active: "Active",
      archive: "Archive",
      plans: "Plans",
      requests: "Requests",
      rejected: "Rejected",
      identities: "Identities",
      flows: "Blueprints/Flows",
      memoryProjects: "Memory/Projects",
      memoryExecution: "Memory/Execution",
      memoryIndex: "Memory/Index",
      memorySkills: "Memory/Skills",
      memoryPending: "Memory/Pending",
      memoryTasks: "Memory/Tasks",
      memoryGlobal: "Memory/Global",
    },
    agents: { default_model: "test-model", timeout_sec: 30, max_iterations: 10 },
    models: { "test-model": { provider: ProviderType.MOCK, model: "test-model" } },
    tools: {},
    database: {
      batch_flush_ms: 100,
      batch_max_size: 10,
      sqlite: { journal_mode: SqliteJournalMode.WAL, foreign_keys: true, busy_timeout_ms: 1000 },
      failure_threshold: 5,
      reset_timeout_ms: 1000,
      half_open_success_threshold: 3,
    },
    watcher: { debounce_ms: 200, stability_check: true },
    skills: {
      max_per_request: 5,
      match_threshold: 0.3,
      inject_in_prompt: true,
      log_matched_ids: false,
      context_budget_chars: 1000,
    },
    portals: [],
    request_analysis: {
      enabled: true,
      mode: "hybrid",
      actionability_threshold: 60,
      infer_acceptance_criteria: true,
      persist_analysis: true,
    },
    quality_gate: {
      enabled: true,
      mode: "hybrid",
      auto_enrich: true,
      block_unactionable: false,
      max_clarification_rounds: 5,
      thresholds: { minimum: 30, enrichment: 50, proceed: 80 },
    },
    amendment: { enabled: false, threshold: 80, expiryMs: 3600000 },
    git: {
      branch_prefix_pattern: "feat/*",
      allowed_prefixes: ["feat", "fix"],
      operations: {
        status_timeout_ms: 1000,
        ls_files_timeout_ms: 1000,
        checkout_timeout_ms: 1000,
        clean_timeout_ms: 1000,
        log_timeout_ms: 1000,
        diff_timeout_ms: 1000,
        command_timeout_ms: 1000,
        max_retries: 3,
        retry_backoff_base_ms: 100,
        branch_name_collision_max_retries: 3,
        trace_id_short_length: 7,
        branch_suffix_length: 4,
      },
    },
    provider_strategy: {
      prefer_free: true,
      allow_local: true,
      max_daily_cost_usd: 1.0,
      health_check_enabled: true,
      fallback_enabled: true,
      fallback_chains: {},
    },
    mock: { delay_ms: 0, input_tokens: 100, output_tokens: 100 },
    ui: { prompt_preview_length: 100, prompt_preview_extended: 500 },
    cost_tracking: { batch_delay_ms: 100, max_batch_size: 10, rates: {} },
    health: { check_timeout_ms: 1000, cache_ttl_ms: 60000, memory_warn_percent: 80, memory_critical_percent: 90 },
    portal_knowledge: {
      auto_analyze_on_mount: true,
      default_mode: PortalAnalysisMode.QUICK,
      quick_scan_limit: 100,
      max_files_to_read: 10,
      staleness_hours: 24,
      use_llm_inference: true,
      ignore_patterns: [],
    },
    rate_limiting: {
      enabled: false,
      max_calls_per_minute: 10,
      max_tokens_per_hour: 1000,
      max_cost_per_day: 1.0,
      cost_per_1k_tokens: 0.01,
    },
    memory: {
      auto_approve: {
        enabled: false,
        confidence_threshold: ConfidenceAssessmentLevel.HIGH,
        delay_hours: 24,
        sources_allowed: [MemoryBankSource.LEARNED],
        max_batch_size: 20,
      },
    },
  };

  const config = ConfigSchema.parse(rawConfig);

  // Mock dependencies
  // Use a helper function or Object.assign to avoid double casting lint
  const mockDb = Object.assign({}, {
    logActivity: (
      _actor: string,
      _action: string,
      _target: string | null,
      _payload: Record<string, JSONValue>,
      _trace?: string,
    ) => {},
  }) as IDatabaseService;

  const mockMemoryBank = Object.assign({}) as IMemoryBankService;

  const service = new MemoryExtractorService(config, mockDb, mockMemoryBank);

  const execution = Object.assign({}, {
    trace_id: crypto.randomUUID(),
    request_id: "test-request",
    started_at: new Date().toISOString(),
    status: ExecutionStatus.COMPLETED,
    portal: "test-portal",
    identity_id: "test-identity",
    summary: "Test execution summary that is long enough to be meaningful and extract patterns.",
    changes: { files_modified: ["src/app.ts"], files_created: [], files_deleted: [] },
    lessons_learned: ["Learned that X is better than Y."],
    context_files: [],
    context_portals: [],
  }) as IExecutionMemory;

  const learning = Object.assign({}, {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    source: MemoryBankSource.EXECUTION,
    source_id: execution.trace_id,
    scope: MemoryScope.PROJECT,
    project: "test-portal",
    title: "Test Learning",
    description: "Description",
    category: LearningCategory.INSIGHT,
    tags: [],
    confidence: ConfidenceAssessmentLevel.MEDIUM,
    references: [],
  }) as IProposalLearning;

  const proposalId = await service.createProposal(learning, execution, "test-identity");
  const proposal = await service.getPending(proposalId);

  assertExists(proposal);
  if (proposal) {
    const p = proposal as IMemoryUpdateProposal;
    assertExists(p.learning.extracted_at, "extracted_at should exist");
    assertEquals(p.learning.confidence, ConfidenceAssessmentLevel.MEDIUM);
    assertEquals(p.learning.source, MemoryBankSource.EXECUTION);
  }

  // Clean up
  await Deno.remove(`./Memory/Pending/${proposalId}.json`).catch(() => {});
});
