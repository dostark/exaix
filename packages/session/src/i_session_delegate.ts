/**
 * @module ISessionDelegate
 * @path packages/session/src/i_session_delegate.ts
 * @description Service-level contract for Phase 106 session delegation:
 *   brief materialization (prepareBrief) and launch resolution (resolveLaunch).
 *   Package-pure (GAP-13): the service takes a path-safety helper, a clock, the
 *   adapter registry, and a pre-resolved absolute Session dir — never Config.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/session/src/session_delegate_service.ts, packages/session/src/i_session_adapter.ts]
 */

import type {
  SessionBrief,
  SessionDelegateConfig,
  SessionGate,
  SessionLaunchMode,
  SessionTokenBudget,
  SessionTool,
} from "@exaix/schemas/session_delegate.ts";
import type { PathResolver } from "@exaix/portal";
import type { ISessionLaunch } from "./i_session_adapter.ts";

/** Monotonic clock seam so deadlines are deterministic under test. */
export interface ISessionClock {
  now(): Date;
}

/** Config-free path-safety seam (wraps tool-runtime PathSecurity). */
export interface ISessionPathSafety {
  /** Normalize and reject traversal / null bytes; returns the safe relative path. */
  normalize(path: string): string;
}

/** Input to SessionDelegateService.prepareBrief(). */
export interface IPrepareBriefInput {
  traceId: string;
  parentTraceId?: string;
  parentStepId?: string;
  sequence?: number;
  /** The blueprint identity_id actually delegating this session. */
  identityId: string;
  gate: SessionGate;
  tool: SessionTool;
  objective: string;
  /**
   * Model the delegate tool should use (headless `--model <model>`). Optional.
   * **Must be a pre-resolved `provider:model` string** — pass through `ModelResolver.resolve()`
   * first. Raw `model_size` values (e.g. "M", "L") will be rejected by `prepareBrief()`.
   */
  model?: string;
  /** Artifact under work (request / plan / diff), worktree-relative. */
  artifactRef: string;
  /** Worktree-relative globs the tool may modify. */
  permittedPaths: string[];
  tokenBudget: SessionTokenBudget;
  contextCardRef?: string;
  /** Absolute worktree checkout for code_changes / review gates. */
  worktreePath?: string;
  acceptanceCriteria?: string[];
  /** ISO override; defaults to clock.now() + SESSION_DEFAULT_DEADLINE_HOURS. */
  deadline?: string;
}

/** Result of a hardened-launch resolution (Phase 128 R3 Step 5). */
export interface IHardenedLaunchResult {
  launch: ISessionLaunch;
  /** If true, the generated agent.<identity_id> key mismatches brief.identity_id. */
  agentNameMismatch: boolean;
  /**
   * Warning from the version probe when the delegate binary is below the
   * minimum supported version. Undefined when the probe is clean.
   */
  versionWarning?: string;
}

/** Package-pure orchestration of the brief/launch half of the contract. */
export interface ISessionDelegateService {
  /** Materialize Session/{traceId}/brief.json atomically and return the brief. */
  prepareBrief(input: IPrepareBriefInput): Promise<SessionBrief>;
  /** Resolve the per-tool adapter and build a launch for the brief. */
  resolveLaunch(brief: SessionBrief, mode: SessionLaunchMode): ISessionLaunch;
  /**
   * Resolve a hardened launch with permission hardening (Phase 128 R3).
   * Only supported for headless mode. Uses the version probe + per-tool
   * permission generator when brief.tool is opencode or claude-code.
   * Returns the launch descriptor and any agent-name mismatch info.
   */
  resolveHardenedLaunch(
    brief: SessionBrief,
    mode: SessionLaunchMode,
    config: SessionDelegateConfig,
    pathResolver: PathResolver,
  ): Promise<IHardenedLaunchResult>;
  /**
   * Resolve the delegate provider env for a given config + tool combo.
   * Reads no env vars itself (package-pure); the caller (main.ts) resolves
   * the key_env and passes the value. Returns an empty record when there is
   * no provider block.
   */
  resolveDelegateEnv(
    config: SessionDelegateConfig,
    tool: SessionTool,
    providerApiKey: string,
  ): Record<string, string>;
}
