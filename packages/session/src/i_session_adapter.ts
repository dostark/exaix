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

/**
 * Hardened launch descriptor (GAP-4). `command` is a bare binary and `args` are
 * discrete argv items — never a shell string. `env` carries only the additive,
 * non-secret token-budget variables the child should see.
 */
export interface ISessionLaunch {
  /** Bare binary name or absolute path — never shell-interpolated. */
  command: string;
  /** Discrete argv items (brief path, budget flags, or the workspace folder). */
  args: string[];
  /** Working directory: the worktree for code gates, else the session dir. */
  cwd: string;
  /** Additive token-budget env vars only — provider secrets are never included. */
  env: Record<string, string>;
}

/** Per-tool launch strategy, registered in the SessionAdapterRegistry. */
export interface ISessionAdapter {
  readonly tool: SessionTool;
  /** Whether the tool can be spawned on the caller's TTY (Mode 2). */
  readonly supportsSupervised: boolean;
  /** Whether the tool supports non-interactive headless launch (Mode 3, Phase 111). */
  readonly supportsHeadless: boolean;
  /**
   * Build a launch descriptor for the brief. `briefPath` is the absolute path to
   * the materialized brief.json the tool/human reads. Throws when `mode` is
   * supervised but the tool is advisory-only.
   */
  buildLaunch(brief: SessionBrief, mode: SessionLaunchMode, briefPath: string): ISessionLaunch;
  /**
   * Construct a schema-valid return for a tool that does not emit return.json
   * natively (R5). Token stats are best-effort (zeroed) and the decision is the
   * canonical success verb for the brief's gate.
   */
  synthesizeReturn(brief: SessionBrief, pathsTouched: string[]): SessionReturn;
}
