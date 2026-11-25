#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL0DataTypesReference
 * @path scripts/go_port/core_l0_data_types_reference.ts
 * @description Builds JSON samples of the kept core data types, typed against the TypeScript interfaces, and differential cases of the kept pure helpers for the Go reference fixtures.
 * Usage: imported by scripts/go_port/core_l0_reference.ts.
 */
import {
  AgentHealth,
  type IActivityRecord,
  type IAgentHealthData,
  type IAgentLogEntry,
  type IAgentStatusItem,
  type IArchiveEntry,
  type ICapabilityProfile,
  type IContextCardPortalInfo,
  type IDaemonStatus,
  type IEmbeddingSearchResult,
  type IGroupedCostRecord,
  type IJournalIntegrityResult,
  type ILatencyStats,
  type IMemoryNotification,
  type IModelEntry,
  type IModelPricing,
  type IPlanDetails,
  type IPlanMetadata,
  type IPortalConfigEntry,
  type IPortalDetails,
  type IPortalInfo,
  type IProviderCostRecord,
  type IRateLimitStatus,
  type IRecordedCallSite,
  type ISharedToolOperation,
  type ISkillsContext,
  type IStructuredLogEntry,
  type ITieredMemoryEntry,
  type ITool,
  type IToolParameterSchema,
  type IToolResult,
  type IToolSchema,
  type IValidationResult,
  type IVerificationResult,
  LogLevel,
  MemoryTier,
  MemoryType,
  PortalExecutionStrategy,
  PortalOperation,
  PortalStatus,
  SkillMatchSource,
  SkillRootKind,
  ToolSideEffectScope,
  VerificationStatus,
} from "@exaix/core/types";
import {
  canonicalizeToolCall,
  canonicalizeToolName,
  type ICanonicalizedToolCall,
  invalidNativeToolNamesMessage,
  type IProviderDefaults,
  isRejectedNativeToolName,
  jsonExtract,
  retiredToolRenameHint,
  retiredToolRenameSuffix,
} from "@exaix/core";

type TSampleJson = string | number | boolean | null | TSampleJson[] | { [key: string]: TSampleJson };

interface IToolCallCase {
  readonly name: string;
  readonly params: { [key: string]: TSampleJson };
  readonly accepted: readonly string[] | null;
  readonly expected: ICanonicalizedToolCall;
}

interface IJsonExtractCase {
  readonly input: string;
  readonly path: string;
  readonly found: boolean;
  readonly value: string | null;
}

const ISO = "2026-03-01T10:00:00.250Z";
const UUID = "0b1f4f4e-3b2a-4a53-8f2e-5b6f3f1a9c11";
const SHA = "a".repeat(64);

function dataTypeSamples(): { readonly [goType: string]: readonly object[] } {
  const activityMinimal = {
    id: "a1",
    trace_id: "t1",
    actor: null,
    actor_type: null,
    agent_role: null,
    action_type: "request.created",
    target: null,
    payload: "{}",
    timestamp: ISO,
  } satisfies IActivityRecord;
  const activityFull = {
    ...activityMinimal,
    actor: "user",
    actor_type: "user",
    agent_role: "coder",
    runner_kind: null,
    target: "Requests/a.md",
    prompt_tokens: 12,
    completion_tokens: 0,
    cost_usd: null,
    cache_read_tokens: 3,
    cache_creation_tokens: null,
    count: 2,
  } satisfies IActivityRecord;
  const groupedCost = {
    group: "anthropic",
    calls: 3,
    promptTokens: 1000,
    completionTokens: 500,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    estimatedCostUsd: 0.0125,
    costBySource: { provider_reported: 0.01, registry_computed: 0.0025, estimated: 0 },
    unpricedCalls: 0,
  } satisfies IGroupedCostRecord;
  const providerCostMinimal = {
    id: "c1",
    provider: "openai",
    model: "gpt-x",
    tokens: 15,
    promptTokens: 10,
    completionTokens: 5,
    estimatedCostUsd: null,
    timestamp: new Date(ISO),
  } satisfies IProviderCostRecord;
  const providerCostFull = {
    ...providerCostMinimal,
    estimatedCostUsd: 0.002,
    requests: 1,
    traceId: "t1",
    portal: "p",
    agentRole: "coder",
    cacheReadTokens: 1,
    cacheCreationTokens: 2,
    reasoningTokens: 3,
    costSource: "estimated",
    service: "planner",
    transport: "api",
  } satisfies IProviderCostRecord;
  const portalInfo = {
    alias: "app",
    targetPath: "/work/app",
    symlinkPath: "Portals/app",
    contextCardPath: "Memory/cards/app.md",
    status: PortalStatus.ACTIVE,
  } satisfies IPortalInfo;
  const portalInfoFull = {
    ...portalInfo,
    created: ISO,
    lastVerified: ISO,
    defaultBranch: "main",
    executionStrategy: PortalExecutionStrategy.WORKTREE,
  } satisfies IPortalInfo;
  const toolParam = {
    type: "object",
    description: "options",
    enum: ["a", "b"],
    items: { type: "string" },
    properties: { inner: { type: "number", required: ["x"] } },
    required: ["inner"],
  } satisfies IToolParameterSchema;
  const toolSchema = { type: "object", properties: { path: { type: "string" } } } satisfies IToolSchema;
  const toolSchemaFull = {
    type: "object",
    properties: { path: { type: "string", description: "file" }, mode: toolParam },
    required: ["path"],
  } satisfies IToolSchema;
  const toolMinimal = { name: "read_file", description: "Read a file", parameters: toolSchema } satisfies ITool;
  const toolFull = {
    ...toolMinimal,
    parameters: toolSchemaFull,
    nativeDescription: "PREFERRED for reads",
    sideEffectScope: ToolSideEffectScope.NONE,
  } satisfies ITool;
  const logEntryMinimal = {
    timestamp: ISO,
    level: LogLevel.INFO,
    message: "started",
    context: {},
  } satisfies IStructuredLogEntry;
  const logEntryFull = {
    timestamp: ISO,
    level: LogLevel.ERROR,
    message: "failed",
    context: {
      trace_id: "t1",
      request_id: "r1",
      user_id: "u",
      agent_role: "coder",
      portal: "app",
      session_id: "s",
      correlation_id: "c",
      operation: "write",
      step: 3,
      region: "eu",
      attempt: 2,
      cached: true,
    },
    metadata: { files: 2, nested: { ok: true }, list: [1, "a", null] },
    error: { name: "Error", message: "boom", stack: "at x", code: "E1" },
    performance: { duration_ms: 12.5, memory_mb: 30, cpu_percent: 1.5 },
  } satisfies IStructuredLogEntry;
  const metadata = { id: "plan.md", status: "approved" } satisfies IPlanMetadata;
  const metadataFull = {
    id: "plan.md",
    status: "approved",
    trace_id: UUID,
    agent_role: "coder",
    author: "a",
    request_id: "r",
    request_subject: "s",
    request_agent_role: "coder",
    request_portal: "p",
    request_priority: "high",
    request_created_by: "u",
    input_tokens: "10",
    output_tokens: "20",
    total_tokens: "30",
    token_provider: "openai",
    token_model: "m",
    token_cost_usd: "0.01",
    created_at: ISO,
    approved_by: "u",
    approved_at: ISO,
    rejected_by: "u",
    rejected_at: ISO,
    rejection_reason: "no",
    reviewed_by: "u",
    reviewed_at: ISO,
    subject: "s",
  } satisfies IPlanMetadata;
  const skills = {
    matched: [{
      skillId: "tdd",
      revisionId: UUID,
      contentSha256: SHA,
      rootKind: SkillRootKind.BLUEPRINT,
      sourcePath: "Blueprints/Skills/tdd",
      name: "TDD",
      description: "Test first",
      content: "body",
      confidence: 0.75,
      matchedTriggers: { keywords: ["test"], task_types: ["feature"], file_patterns: ["*.ts"], tags: ["qa"] },
      source: SkillMatchSource.MATCHED,
      tags: ["qa"],
      critical: true,
      effort: "high",
      thinking: false,
      examples: "example",
      references: [{ path: "ref.md", content: "c", linked: true }],
    }, {
      skillId: "min",
      revisionId: UUID,
      contentSha256: SHA,
      rootKind: SkillRootKind.PROJECT,
      sourcePath: "p",
      name: "n",
      description: "d",
      content: "c",
      confidence: 0,
      matchedTriggers: {},
      source: SkillMatchSource.DEFAULT,
      tags: [],
      critical: false,
      references: [],
    }],
    totalAvailable: 5,
    retrievalLatencyMs: 12,
  } satisfies ISkillsContext;
  const validation = {
    success: false,
    errors: [{ path: "a.b", message: "bad", code: "invalid", expected: "string", received: "number" }, {
      path: "c",
      message: "m",
      code: "x",
    }],
    repairAttempted: true,
    repairSucceeded: false,
    raw: "{}",
  } satisfies IValidationResult<string>;
  const validationOk = {
    success: true,
    value: "v",
    repairAttempted: false,
    repairSucceeded: false,
    raw: "v",
    parsed: "v",
  } satisfies IValidationResult<string>;
  return {
    ActivityRecord: [activityMinimal, activityFull],
    GroupedCostRecord: [groupedCost, { ...groupedCost, estimatedCostUsd: null }],
    ProviderCostRecord: [providerCostMinimal, providerCostFull],
    JournalIntegrityResult: [
      { ok: true, rows_checked: 0, unhashed_prefix: 0, first_broken_id: null, expected_hash: null, actual_hash: null },
      { ok: false, rows_checked: 9, unhashed_prefix: 1, first_broken_id: "r7", expected_hash: "e", actual_hash: "a" },
    ] satisfies IJournalIntegrityResult[],
    AgentHealthData: [{ status: AgentHealth.HEALTHY, issues: [], uptime: 12.5 }] satisfies IAgentHealthData[],
    AgentLogEntry: [
      { timestamp: ISO, level: LogLevel.INFO, message: "m" },
      { timestamp: ISO, level: LogLevel.WARN, message: "m", traceId: "t1" },
    ] satisfies IAgentLogEntry[],
    AgentStatusItem: [{
      id: "a",
      name: "coder",
      model: "m",
      status: "active",
      lastActivity: ISO,
      capabilities: ["read"],
      defaultSkills: [],
    }] satisfies IAgentStatusItem[],
    DaemonStatus: [
      { running: false, version: "1", workspace_schema_version: "2" },
      { running: true, pid: 42, uptime: "1h", version: "1", workspace_schema_version: "2" },
    ] satisfies IDaemonStatus[],
    ArchiveEntry: [{
      trace_id: "t",
      agent_role: "coder",
      status: "completed",
      archived_at: ISO,
    }] satisfies IArchiveEntry[],
    RecordedCallSite: [
      { scenarioId: "s", stepId: "st", callIndex: 0 },
      { scenarioId: "s", stepId: "st", flowStepId: "f", callIndex: 4 },
    ] satisfies IRecordedCallSite[],
    CapabilityProfile: [{}, {
      minContextWindow: 128000,
      supportsThinking: false,
      supportsEffort: true,
      maxCostPerMillionTokens: 15.5,
    }] satisfies ICapabilityProfile[],
    LatencyStats: [
      { p50Ms: 100.5, p95Ms: 200, p99Ms: 300, sampleCount: 7, lastUpdated: 1760000000000 },
    ] satisfies ILatencyStats[],
    ModelEntry: [{
      provider: "openai",
      model: "m",
      capabilities: { supportsThinking: true },
      contextWindow: 8000,
      costPer1kTokens: 0.002,
    }] satisfies IModelEntry[],
    ModelPricing: [
      { provider: "p", model: "m", provenance: "unknown" },
      {
        provider: "p",
        model: "m",
        inputPerMtok: 3,
        outputPerMtok: 15,
        cacheReadPerMtok: 0.3,
        cacheCreationPerMtok: 3.75,
        provenance: "remote_static",
        verifiedAt: 1760000000000,
        sourceUrl: "https://example.com/pricing",
      },
    ] satisfies IModelPricing[],
    RateLimitStatus: [{ remaining: 5, maxRpm: 60, resetAt: 1760000000000 }] satisfies IRateLimitStatus[],
    ProviderDefaults: [{
      defaultModel: "m",
      defaultEndpoint: "https://example.com",
      defaultTimeoutMs: 30000,
      defaultRetryMaxAttempts: 3,
      defaultRetryBackoffMs: 500,
    }] satisfies IProviderDefaults[],
    ToolParameterSchema: [{ type: "string" }, toolParam],
    ToolSchema: [toolSchema, toolSchemaFull],
    Tool: [toolMinimal, toolFull],
    ToolResult: [
      { success: true },
      { success: true, data: { rows: [1, 2], ok: null } },
      { success: false, error: "denied" },
    ] satisfies IToolResult[],
    SharedToolOperation: [{
      canonical: "read_file",
      toolNameMember: "READ_FILE",
      mcpToolNameMember: "READ_FILE",
    }] satisfies ISharedToolOperation[],
    StructuredLogEntry: [logEntryMinimal, logEntryFull],
    EmbeddingSearchResult: [
      { id: "i", title: "t", summary: "s", similarity: 0.5 },
      { id: "i", title: "t", summary: "s", similarity: 0.5, kind: MemoryType.LEARNING },
    ] satisfies IEmbeddingSearchResult[],
    TieredMemoryEntry: [{
      id: "m",
      content: "c",
      tier: MemoryTier.WORKING,
      source: { planId: "p", stepId: "s" },
      createdAt: 1760000000000,
      lastAccessedAt: 1760000001000,
      accessCount: 2,
      promotionScore: 0.25,
    }] satisfies ITieredMemoryEntry[],
    MemoryNotification: [
      { type: "info", message: "m" },
      {
        id: "n",
        type: "memory_update_pending_digest",
        message: "m",
        proposal_id: "p",
        trace_id: "t",
        created_at: ISO,
        dismissed_at: null,
        metadata: "{}",
      },
      { type: "error", message: "m", dismissed_at: ISO },
    ] satisfies IMemoryNotification[],
    PortalConfigEntry: [
      { alias: "app", target_path: "/work/app" },
      {
        alias: "app",
        target_path: "/work/app",
        created: ISO,
        default_branch: "main",
        agents_allowed: ["coder"],
        operations: [PortalOperation.READ, PortalOperation.GIT],
        execution_strategy: PortalExecutionStrategy.BRANCH,
      },
    ] satisfies IPortalConfigEntry[],
    ContextCardPortalInfo: [{ alias: "app", path: "/work/app", techStack: ["ts"] }] satisfies IContextCardPortalInfo[],
    PortalInfo: [portalInfo, portalInfoFull],
    PortalDetails: [{ ...portalInfo, permissions: "rw" }, portalInfoFull] satisfies IPortalDetails[],
    VerificationResult: [
      { alias: "app", status: VerificationStatus.OK },
      { alias: "app", status: VerificationStatus.FAILED, issues: ["missing"] },
    ] satisfies IVerificationResult[],
    PlanMetadata: [metadata, metadataFull],
    PlanDetails: [{ metadata: metadataFull, content: "# Plan" }] satisfies IPlanDetails[],
    SkillsContext: [skills],
    ValidationResult: [validation, validationOk],
  };
}

function toolCallCases(): IToolCallCase[] {
  const inputs: readonly {
    readonly name: string;
    readonly params: { [key: string]: TSampleJson };
    readonly accepted?: readonly string[];
  }[] = [
    { name: "read_file", params: { path: "a" } },
    { name: "Read", params: { file_path: "a" }, accepted: ["path"] },
    { name: " GREP ", params: { query: "x", regex: "y" } },
    { name: "grep", params: { query: "x", pattern: "z" } },
    { name: "edit", params: { old_string: "a", new_string: "b", oldString: "c" } },
    { name: "mv", params: { source: "a", destination: "b" } },
    { name: "cp", params: { from: "a", to: "b", extra: 1 } },
    { name: "unknown", params: { file_path: "a" }, accepted: ["path"] },
    { name: "read", params: { file_path: "a", filepath: "b" }, accepted: ["path"] },
    { name: "read", params: { file_path: "a" }, accepted: [] },
    { name: "search_files", params: { query: "q" }, accepted: ["query"] },
    { name: "Run_Deno_Task", params: { "7": "x", b: 1, "2": "y" } },
    { name: "QUERY_SYMBOLS", params: { query: "n" } },
    { name: "exaix_request_create", params: {} },
    { name: "save_memory", params: { fact: "f" } },
  ];
  return inputs.map((input) => ({
    name: input.name,
    params: input.params,
    accepted: input.accepted ?? null,
    expected: canonicalizeToolCall(
      input.name,
      { ...input.params },
      input.accepted ? new Set(input.accepted) : undefined,
    ),
  }));
}

function jsonExtractCases(): IJsonExtractCase[] {
  const doc = '{"a":{"b":[10,{"c":"x"}],"n":null},"s":"t","k":1.5,"":{"e":1}}';
  const paths = ["a.b.0", "a.b.1.c", "a.b", "a.n", "s", "k", "a.b.2", "a.x", "s.x", "a.n.z", "", ".e", "a.b.01", "q"];
  const cases = paths.map((path) => {
    try {
      return { input: doc, path, found: true, value: JSON.stringify(jsonExtract(doc, path)) };
    } catch {
      return { input: doc, path, found: false, value: null };
    }
  });
  const invalid = ["{", "", "[1,", '{"a":1} x'].map((input) => {
    try {
      return { input, path: "a", found: true, value: JSON.stringify(jsonExtract(input, "a")) };
    } catch {
      return { input, path: "a", found: false, value: null };
    }
  });
  return [...cases, ...invalid];
}

/** Builds the fixture of kept data type samples and kept helper cases. */
export function buildDataTypesFixture(): object {
  const names = [
    "read_file",
    "Read",
    "  GREP ",
    "ls",
    "exaix_request_create",
    "Exaix_Request_Create",
    "exaix_create_request",
    "EXAIX_LIST_PLANS",
    "deno_task",
    "run_deno_task",
    "Run_Deno_Task",
    "list_symbols",
    "custom_tool",
    "",
    " exaix_portal_symbols ",
    "unknown",
  ];
  return {
    samples: dataTypeSamples(),
    tool_names: names.map((name) => ({
      name,
      canonical: canonicalizeToolName(name),
      rejected: isRejectedNativeToolName(name),
      hint: retiredToolRenameHint(name) ?? null,
    })),
    tool_name_messages: [[], ["read_file"], ["exaix_create_request"], ["a", " Exaix_List_Plans "]].map((list) => ({
      names: list,
      suffix: retiredToolRenameSuffix(list),
      message: invalidNativeToolNamesMessage(list),
    })),
    tool_calls: toolCallCases(),
    json_extract: jsonExtractCases(),
  };
}
