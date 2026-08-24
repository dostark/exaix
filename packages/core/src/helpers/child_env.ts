/**
 * @module ChildEnvPolicy
 * @path packages/core/src/helpers/child_env.ts
 * @description Single shared policy for building the environment of any spawned
 *   child process. Replaces the three divergent per-spawn sanitizers (SafeSubprocess's
 *   dynamic-linker-only strip, packages/session supervised_launch's allowlist, and the
 *   ai-clidelegate/execution buildDelegateEnv copies) with one canonical construction,
 *   so a parent env var either reaches every child, or no child, consistently.
 *
 *   The policy is fail-closed against ambient parent-environment leakage:
 *   - `allowlist` children (foreign agent binaries: claude, opencode, codex) receive
 *     ONLY the safe parent keys + an explicit launch env; secret-named vars,
 *     dynamic-linker vars, interpreter-overlay vars, git env-config injection and
 *     proxy vars are all excluded from both sources.
 *   - `inherit` children (first-party tools the daemon itself trusts: git, deno-run
 *     plan steps) receive the full parent env minus the injection CLASSES above —
 *     the vars that either Deno's scoped `--allow-run` refuses to forward
 *     (`Deno.errors.NotCapable: Requires --allow-run permissions to spawn subprocess
 *     with <VAR>`) or that inject code/config into the child independently of argv
 *     (interpreter startup files, git `-c` config from environment). Secrets and
 *     proxy vars are preserved for these trusted tools (a corporate HTTP proxy is
 *     legitimate for `git`; Phase 167 Step 4 live finding: a daemon spawned with
 *     `LD_LIBRARY_PATH` in its parent env silently failed every git/tool subprocess).
 *
 *   Proxy vars are classified separately from injection vars so `inherit` mode keeps
 *   them while `allowlist` mode excludes them by construction.
 * @architectural-layer Core
 * @dependencies []
 * @related-files [packages/core/src/helpers/subprocess.ts, packages/session/src/supervised_launch.ts, packages/ai-clidelegate/src/cli_delegate_model_provider.ts, packages/execution/src/strategies/cli_delegate_strategy.ts, apps/daemon/main.ts, apps/exactl/src/exactl.ts]
 */

export type ChildEnvMode = "inherit" | "allowlist";

export interface IChildEnvOptions {
  /** `inherit`: full parent env minus injection vars (first-party trusted tools).
   *  `allowlist`: safe parent keys + explicit launch env only (foreign agents). */
  mode: ChildEnvMode;
  /** Explicit env to overlay (inherit) or the launch env (allowlist). */
  env?: Record<string, string>;
  /** Inherit mode only: start from an empty parent instead of the process env. */
  clearEnv?: boolean;
  /** Explicit parent env (inherited when omitted). */
  parentEnv?: Record<string, string>;
}

/** Parent env vars safe to forward to ANY child — including a foreign agent binary. */
export const ALLOWED_PARENT_ENV_KEYS: readonly string[] = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR"];

/** Variables whose name implies a secret — never forwarded to a foreign agent child. */
export const SECRET_ENV_PATTERN = /API_KEY|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY/i;

/** Env var name prefixes instructing the dynamic linker to load arbitrary shared
 *  libraries into the child. Deno's scoped `--allow-run=<bin>` permission refuses to
 *  forward these to a spawned child outright, so they can never be passed. */
export const DYNAMIC_LINKER_ENV_PREFIXES: readonly string[] = ["LD_", "DYLD_"];

/** Env vars that make a child process execute parent-controlled code or config at
 *  startup, independent of argv: interpreter/codegen overlay files (shell, node,
 *  python, ruby, perl) and gem/class roots. Same injection class as LD_PRELOAD. */
export const INTERPRETER_OVERLAY_ENV_KEYS: readonly string[] = [
  "BASH_ENV",
  "ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "RUBYOPT",
  "PERL5LIB",
  "GEM_HOME",
  "GEM_PATH",
];

/** Env vars that inject `git -c` configuration into every `git` child (the
 *  CVE-2022-24765 family): GIT_CONFIG_COUNT together with GIT_CONFIG_KEY_n /
 *  GIT_CONFIG_VALUE_n, plus the legacy GIT_CONFIG_PARAMETERS form. Env-provided
 *  config can redirect what an untrusted-repo `git submodule update` runs. */
export const GIT_ENV_CONFIG_KEYS: readonly string[] = ["GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"];

/** Prefixes of the paired `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` vars. */
export const GIT_ENV_CONFIG_PREFIXES: readonly string[] = ["GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"];

/** Proxy/redirection vars that can point a child's network traffic at a
 *  man-in-the-middle. Excluded from foreign (allowlist) children; preserved for
 *  trusted (inherit) tools where a corporate proxy is legitimate. */
export const PROXY_ENV_KEYS: readonly string[] = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
];

/** True for env vars in the injection class: dynamic-linker prefixes, interpreter
 *  overlay files, or git env-config injection. These are scrubbed from every child. */
export function isInjectionEnvVar(key: string): boolean {
  if (DYNAMIC_LINKER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  if (INTERPRETER_OVERLAY_ENV_KEYS.includes(key)) return true;
  if (GIT_ENV_CONFIG_KEYS.includes(key)) return true;
  return GIT_ENV_CONFIG_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Return `env` with every injection-class var (`injection-env`) removed. */
export function stripInjectionEnvVars(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (isInjectionEnvVar(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Build the fail-closed env for a FOREIGN agent child: the safe parent allowlist
 *  plus the explicit non-secret launch env, with injection vars and proxy vars
 *  excluded from both. Allows the caller (supervised_launch/session) to layer the
 *  injected delegate-provider key afterwards via merge. Pure: parent env is passed
 *  in, never read from the process. */
export function buildAllowlistChildEnv(
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
    if (isInjectionEnvVar(key)) continue;
    if (PROXY_ENV_KEYS.includes(key)) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Build the child env for a Deno.Command spawn. Returns `clearEnv: true` so the
 * built env is authoritative — Deno 2.x would otherwise merge `env` with the
 * process parent env, silently reintroducing scrubbed vars (Phase 167 Step 4 live
 * finding: the merged parent's `LD_LIBRARY_PATH` re-leaked and killed the spawn).
 */
export function buildChildEnv(options: IChildEnvOptions): { env: Record<string, string>; clearEnv: boolean } {
  if (options.mode === "allowlist") {
    const env = buildAllowlistChildEnv(options.env ?? {}, options.parentEnv ?? Deno.env.toObject());
    return { env, clearEnv: true };
  }
  const inherited = options.clearEnv ? {} : (options.parentEnv ?? Deno.env.toObject());
  const merged = { ...inherited, ...(options.env ?? {}) };
  return { env: stripInjectionEnvVars(merged), clearEnv: true };
}

/** Remove every injection-class var from the CURRENT process env. Called at daemon
 *  and exactl entry so inherited ambient vars (`LD_LIBRARY_PATH` from HPC toolchains,
 *  `NODE_OPTIONS`, git env-config, …) never reach ANY child — including the raw
 *  Deno.Command call sites that bypass SafeSubprocess. Secrets and proxy vars are
 *  deliberately kept: the daemon itself needs its provider keys, and a corporate
 *  proxy is legitimate for its own outbound git/network traffic. */
export function scrubProcessEnv(): void {
  for (const key of Object.keys(Deno.env.toObject())) {
    if (isInjectionEnvVar(key)) {
      Deno.env.delete(key);
    }
  }
}
