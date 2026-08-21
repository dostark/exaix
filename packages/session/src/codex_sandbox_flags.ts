/**
 * @module CodexSandboxFlags
 * @path packages/session/src/codex_sandbox_flags.ts
 * @description Derives the bounded Codex CLI sandbox mode for a session gate.
 *   Workspace-write confines code-change sessions to the worktree root; all other
 *   gates are read-only. Fine-grained permitted-path enforcement remains post-hoc.
 * @architectural-layer Services
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/session/src/session_delegate_service.ts, packages/session/src/scope_checker.ts]
 */

import { SESSION_FLAG_SANDBOX, SESSION_SANDBOX_READ_ONLY, SESSION_SANDBOX_WORKSPACE_WRITE } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import type { SessionBrief } from "@exaix/schemas/session_delegate.ts";

const CODE_CHANGES_GATE = "code_changes";

/** Return the explicit Codex sandbox argv for the brief's gate. */
export function deriveCodexSandboxFlags(
  brief: Opt<SessionBrief, Reason.AbstractBoundary>,
): string[] {
  const mode = brief?.gate === CODE_CHANGES_GATE ? SESSION_SANDBOX_WORKSPACE_WRITE : SESSION_SANDBOX_READ_ONLY;
  return [SESSION_FLAG_SANDBOX, mode];
}
