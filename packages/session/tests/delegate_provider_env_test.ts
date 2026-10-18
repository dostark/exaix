/**
 * @module DelegateProviderEnvTest
 * @path packages/session/tests/delegate_provider_env_test.ts
 * @description Tests for the shared delegate-provider env helpers: the pure provider-to-env
 *   mapping and the reader that takes the key from a named environment variable.
 * @architectural-layer Services
 * @related-files [packages/session/src/delegate_provider_env.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { readDelegateProviderEnv, resolveDelegateProviderEnv } from "@exaix/session/delegate_provider_env.ts";

const OPENROUTER = { name: "openrouter", key_env: "OPENROUTER_API_KEY" };

Deno.test("[delegate_provider_env] openrouter on opencode injects OPENROUTER_API_KEY", () => {
  assertEquals(resolveDelegateProviderEnv(OPENROUTER, "opencode", "sk-or-1"), { OPENROUTER_API_KEY: "sk-or-1" });
});

Deno.test("[delegate_provider_env] an unknown provider injects nothing", () => {
  assertEquals(resolveDelegateProviderEnv({ name: "other", key_env: "X" }, "opencode", "k"), {});
});

Deno.test("[delegate_provider_env] the reader takes the key from the named variable", () => {
  const env = readDelegateProviderEnv(
    OPENROUTER,
    "opencode",
    (name) => name === "OPENROUTER_API_KEY" ? "sk-or-2" : undefined,
  );
  assertEquals(env, { OPENROUTER_API_KEY: "sk-or-2" });
});

Deno.test("[delegate_provider_env] the reader names the variable when the key is missing or empty", () => {
  for (const value of [undefined, ""]) {
    const error = assertThrows(() => readDelegateProviderEnv(OPENROUTER, "opencode", () => value), Error);
    assertStringIncludes(error.message, "OPENROUTER_API_KEY");
  }
});
