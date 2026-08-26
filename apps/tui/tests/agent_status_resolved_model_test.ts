/**
 * @module AgentStatusResolvedModelTest
 * @path apps/tui/tests/agent_status_resolved_model_test.ts
 * @description Phase 132 GAP-10 remediation (132.27) — the TUI agent status view shows
 *   the resolved provider:model from the journaled model.resolved event. Verifies the
 *   derived-model contract (structured and legacy payloads, absence) and the status line
 *   renderer.
 * @architectural-layer Test
 * @related-files [apps/tui/src/agent_status/resolved_model.ts]
 */

import { assertEquals } from "@std/assert";
import { deriveResolvedModel, renderResolvedModelLine } from "../src/agent_status/resolved_model.ts";

Deno.test("[132.27] deriveResolvedModel returns the latest model.resolved selected provider:model", () => {
  const entries = [
    { action: "llm.call", payload: {} },
    { action: "model.resolved", payload: { selected: { provider: "anthropic", model: "claude-haiku" } } },
    { action: "model.resolved", payload: { selected: { provider: "google", model: "gemini" } } },
  ];
  assertEquals(deriveResolvedModel(entries), "google:gemini");
});

Deno.test("[132.27] deriveResolvedModel accepts legacy string selected payloads", () => {
  const entries = [{ action: "model.resolved", payload: { selected: "openai:gpt-5-mini" } }];
  assertEquals(deriveResolvedModel(entries), "openai:gpt-5-mini");
});

Deno.test("[132.27] deriveResolvedModel returns undefined without a usable model.resolved entry", () => {
  assertEquals(deriveResolvedModel([]), undefined);
  assertEquals(
    deriveResolvedModel([{ action: "llm.call", payload: { selected: { provider: "x", model: "y" } } }]),
    undefined,
  );
  assertEquals(
    deriveResolvedModel([{ action: "model.resolved", payload: { selected: { provider: "x" } } }]),
    undefined,
  );
});

Deno.test("[132.27] the status line prefers the declared model and falls back to the resolved one", () => {
  assertEquals(renderResolvedModelLine("mock:test-model", []), "mock:test-model");
  assertEquals(
    renderResolvedModelLine("", [{
      action: "model.resolved",
      payload: { selected: { provider: "anthropic", model: "claude-haiku" } },
    }]),
    "anthropic:claude-haiku",
  );
  assertEquals(renderResolvedModelLine("", []), "(resolving)");
});
