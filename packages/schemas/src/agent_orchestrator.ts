/**
 * @module AgentExecutorSchema
 * @path packages/schemas/src/agent_orchestrator.ts
 * @description Defines Zod validation schemas for agent execution context, options, and results, used for type-safe agent orchestration.
 * @architectural-layer Schemas
 * @ungrounded
 * @related-files ["packages/execution/src/agent_orchestrator.ts"]
 */

import { z } from "zod";
import { AgentExecutionErrorType, ExecutionStrategyName, JSONValueSchema, SecurityMode } from "@exaix/core";

/**
 * Security mode for agent execution
 */
export const SecurityModeSchema = z.nativeEnum(SecurityMode);

/**
 * Execution context passed to agent via MCP
 */
export const ExecutionContextSchema = z.object({
  trace_id: z.string().uuid(),
  request_id: z.string(),
  request: z.string().describe("Original user request content"),
  plan: z.string().describe("Plan to execute"),
  portal: z.string().describe("Target portal name"),
  skills_context: z.string().optional().describe(
    "Optional pre-built skills context block for prompt injection",
  ),
  step_number: z.number().int().positive().optional().describe(
    "Step number if executing multi-step plan",
  ),
  full_plan: z.string().optional().describe(
    "All of the current plan's steps concatenated — lets a strategy orient on the whole task instead of just the current step's fragment",
  ),
});
export type IExecutionContext = z.infer<typeof ExecutionContextSchema>;

/**
 * Options for agent execution
 */
export const AgentExecutionOptionsSchema = z.object({
  identity_id: z.string().describe("Identity blueprint ID"),
  portal: z.string().describe("Portal name"),
  security_mode: SecurityModeSchema.default(SecurityMode.SANDBOXED),
  timeout_ms: z.number().int().positive().default(300000).describe(
    "Execution timeout (default: 5 minutes)",
  ),
  max_tool_calls: z.number().int().positive().default(100).describe(
    "Maximum MCP tool calls allowed",
  ),
  audit_enabled: z.boolean().default(true).describe(
    "Enable post-execution git audit",
  ),
  permitted_tools: z.array(z.string()).optional().describe(
    "Custom tool permissions for this execution",
  ),
  allowed_paths: z.array(z.string()).optional().describe(
    "Allowed paths for modification (security audit)",
  ),
  request_analysis: z.any().optional().describe(
    "Request analysis for adaptive budget reallocation",
  ),
  native_tools_enabled: z.boolean().optional().describe(
    "Opt in to provider-enforced native tool selection instead of TOML-block prose. Requires a provider with supportsNativeTools: true (Anthropic after Step 2).",
  ),
  strategy: z.enum([ExecutionStrategyName.REACT, ExecutionStrategyName.MCP, ExecutionStrategyName.CLI_DELEGATE])
    .optional().describe(
      "Forced execution strategy, bypassing capability-based dispatch. Set by a flow step's own `strategy` field (Phase 159); absent for the plan-execution path, which keeps capability-based dispatch.",
    ),
});
export type IAgentExecutionOptions = z.output<
  typeof AgentExecutionOptionsSchema
>;
export type IAgentExecutionOptionsInput = z.input<
  typeof AgentExecutionOptionsSchema
>;

/**
 * Result from agent execution
 */
/** Distinguishes a real, provider/tool-reported cost_usd ("tracked") from Exaix's own
 *  calculateCost() rate-based guess ("predicted"). */
export const ChangesetCostSourceSchema = z.enum(["tracked", "predicted"]);
export type IChangesetCostSource = z.infer<typeof ChangesetCostSourceSchema>;

export const ChangesetResultSchema = z.object({
  branch: z.string().describe("Git branch created"),
  commit_sha: z.string().regex(/^[0-9a-f]{7,40}$/).describe(
    "Git commit SHA",
  ),
  files_changed: z.array(z.string()).describe("List of modified files"),
  description: z.string().describe("Review description"),
  tool_calls: z.number().int().nonnegative().describe(
    "Number of MCP tool calls made",
  ),
  execution_time_ms: z.number().int().nonnegative().describe(
    "Execution duration in milliseconds",
  ),
  unauthorized_changes: z.array(z.string()).optional().describe(
    "Files modified outside MCP tools (hybrid mode audit)",
  ),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    cost_usd: z.number().nonnegative(),
    /** Prompt-cache read tokens. undefined when caching wasn't used — never 0 for
     *  "unknown". */
    cache_read_tokens: z.number().int().nonnegative().optional(),
    /** Prompt-cache write (creation) tokens, one-time per cache segment. */
    cache_creation_tokens: z.number().int().nonnegative().optional(),
    /** Distinguishes a real, provider/tool-reported cost_usd ("tracked") from Exaix's
     *  own calculateCost() rate-based guess ("predicted"). Defaults to "predicted" so
     *  every existing direct-API call site that doesn't explicitly set this preserves
     *  today's exact behavior; CliDelegateStrategy and the session-delegate path
     *  explicitly set "tracked". */
    cost_source: ChangesetCostSourceSchema.default("predicted"),
  }).optional().describe("LLM usage metrics (Phase 69)"),
});
export type IChangesetResult = z.infer<typeof ChangesetResultSchema>;

/**
 * Agent execution error types
 */
export const AgentExecutionErrorTypeSchema = z.nativeEnum(AgentExecutionErrorType);

/**
 * Agent execution error details
 */
export const AgentExecutionErrorSchema = z.object({
  type: AgentExecutionErrorTypeSchema,
  message: z.string(),
  details: z.record(JSONValueSchema).optional(),
  trace_id: z.string().uuid().optional(),
});
export type IAgentExecutionError = z.infer<typeof AgentExecutionErrorSchema>;
