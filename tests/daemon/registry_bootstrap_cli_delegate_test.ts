/**
 * @module RegistryBootstrapCliDelegateTest
 * @path tests/daemon/registry_bootstrap_cli_delegate_test.ts
 * @description Verifies bootstrapProviderRegistry() registers the headless
 * claude-cli/opencode-cli providers (phase-140) so [ai].provider = "claude-cli" /
 * "opencode-cli" resolves to a real CliDelegateModelProvider instance, not the
 * silent mock fallback ProviderFactory.resolveOptions() uses for unregistered types.
 */

import { assertEquals, assertExists, assertInstanceOf } from "@std/assert";
import { ProviderRegistry } from "@exaix/ai";
import { CliDelegateModelProvider } from "@exaix/ai-clidelegate";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";

Deno.test("registry_bootstrap: claude-cli and opencode-cli are registered as supported providers", () => {
  bootstrapProviderRegistry();

  const supported = ProviderRegistry.getSupportedProviders();
  assertEquals(supported.includes("claude-cli"), true);
  assertEquals(supported.includes("opencode-cli"), true);
});

Deno.test("registry_bootstrap: claude-cli factory resolves to a CliDelegateModelProvider", async () => {
  bootstrapProviderRegistry();

  const factory = ProviderRegistry.getFactory("claude-cli");
  assertExists(factory);

  const provider = await factory!.create({
    provider: "claude-cli" as never,
    model: "claude-sonnet-5",
    timeoutMs: 60000,
  });

  assertInstanceOf(provider, CliDelegateModelProvider);
  assertEquals(provider.id, "claude-code-claude-sonnet-5");
});

Deno.test("registry_bootstrap: opencode-cli factory resolves to a CliDelegateModelProvider", async () => {
  bootstrapProviderRegistry();

  const factory = ProviderRegistry.getFactory("opencode-cli");
  assertExists(factory);

  const provider = await factory!.create({
    provider: "opencode-cli" as never,
    model: "opencode/deepseek-v4-flash-free",
    timeoutMs: 60000,
  });

  assertInstanceOf(provider, CliDelegateModelProvider);
  assertEquals(provider.id, "opencode-opencode/deepseek-v4-flash-free");
});
