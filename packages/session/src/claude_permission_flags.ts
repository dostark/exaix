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
import type { Opt, Reason } from "@exaix/core/types";

const CLAUDE_PERMISSION_MODE_DEFAULT = "acceptEdits";
const CLAUDE_ALLOWED_TOOLS_DEFAULT = "Read,Edit,Bash(git *)";

/** `extraAllowedTools` (e.g. the dogfood context MCP tool names) is appended to the
 *  single `--allowedTools` value — Claude Code accepts only one such flag, so a second
 *  connection-scoped grant must widen the existing value rather than pass a competing flag. */
export function deriveClaudeToolFlags(
  _brief?: Opt<SessionBrief, Reason.AbstractBoundary>,
  extraAllowedTools?: Opt<readonly string[], Reason.OptionalInput>,
): string[] {
  const allowedTools = extraAllowedTools && extraAllowedTools.length > 0
    ? [CLAUDE_ALLOWED_TOOLS_DEFAULT, ...extraAllowedTools].join(",")
    : CLAUDE_ALLOWED_TOOLS_DEFAULT;
  return [
    SESSION_FLAG_PERMISSION_MODE,
    CLAUDE_PERMISSION_MODE_DEFAULT,
    SESSION_FLAG_ALLOWED_TOOLS,
    allowedTools,
  ];
}
