/**
 * @module ClaudePermissionFlagsTest
 * @path packages/session/tests/claude_permission_flags_test.ts
 * @description Phase 128 Step 3 — tests for deriveClaudeToolFlags which
 *   derives --permission-mode and --allowedTools flags for Claude Code headless
 *   launches. Asserts the mode defaults to acceptEdits, tool list is scoped,
 *   and bypassPermissions is never emitted for a real brief.
 */

import { assertEquals } from "@std/assert";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionBrief } from "@exaix/schemas/session_delegate.ts";
import { deriveClaudeToolFlags } from "@exaix/session/claude_permission_flags.ts";

function makeBrief(overrides: Partial<SessionBrief> = {}): SessionBrief {
  return SessionBriefSchema.parse({
    trace_id: "00000000-0000-4000-8000-0000000000aa",
    agent_role: "test-role",
    gate: "code_changes",
    tool: "claude-code",
    objective: "Test objective",
    artifact_ref: "Workspace/Plans/req-01_plan.md",
    permitted_paths: ["src/**"],
    worktree_path: "/tmp/worktree/trace-1",
    token_budget: { max_input_tokens: 40_000, max_output_tokens: 30_000, max_total_tokens: 70_000 },
    resume_token: "tok-1",
    deadline: "2026-07-01T00:00:00.000Z",
    ...overrides,
  });
}

Deno.test(
  "[claude_perm] derives --permission-mode (config-driven, defaults acceptEdits)",
  () => {
    const brief = makeBrief();
    const flags = deriveClaudeToolFlags(brief);
    const idx = flags.indexOf("--permission-mode");
    assertEquals(idx >= 0, true, "should contain --permission-mode");
    assertEquals(flags[idx + 1], "acceptEdits");
  },
);

Deno.test(
  "[claude_perm] derives a scoped --allowedTools list (no wildcard Bash)",
  () => {
    const brief = makeBrief();
    const flags = deriveClaudeToolFlags(brief);
    const idx = flags.indexOf("--allowedTools");
    assertEquals(idx >= 0, true, "should contain --allowedTools");
    assertEquals(flags[idx + 1], "Read,Edit,Bash(git *)");
  },
);

Deno.test(
  "[claude_perm] never emits bypassPermissions for a real (non-test) brief",
  () => {
    const brief = makeBrief();
    const flags = deriveClaudeToolFlags(brief);
    assertEquals(flags.includes("bypassPermissions"), false);
    assertEquals(flags.includes("--dangerously-skip-permissions"), false);
  },
);
