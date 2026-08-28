/**
 * @module SessionDelegateSchemas
 * @path packages/schemas/src/session_delegate.ts
 * @description Zod schemas for the Phase 106 session-delegation handoff contract:
 *   brief (input), return (output), wait state, and config block.
 * @architectural-layer Schemas
 * @related-files [packages/schemas/src/mod.ts, packages/schemas/tests/session_delegate_test.ts]
 */

import { z } from "zod";

/** Which gate a delegation is bound to. */
export const SessionGateSchema = z.enum([
  "refinement",
  "plan_review",
  "code_changes",
  "review",
]);
export type SessionGate = z.infer<typeof SessionGateSchema>;

/** Supported external session tools. */
export const SessionToolSchema = z.enum([
  "claude-code",
  "opencode",
  "codex",
  "cursor",
  "vscode",
]);
export type SessionTool = z.infer<typeof SessionToolSchema>;

/**
 * Launch coupling mode for an adapter.
 *  - advisory: Exaix prints the command; the human runs the tool out-of-band.
 *  - supervised: interactive `exactl` spawns the tool on the caller's TTY.
 *  - headless: non-interactive launch via `claude -p` or `opencode run` (Phase 111).
 */
export const SessionLaunchModeSchema = z.enum(["advisory", "supervised", "headless"]);
export type SessionLaunchMode = z.infer<typeof SessionLaunchModeSchema>;

/** Token budget constraints handed to the session tool via the brief. */
export const SessionTokenBudgetSchema = z.object({
  max_input_tokens: z.number().int().positive(),
  max_output_tokens: z.number().int().positive(),
  /** Hard ceiling across the whole session; reconciliation flags overage. */
  max_total_tokens: z.number().int().positive(),
});
export type SessionTokenBudget = z.infer<typeof SessionTokenBudgetSchema>;

/** Brief (input contract) materialized to Session/{traceId}/brief.json. */
export const SessionBriefSchema = z.object({
  trace_id: z.string().uuid(),
  parent_trace_id: z.string().uuid().optional(),
  parent_step_id: z.string().min(1).optional(),
  sequence: z.number().int().positive().optional(),
  gate: SessionGateSchema,
  tool: SessionToolSchema,
  objective: z.string().min(1),
  /** Model the delegate tool should use (headless `--model <model>`). Optional; tool default when absent. */
  model: z.string().min(1).optional(),
  /** Artifact under work (request / plan / diff) by relative path. */
  artifact_ref: z.string().min(1),
  /** Portal knowledge.json reference for context. */
  context_card_ref: z.string().optional(),
  acceptance_criteria: z.array(z.string()).default([]),
  /** Paths the session tool is permitted to modify (worktree-relative globs). */
  permitted_paths: z.array(z.string()).min(1),
  /** Worktree checkout the tool must operate in (code_changes / review). */
  worktree_path: z.string().optional(),
  token_budget: SessionTokenBudgetSchema,
  /** Resume token issued by the durable wait state. */
  resume_token: z.string().min(1),
  deadline: z.string().datetime(),
});
export type SessionBrief = z.infer<typeof SessionBriefSchema>;

/** Decision verbs allowed per gate. */
export const SessionDecisionSchema = z.enum([
  "enriched",
  "approved",
  "amended",
  "changes_made",
  "rejected",
  "abandoned",
]);
export type SessionDecision = z.infer<typeof SessionDecisionSchema>;

/** Required token statistics reported by the session tool. */
export const SessionTokenStatsSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  /** Provider/model the human's tool actually used, for the AI-BOM. */
  model: z.string().optional(),
  /** Prompt-cache read tokens. undefined when the tool doesn't report cache usage —
   *  never 0 for "unknown". */
  cache_read_tokens: z.number().int().nonnegative().optional(),
  /** Prompt-cache write (creation) tokens, one-time per cache segment. */
  cache_creation_tokens: z.number().int().nonnegative().optional(),
  /** Reasoning/thinking tokens, when the session tool reports a breakdown (subset of
   *  output_tokens, billed as output). undefined when the tool/model doesn't report one —
   *  never 0 for "no reasoning happened". */
  reasoning_tokens: z.number().int().nonnegative().optional(),
});
export type SessionTokenStats = z.infer<typeof SessionTokenStatsSchema>;

/** Return (output contract) — MANDATORY at Session/{traceId}/return.json. */
export const SessionReturnSchema = z.object({
  trace_id: z.string().uuid(),
  resume_token: z.string().min(1),
  decision: SessionDecisionSchema,
  summary: z.string().min(1),
  paths_touched: z.array(z.string()).default([]),
  token_stats: SessionTokenStatsSchema,
  /** Opaque audit-only reference; never parsed as pipeline state. */
  transcript_ref: z.string().optional(),
  /** USD cost reported by the delegate tool (e.g. opencode step_finish.cost, claude total_cost_usd). */
  cost_usd: z.number().nonnegative().optional(),
});
export type SessionReturn = z.infer<typeof SessionReturnSchema>;

/** Wait state persisted under Memory/Execution/{traceId}/session_wait.json. */
export const SessionWaitStatusSchema = z.enum([
  "pending",
  "resumed",
  "expired",
  "cancelled",
]);
export type SessionWaitStatus = z.infer<typeof SessionWaitStatusSchema>;

export const SessionWaitStateSchema = z.object({
  trace_id: z.string().uuid(),
  gate: SessionGateSchema,
  resume_token: z.string().min(1),
  deadline: z.string().datetime(),
  status: SessionWaitStatusSchema,
  decision: SessionDecisionSchema.optional(),
  created_at: z.string().datetime(),
  resumed_at: z.string().datetime().optional(),
});
export type SessionWaitState = z.infer<typeof SessionWaitStateSchema>;

/**
 * Decision-verb-per-gate compatibility matrix. A delegated `return.json`
 * decision is only legal for the gate its brief was bound to. `abandoned` is
 * universally permitted (the human gave up at any gate). Reconciliation
 * (Phase 106 Step 4) rejects a return whose decision is not listed here for
 * the brief's gate.
 */
export const SESSION_GATE_DECISIONS: Record<SessionGate, readonly SessionDecision[]> = {
  [SessionGateSchema.enum.refinement]: [
    SessionDecisionSchema.enum.enriched,
    SessionDecisionSchema.enum.abandoned,
  ],
  [SessionGateSchema.enum.plan_review]: [
    SessionDecisionSchema.enum.approved,
    SessionDecisionSchema.enum.amended,
    SessionDecisionSchema.enum.rejected,
    SessionDecisionSchema.enum.abandoned,
  ],
  [SessionGateSchema.enum.code_changes]: [
    SessionDecisionSchema.enum.changes_made,
    SessionDecisionSchema.enum.abandoned,
  ],
  [SessionGateSchema.enum.review]: [
    SessionDecisionSchema.enum.approved,
    SessionDecisionSchema.enum.rejected,
    SessionDecisionSchema.enum.abandoned,
  ],
};

/** True when `decision` is a legal outcome verb for `gate`. */
export function isDecisionValidForGate(gate: SessionGate, decision: SessionDecision): boolean {
  return SESSION_GATE_DECISIONS[gate].includes(decision);
}

/**
 * Why reconciliation rejected a delegated return. Distinct from the legitimate
 * `abandoned` decision verb — a rejection means the return is untrusted and the
 * gate must NOT be resumed with it.
 */
export const SessionReconcileRejectionSchema = z.enum([
  "forged_token", // resume_token / trace_id mismatch (GAP-2)
  "decision_gate_mismatch", // decision verb is illegal for the brief's gate
  "scope_violation", // a touched path is outside permitted_paths (GAP-3)
]);
export type SessionReconcileRejection = z.infer<typeof SessionReconcileRejectionSchema>;

/** Provider resolution for a delegate tool (Phase 123 R9). */
export const SessionDelegateProviderSchema = z.object({
  name: z.string().min(1),
  key_env: z.string().min(1),
  base_url: z.string().url().optional(),
});
export type SessionDelegateProvider = z.infer<typeof SessionDelegateProviderSchema>;

/** TOML config block: [session_delegate] at request/portal/blueprint scope. */
export const SessionDelegateConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tool: SessionToolSchema,
  /** Model the delegate tool should use (headless `--model <model>`). Optional; tool default when absent. */
  model: z.string().min(1).optional(),
  gates: z.array(SessionGateSchema).min(1),
  /** "advisory" (Mode 1), "supervised" (Mode 2), or "headless" (Mode 3, Phase 111). */
  launch_mode: SessionLaunchModeSchema.default("advisory"),
  token_budget: SessionTokenBudgetSchema.optional(),
  /** Absolute paths to additional binaries allowed for headless launch (Phase 111). */
  bin_overrides: z.array(z.string()).optional(),
  /**
   * Worktree-relative globs the delegate may touch at the code_changes gate
   * (Phase 150 LIVE-RT). `paths_touched` are worktree-relative, so a portal code
   * change reports `src/main.ts` — the previous hardcoded `Workspace/**` could
   * never match it and rejected every live return as a scope violation. Declaring
   * the scope per config preset keeps Risk R1's "acceptance names the scope"
   * property: a preset opts into exactly the tree its tasks may edit, and paths
   * outside it (`.env`, CI config) still fail the check.
   */
  permitted_paths: z.array(z.string().min(1)).min(1).optional(),
  /** Declarative delegate provider block: routes the tool through a specific API gateway. */
  provider: SessionDelegateProviderSchema.optional(),
  /**
   * Enable delegate permission hardening (Phase 128 R3). When true:
   * - OpenCode: generates a confined opencode.jsonc agent permission block
   * - Claude Code: derives --permission-mode + --allowedTools flags
   * - Version probe warns on unsupported tool versions
   * Default false (opt-in). Feature is gated behind this flag.
   */
  harden_permissions: z.boolean().default(false),
});
export type SessionDelegateConfig = z.infer<typeof SessionDelegateConfigSchema>;

/**
 * TOML config block: [cli_delegate] — per-step execution via a headless CLI tool
 * (claude/opencode) as an alternative to direct IModelProvider API calls. Distinct
 * from [session_delegate]: this selects the execution strategy for a single agent
 * step (Strategy dispatch via IAgentFileBlueprint.capabilities), not a whole gate.
 */
export const CliDelegateConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tool: SessionToolSchema,
  /** Model the CLI tool should use (headless `--model <model>`). Optional; tool default when absent. */
  model: z.string().min(1).optional(),
  /** Absolute paths to additional binaries allowed beyond the built-in claude/opencode bins. */
  bin_overrides: z.array(z.string()).optional(),
});
export type CliDelegateConfig = z.infer<typeof CliDelegateConfigSchema>;
