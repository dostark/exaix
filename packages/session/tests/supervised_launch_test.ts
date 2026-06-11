/**
 * @module SupervisedLaunchTest
 * @path packages/session/tests/supervised_launch_test.ts
 * @description Phase 106 Step 8 — tests for GAP-4 supervised-launch hardening:
 *   the child environment is a minimal allowlist with every secret-bearing
 *   variable stripped (even from the parent env), the token-budget vars survive,
 *   and only an allowlisted binary may be spawned.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { assertBinaryAllowed, sanitizeChildEnv } from "@exaix/session/supervised_launch.ts";
import { SESSION_ENV_MAX_TOTAL_TOKENS } from "@exaix/core/types";

Deno.test("[supervised_launch][security] GAP-4 — parent secrets are never forwarded to the child", () => {
  const parent = {
    PATH: "/usr/bin",
    HOME: "/home/dev",
    ANTHROPIC_API_KEY: "sk-secret",
    OPENAI_API_KEY: "sk-other",
    AWS_SECRET_ACCESS_KEY: "abc",
    DB_PASSWORD: "hunter2",
  };
  const env = sanitizeChildEnv({}, parent);
  assertEquals(env["PATH"], "/usr/bin");
  assertEquals(env["HOME"], "/home/dev");
  for (const key of Object.keys(env)) {
    assertEquals(/API_KEY|SECRET|PASSWORD|CREDENTIAL/i.test(key), false, `leaked secret-bearing var: ${key}`);
  }
});

Deno.test("[supervised_launch][security] GAP-4 — a secret in the launch env is also stripped", () => {
  const env = sanitizeChildEnv({ SOME_API_KEY: "leak", [SESSION_ENV_MAX_TOTAL_TOKENS]: "100000" }, {});
  assertEquals(env["SOME_API_KEY"], undefined);
});

Deno.test("[supervised_launch] token-budget vars survive sanitization", () => {
  const env = sanitizeChildEnv({ [SESSION_ENV_MAX_TOTAL_TOKENS]: "70000" }, { PATH: "/usr/bin" });
  assertEquals(env[SESSION_ENV_MAX_TOTAL_TOKENS], "70000");
  assertEquals(env["PATH"], "/usr/bin");
});

Deno.test("[supervised_launch][security] GAP-4 — only an allowlisted binary may be spawned", () => {
  const allow = new Set(["claude", "opencode"]);
  assertBinaryAllowed("claude", allow); // no throw
  assertThrows(() => assertBinaryAllowed("rm", allow));
  assertThrows(() => assertBinaryAllowed("/bin/sh", allow));
});
