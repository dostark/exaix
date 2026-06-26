/**
 * @module CostAndConfigTest
 * @path packages/session/tests/cost_and_config_test.ts
 * @description Phase 106 Step 9 — tests for GAP-6 cost-record mapping, GAP-7
 *   config precedence resolution, and the global [session_delegate] config
 *   attachment. Delegated token stats become a CostTracker record with a
 *   "session:" provider and a documented USD sentinel; the most specific config
 *   scope wins.
 */

import { assertEquals } from "@std/assert";
import { SessionDelegateConfigSchema, SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionDelegateConfig, SessionReturn } from "@exaix/schemas/session_delegate.ts";
import { sessionReturnToCostRecord } from "@exaix/session/cost_mapping.ts";
import { resolveSessionDelegateConfig } from "@exaix/session/config_resolver.ts";

const NOW = new Date("2026-06-11T00:00:00.000Z");

function ret(model?: string): SessionReturn {
  return SessionReturnSchema.parse({
    trace_id: "00000000-0000-0000-0000-000000000c09",
    resume_token: "tok",
    decision: "changes_made",
    summary: "done",
    paths_touched: ["src/a.ts"],
    token_stats: { input_tokens: 8_000, output_tokens: 4_000, total_tokens: 12_000, model },
  });
}

function cfg(tool: SessionDelegateConfig["tool"]): SessionDelegateConfig {
  return { enabled: true, tool, gates: ["code_changes"], launch_mode: "advisory", harden_permissions: false };
}

Deno.test("[cost_mapping] GAP-6 — maps token_stats to a session cost record with a USD sentinel", () => {
  const record = sessionReturnToCostRecord({
    id: "cost-1",
    tool: "claude-code",
    sessionReturn: ret("claude-opus-4-8"),
    traceId: "trace-1",
    timestamp: NOW,
  });
  assertEquals(record.provider, "session:claude-code");
  assertEquals(record.model, "claude-opus-4-8");
  assertEquals(record.promptTokens, 8_000);
  assertEquals(record.completionTokens, 4_000);
  assertEquals(record.tokens, 12_000);
  assertEquals(record.estimatedCostUsd, 0); // external/unmetered sentinel
  assertEquals(record.traceId, "trace-1");
});

Deno.test("[cost_mapping] GAP-6 — an absent model falls back to the Unknown label", () => {
  const record = sessionReturnToCostRecord({ id: "c", tool: "opencode", sessionReturn: ret(), timestamp: NOW });
  assertEquals(record.model, "Unknown");
});

Deno.test("[cost_mapping] cost_usd from ISessionCostInput overrides sessionReturn.cost_usd", () => {
  const sessionReturn = SessionReturnSchema.parse({
    trace_id: "00000000-0000-0000-0000-000000000c10",
    resume_token: "tok",
    decision: "changes_made",
    summary: "done",
    paths_touched: ["src/a.ts"],
    token_stats: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    cost_usd: 0.002,
  });
  const record = sessionReturnToCostRecord({
    id: "cost-2",
    tool: "opencode",
    sessionReturn,
    costUsd: 0.005,
    timestamp: NOW,
  });
  assertEquals(record.estimatedCostUsd, 0.005);
});

Deno.test("[cost_mapping] cost_usd from sessionReturn.cost_usd used when ISessionCostInput.costUsd absent", () => {
  const sessionReturn = SessionReturnSchema.parse({
    trace_id: "00000000-0000-0000-0000-000000000c11",
    resume_token: "tok",
    decision: "changes_made",
    summary: "done",
    paths_touched: ["src/b.ts"],
    token_stats: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
    cost_usd: 0.015,
  });
  const record = sessionReturnToCostRecord({
    id: "cost-3",
    tool: "claude-code",
    sessionReturn,
    timestamp: NOW,
  });
  assertEquals(record.estimatedCostUsd, 0.015);
});

Deno.test("[cost_mapping] cost_usd defaults to 0 when absent from both input and return", () => {
  const sessionReturn = SessionReturnSchema.parse({
    trace_id: "00000000-0000-0000-0000-000000000c12",
    resume_token: "tok",
    decision: "changes_made",
    summary: "done",
    paths_touched: [],
    token_stats: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  });
  const record = sessionReturnToCostRecord({
    id: "cost-4",
    tool: "opencode",
    sessionReturn,
    timestamp: NOW,
  });
  assertEquals(record.estimatedCostUsd, 0); // external/unmetered sentinel
});

Deno.test("[config_resolver] GAP-7 — the most specific scope wins", () => {
  const resolved = resolveSessionDelegateConfig({
    global: cfg("vscode"),
    portal: cfg("cursor"),
    blueprint: cfg("opencode"),
    request: cfg("claude-code"),
  });
  assertEquals(resolved?.tool, "claude-code");

  const portalWins = resolveSessionDelegateConfig({ global: cfg("vscode"), portal: cfg("cursor") });
  assertEquals(portalWins?.tool, "cursor");
});

Deno.test("[config_resolver] GAP-7 — undefined when no scope provides a config", () => {
  assertEquals(resolveSessionDelegateConfig({}), undefined);
});

Deno.test("[config] GAP-7 — the [session_delegate] block parses with enabled defaulting to false", () => {
  // The same schema attached to ConfigSchema.session_delegate (verified at compile
  // time in config.ts); here we assert the block's own defaulting behavior.
  const parsed = SessionDelegateConfigSchema.safeParse({ tool: "claude-code", gates: ["plan_review"] });
  assertEquals(parsed.success, true);
  if (parsed.success) {
    assertEquals(parsed.data.enabled, false);
    assertEquals(parsed.data.launch_mode, "advisory");
  }
});
