/**
 * @module ISessionAdapter
 * @path packages/session/src/i_session_adapter.ts
 * @description Per-tool launch-strategy contract for Phase 106 session delegation.
 *   An adapter turns a brief into a hardened launch descriptor (no shell string,
 *   no secrets) and can synthesize a schema-valid return for tools that lack
 *   native return.json emission.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/session/src/session_adapter_registry.ts, packages/schemas/src/session_delegate.ts]
 */

import type { SessionBrief, SessionLaunchMode, SessionReturn, SessionTool } from "@exaix/schemas/session_delegate.ts";

/** Hardened launch descriptor: `command`/`args` are never a shell string, and `env` carries only additive, non-secret token-budget variables. */
export interface ISessionLaunch {
  /** Bare binary name or absolute path — never shell-interpolated. */
  command: string;
  /** Discrete argv items (brief path, budget flags, or the workspace folder). */
  args: string[];
  /** Working directory: the worktree for code gates, else the session dir. */
  cwd: string;
  /** Additive token-budget env vars only — provider secrets are never included. */
  env: Record<string, string>;
  /** Path to a generated OpenCode permission config; HeadlessSessionLauncher injects it via OPENCODE_CONFIG. */
  configPath?: string;
}

/** Per-tool launch strategy, registered in the SessionAdapterRegistry. */
export interface ISessionAdapter {
  readonly tool: SessionTool;
  /** Whether the tool can be spawned on the caller's TTY (Mode 2). */
  readonly supportsSupervised: boolean;
  /** Whether the tool supports non-interactive headless launch (Mode 3). */
  readonly supportsHeadless: boolean;
  /** Throws when `mode` is supervised but the tool is advisory-only. */
  buildLaunch(brief: SessionBrief, mode: SessionLaunchMode, briefPath: string): ISessionLaunch;
  /** For a tool without native return.json emission: token stats are zeroed, decision is the brief gate's success verb. */
  synthesizeReturn(brief: SessionBrief, pathsTouched: string[]): SessionReturn;
}
