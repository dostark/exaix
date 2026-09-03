/**
 * @module SessionDelegateSchemaTest
 * @path packages/schemas/tests/session_delegate_test.ts
 * @description Schema validation tests for Phase 106 session delegation contract.
 *   Covers brief/return round-trips, mandatory field enforcement, budget schema,
 *   decision enum, and the gate/decision compatibility surface.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  isDecisionValidForGate,
  SESSION_GATE_DECISIONS,
  SessionBriefSchema,
  SessionDecisionSchema,
  SessionDelegateConfigSchema,
  SessionGateSchema,
  SessionReturnSchema,
  SessionTokenBudgetSchema,
  SessionWaitStateSchema,
} from "@exaix/schemas/session_delegate.ts";
import { ConfigSchema } from "@exaix/schemas";

const VALID_BUDGET = {
  max_input_tokens: 50_000,
  max_output_tokens: 50_000,
  max_total_tokens: 100_000,
};

const VALID_BRIEF = {
  trace_id: "00000000-0000-4000-8000-000000000001",
  agent_role: "dogfood-coder",
  gate: "plan_review",
  tool: "claude-code",
  objective: "Review the generated plan and approve or amend it.",
  artifact_ref: "Workspace/Plans/req-01_plan.md",
  permitted_paths: ["Workspace/Plans/**"],
  token_budget: VALID_BUDGET,
  resume_token: "tok-abc-123",
  deadline: "2026-07-01T00:00:00.000Z",
};

const VALID_RETURN = {
  trace_id: "00000000-0000-4000-8000-000000000001",
  resume_token: "tok-abc-123",
  decision: "approved",
  summary: "Plan looks correct; approved with no amendments.",
  paths_touched: [],
  token_stats: {
    input_tokens: 1_200,
    output_tokens: 800,
    total_tokens: 2_000,
  },
};

Deno.test("[session_delegate] SessionBriefSchema round-trip with valid input", () => {
  const result = SessionBriefSchema.safeParse(VALID_BRIEF);
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.trace_id, VALID_BRIEF.trace_id);
  assertEquals(result.data.gate, "plan_review");
  assertEquals(result.data.tool, "claude-code");
  assertEquals(result.data.acceptance_criteria, []);
});

Deno.test("[session_delegate] SessionBriefSchema rejects missing permitted_paths", () => {
  const { permitted_paths: _, ...noScope } = VALID_BRIEF;
  const result = SessionBriefSchema.safeParse(noScope);
  assertEquals(result.success, false);
});

Deno.test("[session_delegate] SessionBriefSchema rejects empty permitted_paths", () => {
  const result = SessionBriefSchema.safeParse({ ...VALID_BRIEF, permitted_paths: [] });
  assertEquals(result.success, false);
});

Deno.test("[session_delegate] SessionBriefSchema rejects missing resume_token", () => {
  const { resume_token: _, ...noBrief } = VALID_BRIEF;
  const result = SessionBriefSchema.safeParse(noBrief);
  assertEquals(result.success, false);
});

Deno.test("[session_delegate] SessionReturnSchema requires token_stats", () => {
  const { token_stats: _, ...noStats } = VALID_RETURN;
  const result = SessionReturnSchema.safeParse(noStats);
  assertEquals(result.success, false, "return.json without token_stats must be rejected");
});

Deno.test("[session_delegate] SessionReturnSchema round-trip with valid input", () => {
  const result = SessionReturnSchema.safeParse(VALID_RETURN);
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.decision, "approved");
  assertEquals(result.data.token_stats.total_tokens, 2_000);
});

Deno.test("[session_delegate] SessionReturnSchema accepts optional transcript_ref", () => {
  const withRef = { ...VALID_RETURN, transcript_ref: "Session/00000001/transcript.log" };
  const result = SessionReturnSchema.safeParse(withRef);
  assertEquals(result.success, true);
});

Deno.test("[session_delegate] SessionReturnSchema rejects unknown decision verb", () => {
  const result = SessionReturnSchema.safeParse({ ...VALID_RETURN, decision: "hacked" });
  assertEquals(result.success, false);
});

Deno.test("[session_delegate] SessionTokenBudgetSchema rejects non-positive tokens", () => {
  assertThrows(() =>
    SessionTokenBudgetSchema.parse({ max_input_tokens: 0, max_output_tokens: 50_000, max_total_tokens: 100_000 })
  );
  assertThrows(() =>
    SessionTokenBudgetSchema.parse({ max_input_tokens: 50_000, max_output_tokens: -1, max_total_tokens: 100_000 })
  );
});

Deno.test("[session_delegate] SessionReturnSchema rejects negative token counts", () => {
  const result = SessionReturnSchema.safeParse({
    ...VALID_RETURN,
    token_stats: { input_tokens: -1, output_tokens: 800, total_tokens: 799 },
  });
  assertEquals(result.success, false);
});

Deno.test("[session_delegate] SessionDelegateConfigSchema defaults enabled to false", () => {
  const result = SessionDelegateConfigSchema.safeParse({
    tool: "cursor",
    gates: ["review"],
  });
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.enabled, false);
  assertEquals(result.data.launch_mode, "advisory");
});

Deno.test("[session_delegate] dogfood.claude.toml preset parses via ConfigSchema", () => {
  const claudePreset = {
    system: {
      root: "/tmp/my-root",
      log_level: "info",
      allow_net: ["api.anthropic.com", "api.openai.com", "localhost:11434"],
    },
    paths: { workspace: "Workspace", portals: "Portals", memory: "Memory" },
    ai: { provider: "ollama", model: "ollama/llama3" },
    portals: [{
      alias: "exaix-self",
      target_path: "/tmp/worktree",
      execution_strategy: "worktree",
      default_branch: "main",
    }],
    portal_knowledge: { auto_analyze_on_mount: true },
    quality_gate: { enabled: false },
    request_analysis: { enabled: true },
    session_delegate: {
      enabled: true,
      tool: "claude-code",
      model: "claude-sonnet-5",
      gates: ["code_changes"],
      launch_mode: "headless",
    },
  };
  const result = ConfigSchema.safeParse(claudePreset);
  assertEquals(result.success, true, "dogfood.claude.toml must be valid ConfigSchema");
  if (!result.success) return;
  assertEquals(result.data.session_delegate?.enabled, true);
  assertEquals(result.data.session_delegate?.tool, "claude-code");
  assertEquals(result.data.session_delegate?.launch_mode, "headless");
  assertEquals(result.data.session_delegate?.gates, ["code_changes"]);
});

Deno.test("[session_delegate] SessionDelegateConfigSchema accepts provider block", () => {
  const result = SessionDelegateConfigSchema.safeParse({
    enabled: true,
    tool: "opencode",
    gates: ["code_changes"],
    launch_mode: "headless",
    provider: { name: "openrouter", key_env: "OPENROUTER_KEY" },
  });
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.provider?.name, "openrouter");
  assertEquals(result.data.provider?.key_env, "OPENROUTER_KEY");
});

Deno.test("[session_delegate] SessionDelegateConfigSchema accepts provider with base_url", () => {
  const result = SessionDelegateConfigSchema.safeParse({
    enabled: true,
    tool: "claude-code",
    gates: ["code_changes"],
    launch_mode: "headless",
    provider: {
      name: "openrouter",
      key_env: "OR_KEY",
      base_url: "https://custom.openrouter.ai/api",
    },
  });
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.provider?.base_url, "https://custom.openrouter.ai/api");
});

Deno.test("[session_delegate] SessionDelegateConfigSchema rejects provider with empty key_env", () => {
  const result = SessionDelegateConfigSchema.safeParse({
    enabled: true,
    tool: "opencode",
    gates: ["code_changes"],
    provider: { name: "openrouter", key_env: "" },
  });
  assertEquals(result.success, false);
});

Deno.test("[session_delegate] SessionDelegateConfigSchema rejects provider with invalid base_url", () => {
  const result = SessionDelegateConfigSchema.safeParse({
    enabled: true,
    tool: "opencode",
    gates: ["code_changes"],
    provider: { name: "openrouter", key_env: "KEY", base_url: "not-a-url" },
  });
  assertEquals(result.success, false);
});

Deno.test("[session_delegate] SessionDelegateConfigSchema rejects unknown tool", () => {
  const result = SessionDelegateConfigSchema.safeParse({
    tool: "vim",
    gates: ["review"],
  });
  assertEquals(result.success, false);
});

Deno.test("[session_delegate] SessionWaitStateSchema round-trip", () => {
  const result = SessionWaitStateSchema.safeParse({
    trace_id: "00000000-0000-4000-8000-000000000002",
    gate: "code_changes",
    resume_token: "tok-xyz-456",
    deadline: "2026-07-02T00:00:00.000Z",
    status: "pending",
    created_at: "2026-06-11T10:00:00.000Z",
  });
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.data.status, "pending");
});

Deno.test("[session_delegate] SessionWaitStateSchema rejects unknown status", () => {
  const result = SessionWaitStateSchema.safeParse({
    trace_id: "00000000-0000-0000-0000-000000000003",
    gate: "refinement",
    resume_token: "tok-bad",
    deadline: "2026-07-01T00:00:00.000Z",
    status: "waiting",
    created_at: "2026-06-11T10:00:00.000Z",
  });
  assertEquals(result.success, false);
});

Deno.test("[session_delegate] SESSION_GATE_DECISIONS covers every gate", () => {
  for (const gate of SessionGateSchema.options) {
    const allowed = SESSION_GATE_DECISIONS[gate];
    assertEquals(Array.isArray(allowed), true, `gate '${gate}' must have an allowed-decision list`);
    assertEquals(allowed.length > 0, true, `gate '${gate}' must allow at least one decision`);
  }
});

Deno.test("[session_delegate] isDecisionValidForGate accepts the canonical per-gate verbs", () => {
  assertEquals(isDecisionValidForGate("refinement", "enriched"), true);
  assertEquals(isDecisionValidForGate("plan_review", "approved"), true);
  assertEquals(isDecisionValidForGate("plan_review", "amended"), true);
  assertEquals(isDecisionValidForGate("plan_review", "rejected"), true);
  assertEquals(isDecisionValidForGate("code_changes", "changes_made"), true);
  assertEquals(isDecisionValidForGate("review", "approved"), true);
  assertEquals(isDecisionValidForGate("review", "rejected"), true);
});

Deno.test("[session_delegate] isDecisionValidForGate rejects cross-gate verbs", () => {
  // code_changes verb on a refinement gate
  assertEquals(isDecisionValidForGate("refinement", "changes_made"), false);
  // refinement verb on a code_changes gate
  assertEquals(isDecisionValidForGate("code_changes", "enriched"), false);
  // amend is a plan-only verb — not valid at review
  assertEquals(isDecisionValidForGate("review", "amended"), false);
  // changes_made is not a plan_review verb
  assertEquals(isDecisionValidForGate("plan_review", "changes_made"), false);
});

Deno.test("[session_delegate] isDecisionValidForGate accepts 'abandoned' at every gate", () => {
  for (const gate of SessionGateSchema.options) {
    assertEquals(isDecisionValidForGate(gate, "abandoned"), true, `'abandoned' must be valid at '${gate}'`);
  }
});

Deno.test("[session_delegate] every matrix entry uses a real decision verb", () => {
  const validVerbs = new Set(SessionDecisionSchema.options);
  for (const gate of SessionGateSchema.options) {
    for (const decision of SESSION_GATE_DECISIONS[gate]) {
      assertEquals(validVerbs.has(decision), true, `'${decision}' for '${gate}' must be a known decision verb`);
    }
  }
});

// Regression: a hardcoded `Workspace/**` permitted_paths can never match the
// worktree-relative paths a portal code change touches (`src/main.ts`).
Deno.test("[session_delegate] SessionDelegateConfigSchema accepts operator-declared permitted_paths", () => {
  const parsed = SessionDelegateConfigSchema.parse({
    enabled: true,
    tool: "claude-code",
    gates: ["code_changes"],
    launch_mode: "headless",
    permitted_paths: ["src/**", "tests/**"],
  });
  assertEquals(parsed.permitted_paths, ["src/**", "tests/**"]);
});

Deno.test("[session_delegate] SessionDelegateConfigSchema leaves permitted_paths absent when unset", () => {
  const parsed = SessionDelegateConfigSchema.parse({
    enabled: true,
    tool: "claude-code",
    gates: ["code_changes"],
  });
  assertEquals(parsed.permitted_paths, undefined);
});

Deno.test("[session_delegate] SessionDelegateConfigSchema rejects an empty permitted_paths list", () => {
  assertThrows(() =>
    SessionDelegateConfigSchema.parse({
      enabled: true,
      tool: "claude-code",
      gates: ["code_changes"],
      permitted_paths: [],
    })
  );
});
