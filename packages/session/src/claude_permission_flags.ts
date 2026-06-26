/**
 * @module ClaudePermissionFlags
 * @path packages/session/src/claude_permission_flags.ts
 * @description Phase 128 Step 3 — derives --permission-mode and --allowedTools
 *   CLI flags for headless Claude Code launches. The permission mode defaults to
 *   acceptEdits (never bypassPermissions on a real brief). --allowedTools scopes
 *   the tool surface to Read, Edit, and Bash(git *) — no wildcard Bash.
 *   Path confinement for claude-code = worktree checkout boundary + post-hoc
 *   checkScope; --allowedTools constrains the tool surface, not the path set.
 * @architectural-layer Services
 * @related-files [packages/session/src/session_adapter_registry.ts, packages/core/src/types/constants.ts]
 */

import type { SessionBrief } from "@exaix/schemas/session_delegate.ts";
import { SESSION_FLAG_ALLOWED_TOOLS, SESSION_FLAG_PERMISSION_MODE } from "@exaix/core/types";

export const CLAUDE_PERMISSION_MODE_DEFAULT = "acceptEdits";
export const CLAUDE_ALLOWED_TOOLS_DEFAULT = "Read,Edit,Bash(git *)";

export function deriveClaudeToolFlags(
  _brief: SessionBrief,
): string[] {
  return [
    SESSION_FLAG_PERMISSION_MODE,
    CLAUDE_PERMISSION_MODE_DEFAULT,
    SESSION_FLAG_ALLOWED_TOOLS,
    CLAUDE_ALLOWED_TOOLS_DEFAULT,
  ];
}
