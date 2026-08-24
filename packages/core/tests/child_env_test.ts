/**
 * @module ChildEnvPolicyTest
 * @path packages/core/tests/child_env_test.ts
 * @description Phase 167 Step 4 closure: the shared child-environment policy
 *   (`packages/core/src/helpers/child_env.ts`). A single policy replaces the three
 *   divergent per-spawn sanitizers (SafeSubprocess, `sanitizeChildEnv`,
 *   `buildDelegateEnv`) and the ad-hoc per-site env handling that otherwise leaks
 *   ambient parent vars into spawned children. Allowed parent keys are allowlisted;
 *   secret-named vars never reach a child; dynamic-linker vars (`LD_*`/`DYLD_*`),
 *   interpreter-config overlay vars (`NODE_OPTIONS`, `PYTHONPATH`, `BASH_ENV`, …) and
 *   git env-config injection vars (`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*`) are stripped
 *   from every child — Deno's scoped `--allow-run` refuses the dynamic-linker set
 *   outright, and the overlay/git sets are ambient code-injection vectors on par with
 *   them. Proxy vars are excluded from foreign (allowlist) children by construction
 *   but preserved for trusted tools (a corporate proxy is legitimate for `git`).
 */

import { assert, assertEquals } from "@std/assert";
import {
  ALLOWED_PARENT_ENV_KEYS,
  buildAllowlistChildEnv,
  buildChildEnv,
  isInjectionEnvVar,
  scrubProcessEnv,
} from "@exaix/core";
import { SECRET_ENV_PATTERN } from "@exaix/core/helpers/child_env.ts";

Deno.test("[child-env] allowlist build forwards only safe parent keys and non-secret launch env", () => {
  const parentEnv: Record<string, string> = {
    PATH: "/usr/bin",
    HOME: "/home/user",
    LANG: "en_US.UTF-8",
    SSH_AUTH_SOCK: "/run/user/1000/ssh.sock", // not secret-named, but not allowlisted
    OPENAI_API_KEY: "sk-leak",
    AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI",
    GITHUB_TOKEN: "ghp-leak",
    NODE_OPTIONS: "--require /tmp/evil.js",
  };
  const env = buildAllowlistChildEnv({ SOME_API_KEY: "leak", MY_LAUNCH_VAR: "ok", LD_LIBRARY_PATH: "/bad" }, parentEnv);

  for (const key of ALLOWED_PARENT_ENV_KEYS) {
    if (key in parentEnv) {
      assertEquals(env[key], parentEnv[key], `allowlisted ${key} must be forwarded`);
    }
  }
  assertEquals(env.SSH_AUTH_SOCK, undefined, "non-allowlisted parent var must be dropped");
  assertEquals(env.OPENAI_API_KEY, undefined, "secret-named parent var must be dropped");
  assertEquals(env.AWS_SECRET_ACCESS_KEY, undefined, "AWS secret-named parent var must be dropped");
  assertEquals(env.GITHUB_TOKEN, undefined, "unlisted token var must be dropped");
  assertEquals(env.NODE_OPTIONS, undefined, "interpreter-overlay var must never reach a child");
  assertEquals(env.SOME_API_KEY, undefined, "secret-named launch var must be dropped");
  assertEquals(env.MY_LAUNCH_VAR, "ok", "non-secret explicit launch var must survive");
  assertEquals(env.LD_LIBRARY_PATH, undefined, "dynamic-linker var from launch env must be stripped");
});

Deno.test("[child-env] allowlist build excludes proxy vars from foreign children", () => {
  const env = buildAllowlistChildEnv({}, {
    PATH: "/usr/bin",
    HTTP_PROXY: "http://mitm.proxy:8080",
    HTTPS_PROXY: "http://mitm.proxy:8080",
    NO_PROXY: "localhost",
  });
  assertEquals(env.HTTP_PROXY, undefined, "HTTP_PROXY must not reach a foreign child");
  assertEquals(env.HTTPS_PROXY, undefined, "HTTPS_PROXY must not reach a foreign child");
  assertEquals(env.NO_PROXY, undefined, "NO_PROXY must not reach a foreign child");
  assertEquals(env.PATH, "/usr/bin", "PATH still forwarded");
});

Deno.test("[child-env] inherit build strips injection-class vars but keeps PATH/safe keys", () => {
  const parentEnv: Record<string, string> = {
    PATH: "/usr/bin",
    HOME: "/home/user",
    LD_LIBRARY_PATH: "/opt/klee/lib",
    DYLD_INSERT_LIBRARIES: "/tmp/x.dylib",
    NODE_OPTIONS: "--require /tmp/evil.js",
    PYTHONPATH: "/tmp/evil",
    BASH_ENV: "/tmp/evil.sh",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.sshCommand",
    GIT_CONFIG_VALUE_0: "echo pwned",
    HTTP_PROXY: "http://corp-proxy:3128",
    EXA_SENTINEL: "keep",
  };
  const { env, clearEnv } = buildChildEnv({ mode: "inherit", env: {}, parentEnv });

  assertEquals(clearEnv, true, "inherit build returns clearEnv so the built env is authoritative");
  assertEquals(env.PATH, "/usr/bin", "PATH must survive inherit mode");
  assertEquals(env.HOME, "/home/user", "HOME must survive inherit mode");
  assertEquals(env.EXA_SENTINEL, "keep", "unrelated env must survive");
  assertEquals(env.HTTP_PROXY, "http://corp-proxy:3128", "trusted tools may keep a corporate proxy");
  assertEquals(env.LD_LIBRARY_PATH, undefined, "LD_LIBRARY_PATH must be stripped");
  assertEquals(env.DYLD_INSERT_LIBRARIES, undefined, "DYLD_* must be stripped");
  assertEquals(env.NODE_OPTIONS, undefined, "NODE_OPTIONS must be stripped");
  assertEquals(env.PYTHONPATH, undefined, "PYTHONPATH must be stripped");
  assertEquals(env.BASH_ENV, undefined, "BASH_ENV must be stripped");
  assertEquals(env.GIT_CONFIG_COUNT, undefined, "GIT_CONFIG_COUNT must be stripped");
  assertEquals(env.GIT_CONFIG_KEY_0, undefined, "GIT_CONFIG_KEY_* must be stripped");
  assertEquals(env.GIT_CONFIG_VALUE_0, undefined, "GIT_CONFIG_VALUE_* must be stripped");
});

Deno.test("[child-env] clearEnv inherit build starts from an empty parent", () => {
  const { env, clearEnv } = buildChildEnv({
    mode: "inherit",
    env: { ONLY_ME: "x", LD_LIBRARY_PATH: "/nope" },
    clearEnv: true,
  });
  assertEquals(clearEnv, true);
  assertEquals(env.ONLY_ME, "x", "explicit env survives");
  assertEquals(env.LD_LIBRARY_PATH, undefined, "dynamic-linker var stripped even from explicit env");
  assertEquals(env.PATH, undefined, "no parent PATH leaked under clearEnv");
});

Deno.test("[child-env] isInjectionEnvVar classifies dynamic-linker, overlay and git-config injection", () => {
  assert(isInjectionEnvVar("LD_LIBRARY_PATH"), "LD_* is an injection var");
  assert(isInjectionEnvVar("DYLD_INSERT_LIBRARIES"), "DYLD_* is an injection var");
  assert(isInjectionEnvVar("NODE_OPTIONS"), "NODE_OPTIONS is an injection var");
  assert(isInjectionEnvVar("PYTHONPATH"), "PYTHONPATH is an injection var");
  assert(isInjectionEnvVar("BASH_ENV"), "BASH_ENV is an injection var");
  assert(isInjectionEnvVar("GIT_CONFIG_COUNT"), "GIT_CONFIG_COUNT is an injection var");
  assert(isInjectionEnvVar("GIT_CONFIG_KEY_0"), "GIT_CONFIG_KEY_* is an injection var");
  assert(isInjectionEnvVar("GIT_CONFIG_VALUE_0"), "GIT_CONFIG_VALUE_* is an injection var");
  assert(!isInjectionEnvVar("PATH"), "PATH is not an injection var");
  assert(!isInjectionEnvVar("HOME"), "HOME is not an injection var");
  assert(!isInjectionEnvVar("EXA_SENTINEL"), "unrelated var is not an injection var");
  assert(!isInjectionEnvVar("HTTP_PROXY"), "proxy vars are not injection vars (kept for trusted tools)");
});

Deno.test("[child-env] bare ENV is a deliberate, pinned injection var (POSIX sh startup-file injection; kept for defense-in-depth, GAP-32)", () => {
  // GAP-32 decision (2026-08-24 post-gap): `ENV` is the POSIX sh startup-file variable that
  // makes an interactive shell source a parent-controlled file on startup — same injection
  // class as BASH_ENV. It is deliberately kept in the overlay class because (a) no production
  // Exaix tool reads a bare `ENV`, so the collision risk is theoretical, and (b) a foreign
  // child inheriting a poisoned ENV pointing at a malicious rc file is a real supply-chain
  // vector. Keeping it scrubbed from every child AND from the daemon/exactl process env at
  // entry is the fail-closed choice; operators who genuinely need ENV set it per-command.
  assert(isInjectionEnvVar("ENV"), "bare ENV must be classified as an injection var");
  const { env } = buildChildEnv({ mode: "inherit", env: {}, parentEnv: { ENV: "/tmp/evil.sh", PATH: "/usr/bin" } });
  assertEquals(env.ENV, undefined, "ENV must be stripped from a child env");
  assertEquals(env.PATH, "/usr/bin");
});

Deno.test("[child-env] SECRET_ENV_PATTERN names common secret shapes", () => {
  for (
    const name of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "DB_PASSWORD",
      "PRIVATE_KEY",
      "GCP_CREDENTIALS",
    ]
  ) {
    assert(SECRET_ENV_PATTERN.test(name), `${name} must match the secret pattern`);
  }
  for (const name of ["PATH", "HOME", "LANG", "TERM", "TMPDIR", "SESSION_ENV_MAX_TOTAL_TOKENS"]) {
    assert(!SECRET_ENV_PATTERN.test(name), `${name} must not match the secret pattern`);
  }
});

Deno.test("[child-env] scrubProcessEnv removes injection-class vars from the process env at entry", () => {
  const originalLD = Deno.env.get("LD_LIBRARY_PATH");
  const originalNode = Deno.env.get("NODE_OPTIONS");
  const originalGitKey = Deno.env.get("GIT_CONFIG_KEY_0");
  const originalProxy = Deno.env.get("HTTP_PROXY");
  Deno.env.set("LD_LIBRARY_PATH", "/opt/klee/lib");
  Deno.env.set("NODE_OPTIONS", "--require /tmp/evil.js");
  Deno.env.set("GIT_CONFIG_KEY_0", "core.sshCommand");
  Deno.env.set("HTTP_PROXY", "http://corp-proxy:3128");
  Deno.env.set("PATH", "/usr/bin");

  try {
    scrubProcessEnv();
    assertEquals(Deno.env.get("LD_LIBRARY_PATH"), undefined, "LD_LIBRARY_PATH scrubbed from process env");
    assertEquals(Deno.env.get("NODE_OPTIONS"), undefined, "NODE_OPTIONS scrubbed from process env");
    assertEquals(Deno.env.get("GIT_CONFIG_KEY_0"), undefined, "GIT_CONFIG_KEY_* scrubbed from process env");
    assertEquals(Deno.env.get("HTTP_PROXY"), "http://corp-proxy:3128", "proxy vars kept — the daemon still needs them");
    assertEquals(Deno.env.get("PATH"), "/usr/bin", "PATH kept");
  } finally {
    if (originalLD === undefined) Deno.env.delete("LD_LIBRARY_PATH");
    else Deno.env.set("LD_LIBRARY_PATH", originalLD);
    if (originalNode === undefined) Deno.env.delete("NODE_OPTIONS");
    else Deno.env.set("NODE_OPTIONS", originalNode);
    if (originalGitKey === undefined) Deno.env.delete("GIT_CONFIG_KEY_0");
    else Deno.env.set("GIT_CONFIG_KEY_0", originalGitKey);
    if (originalProxy === undefined) Deno.env.delete("HTTP_PROXY");
    else Deno.env.set("HTTP_PROXY", originalProxy);
  }
});
