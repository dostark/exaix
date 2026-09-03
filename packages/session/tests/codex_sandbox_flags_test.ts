/**
 * @module CodexSandboxFlagsTest
 * @path packages/session/tests/codex_sandbox_flags_test.ts
 * @description Verifies Phase 167 Codex sandbox modes remain deny-by-default for every session gate.
 * @architectural-layer Tests
 * @related-files [packages/session/src/codex_sandbox_flags.ts]
 */

import { assertEquals } from "@std/assert";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionBrief, SessionGate } from "@exaix/schemas/session_delegate.ts";
import { deriveCodexSandboxFlags } from "@exaix/session/codex_sandbox_flags.ts";

function makeBrief(gate: SessionGate): SessionBrief {
  return SessionBriefSchema.parse({
    trace_id: "00000000-0000-4000-8000-000000000167",
    agent_role: "test-identity",
    gate,
    tool: "codex",
    objective: "Apply the requested change",
    artifact_ref: "Workspace/Plans/phase-167.md",
    permitted_paths: ["packages/session/**"],
    worktree_path: "/tmp/phase-167-worktree",
    token_budget: { max_input_tokens: 10_000, max_output_tokens: 5_000, max_total_tokens: 15_000 },
    resume_token: "phase-167-token",
    deadline: "2026-08-21T00:00:00.000Z",
  });
}

const EXPECTED_MODES: ReadonlyArray<[SessionGate, string]> = [
  ["refinement", "read-only"],
  ["plan_review", "read-only"],
  ["code_changes", "workspace-write"],
  ["review", "read-only"],
];

Deno.test("[codex_sandbox] every gate maps to the exact bounded sandbox mode", () => {
  for (const [gate, mode] of EXPECTED_MODES) {
    assertEquals(deriveCodexSandboxFlags(makeBrief(gate)), ["--sandbox", mode], gate);
  }
});

Deno.test("[codex_sandbox][security] never emits escape or approval-bypass flags", () => {
  for (const [gate] of EXPECTED_MODES) {
    const flags = deriveCodexSandboxFlags(makeBrief(gate));
    assertEquals(flags.includes("danger-full-access"), false, gate);
    assertEquals(flags.includes("--add-dir"), false, gate);
    assertEquals(flags.includes("--dangerously-bypass-approvals-and-sandbox"), false, gate);
    assertEquals(flags.includes("--yolo"), false, gate);
  }
});
