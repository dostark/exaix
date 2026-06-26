/**
 * @module SessionDelegateProviderEnvTest
 * @path packages/session/tests/session_delegate_provider_env_test.ts
 * @description Phase 123 Step 4 — tests for SessionDelegateService.resolveDelegateEnv
 *   and the delegate-provider env injection contract. Covers each (provider, tool)
 *   combo, missing block, and empty key.
 */

import { assertEquals } from "@std/assert";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import type { SessionDelegateConfig, SessionTool } from "@exaix/schemas/session_delegate.ts";

function makeService(): SessionDelegateService {
  return new SessionDelegateService({
    registry: {} as never,
    clock: { now: () => new Date() },
    sessionDir: "/tmp/test-session",
  });
}

function configWithProvider(
  overrides: Partial<SessionDelegateConfig["provider"]> & { name: string; key_env: string },
): SessionDelegateConfig {
  return {
    enabled: true,
    tool: "opencode" as SessionTool,
    gates: ["code_changes"],
    launch_mode: "headless" as const,
    harden_permissions: false,
    provider: { name: overrides.name, key_env: overrides.key_env, base_url: overrides.base_url },
  } as SessionDelegateConfig;
}

Deno.test("[session_delegate_env] no provider block returns empty env", () => {
  const svc = makeService();
  const config: SessionDelegateConfig = {
    enabled: true,
    tool: "opencode",
    gates: ["code_changes"],
    launch_mode: "headless",
    harden_permissions: false,
  };
  const env = svc.resolveDelegateEnv(config, "opencode", "my-key");
  assertEquals(env, {});
});

Deno.test("[session_delegate_env] openrouter + opencode injects OPENROUTER_API_KEY", () => {
  const svc = makeService();
  const config = configWithProvider({ name: "openrouter", key_env: "OR_KEY" });
  const env = svc.resolveDelegateEnv(config, "opencode", "sk-or-v1-abc123");
  assertEquals(env, { OPENROUTER_API_KEY: "sk-or-v1-abc123" });
});

Deno.test("[session_delegate_env] openrouter + claude-code injects ANTHROPIC_BASE_URL + AUTH_TOKEN + empty API_KEY", () => {
  const svc = makeService();
  const config = configWithProvider({ name: "openrouter", key_env: "OR_KEY" });
  const env = svc.resolveDelegateEnv(config, "claude-code", "sk-or-v1-abc123");
  assertEquals(env, {
    ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
    ANTHROPIC_AUTH_TOKEN: "sk-or-v1-abc123",
    ANTHROPIC_API_KEY: "",
  });
});

Deno.test("[session_delegate_env] openrouter + claude-code uses custom base_url when set", () => {
  const svc = makeService();
  const config = configWithProvider({
    name: "openrouter",
    key_env: "OR_KEY",
    base_url: "https://custom.openrouter.ai/api",
  });
  const env = svc.resolveDelegateEnv(config, "claude-code", "sk-or-v1-abc123");
  assertEquals(env.ANTHROPIC_BASE_URL, "https://custom.openrouter.ai/api");
});

Deno.test("[session_delegate_env] anthropic + opencode injects ANTHROPIC_API_KEY", () => {
  const svc = makeService();
  const config = configWithProvider({ name: "anthropic", key_env: "ANTHROPIC_KEY" });
  const env = svc.resolveDelegateEnv(config, "opencode", "sk-ant-abc123");
  assertEquals(env, { ANTHROPIC_API_KEY: "sk-ant-abc123" });
});

Deno.test("[session_delegate_env] anthropic + claude-code injects ANTHROPIC_API_KEY", () => {
  const svc = makeService();
  const config = configWithProvider({ name: "anthropic", key_env: "ANTHROPIC_KEY" });
  const env = svc.resolveDelegateEnv(config, "claude-code", "sk-ant-abc123");
  assertEquals(env, { ANTHROPIC_API_KEY: "sk-ant-abc123" });
});

Deno.test("[session_delegate_env] ollama + opencode returns empty env", () => {
  const svc = makeService();
  const config = configWithProvider({ name: "ollama", key_env: "OLLAMA_KEY" });
  const env = svc.resolveDelegateEnv(config, "opencode", "");
  assertEquals(env, {});
});

Deno.test("[session_delegate_env] empty key still produces env with empty value", () => {
  const svc = makeService();
  const config = configWithProvider({ name: "openrouter", key_env: "MISSING_KEY" });
  const env = svc.resolveDelegateEnv(config, "opencode", "");
  assertEquals(env, { OPENROUTER_API_KEY: "" });
});
