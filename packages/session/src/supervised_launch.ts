/**
 * @module SupervisedLaunch
 * @path packages/session/src/supervised_launch.ts
 * @description Phase 106 Step 8 — GAP-4 supervised-launch hardening. The child a
 *   supervised session tool runs in gets a minimal env allowlist with every
 *   secret-bearing variable stripped (so Exaix provider keys never leak into a
 *   foreign agent), and only an allowlisted binary may be spawned. Package-pure:
 *   the caller passes the parent environment explicitly (no Deno.env here).
 *   Env construction is delegated to the shared child-env policy
 *   (`@exaix/core/helpers/child_env.ts`) — allowlist mode plus post-sanitize
 *   delegate-provider injection.
 * @architectural-layer Services
 * @dependencies [@exaix/core]
 * @related-files [packages/session/src/session_adapter_registry.ts, apps/exactl/src/commands]
 */

import { buildAllowlistChildEnv } from "@exaix/core/helpers/child_env.ts";

export function sanitizeChildEnv(
  launchEnv: Record<string, string>,
  parentEnv: Record<string, string> = {},
): Record<string, string> {
  return buildAllowlistChildEnv(launchEnv, parentEnv);
}

/** Throw unless `bin` is in the per-tool binary allowlist (no shell, no arbitrary exec). */
export function assertBinaryAllowed(bin: string, allowlist: ReadonlySet<string>): void {
  if (!allowlist.has(bin)) {
    throw new Error(`session tool binary is not allowlisted: ${bin}`);
  }
}

/** Must run after sanitizeChildEnv so injected API_KEY vars survive the SECRET_ENV_PATTERN strip. */
export function mergeDelegateEnv(
  sanitizedEnv: Record<string, string>,
  delegateEnv: Record<string, string>,
): Record<string, string> {
  return { ...sanitizedEnv, ...delegateEnv };
}
