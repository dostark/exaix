/**
 * @module SupervisedLaunch
 * @path packages/session/src/supervised_launch.ts
 * @description Phase 106 Step 8 — GAP-4 supervised-launch hardening. The child a
 *   supervised session tool runs in gets a minimal env allowlist with every
 *   secret-bearing variable stripped (so Exaix provider keys never leak into a
 *   foreign agent), and only an allowlisted binary may be spawned. Package-pure:
 *   the caller passes the parent environment explicitly (no Deno.env here).
 * @architectural-layer Services
 * @dependencies []
 * @related-files [packages/session/src/session_adapter_registry.ts, apps/exactl/src/commands]
 */

/** Parent env vars safe to forward to a delegated child process. */
const ALLOWED_PARENT_ENV_KEYS: readonly string[] = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR"];

/** Variables whose name implies a secret — never forwarded to a foreign tool. */
const SECRET_ENV_PATTERN = /API_KEY|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY/i;

/**
 * Build the child environment for a supervised launch: a minimal allowlist of
 * safe parent vars plus the adapter's (non-secret) launch vars. Any secret-named
 * variable is dropped from both sources.
 */
export function sanitizeChildEnv(
  launchEnv: Record<string, string>,
  parentEnv: Record<string, string> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ALLOWED_PARENT_ENV_KEYS) {
    const value = parentEnv[key];
    if (value !== undefined && !SECRET_ENV_PATTERN.test(key)) {
      result[key] = value;
    }
  }
  for (const [key, value] of Object.entries(launchEnv)) {
    if (SECRET_ENV_PATTERN.test(key)) continue;
    result[key] = value;
  }
  return result;
}

/** Throw unless `bin` is in the per-tool binary allowlist (no shell, no arbitrary exec). */
export function assertBinaryAllowed(bin: string, allowlist: ReadonlySet<string>): void {
  if (!allowlist.has(bin)) {
    throw new Error(`session tool binary is not allowlisted: ${bin}`);
  }
}
