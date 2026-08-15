/**
 * @module RegistryBootstrapCodexTest
 * @path tests/daemon/registry_bootstrap_codex_test.ts
 * @description Phase 166 Step 4 — the non-deferrable cutover step. Verifies
 * bootstrapProviderRegistry() registers codex-cli through the REAL production
 * registration call site (registerConcreteProviders/registerProviderDefaults in
 * apps/common/registry_bootstrap.ts), not a hand-constructed CliDelegateModelProvider:
 * codex-cli is a supported provider, its factory resolves to a real
 * CliDelegateModelProvider whose generate() reaches an injected fake subprocess (via a
 * temporary SafeSubprocess.run monkeypatch — CliDelegateProviderFactory.create() takes
 * IResolvedProviderOptions, the standard provider-agnostic interface shared by every
 * provider factory, which has no run-override seam; this is the only way to prove the
 * REAL factory reaches a real subprocess call site without spawning an actual codex
 * binary), a bare "codex-cli" model string resolves through ModelResolver without any
 * codex-specific code inside ModelResolver itself, and ProviderDefaultsRegistry carries
 * CODEX_CLI_DEFAULTS so getDefaultModel/getDefaultEndpoint resolve real values instead of
 * the "${providerType}-model" fallback (Pre-Gap Analysis GAP-2).
 * @architectural-layer Integration
 */

import { assertEquals, assertExists, assertInstanceOf } from "@std/assert";
import { ProviderRegistry } from "@exaix/ai";
import { ModelResolver } from "@exaix/ai";
import { DefaultRoutingStrategy } from "@exaix/ai/routing/default_routing_strategy.ts";
import { CliDelegateModelProvider, CODEX_CLI_DEFAULTS, PROVIDER_CODEX_CLI } from "@exaix/ai-clidelegate";
import { getDefaultEndpoints, getDefaultModels } from "@exaix/schemas";
import { ProviderDefaultsRegistry, SafeSubprocess } from "@exaix/core";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";
import { createTestConfig } from "../../packages/ai/tests/helpers/test_config.ts";
import { createStubCostTracker, createStubHealthChecker } from "../../packages/ai/tests/helpers/service_stubs.ts";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";

function makeResolver(): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    createMockEventLogger(),
  );
}

Deno.test("registry_bootstrap: codex-cli is registered as a supported provider", () => {
  bootstrapProviderRegistry();

  const supported = ProviderRegistry.getSupportedProviders();
  assertEquals(supported.includes("codex-cli"), true);
});

Deno.test("registry_bootstrap: codex-cli factory resolves to a CliDelegateModelProvider", async () => {
  bootstrapProviderRegistry();

  const factory = ProviderRegistry.getFactory("codex-cli");
  assertExists(factory);

  const provider = await factory!.create({
    provider: "codex-cli" as never,
    model: "gpt-5.2-codex",
    timeoutMs: 60000,
  });

  assertInstanceOf(provider, CliDelegateModelProvider);
  assertEquals(provider.id, "codex-gpt-5.2-codex");
});

Deno.test("[integration] registry_bootstrap: codex-cli's real factory-resolved provider reaches an injected fake subprocess and returns parsed content", async () => {
  bootstrapProviderRegistry();

  const factory = ProviderRegistry.getFactory("codex-cli");
  assertExists(factory);
  const provider = await factory!.create({
    provider: "codex-cli" as never,
    model: "gpt-5.2-codex",
    timeoutMs: 60000,
  });
  assertInstanceOf(provider, CliDelegateModelProvider);

  // CliDelegateProviderFactory.create() takes the standard, provider-agnostic
  // IResolvedProviderOptions — no run-override seam exists there by design (adding one
  // would leak a CLI-delegate-specific concern into every other provider's options). The
  // only way to prove the REAL registration path reaches a real subprocess call site,
  // without actually spawning the codex binary, is a temporary SafeSubprocess.run
  // monkeypatch, restored unconditionally in `finally`.
  let seenCommand = "";
  let seenArgs: string[] = [];
  const originalRun = SafeSubprocess.run;
  try {
    SafeSubprocess.run = ((command: string, args: string[]) => {
      seenCommand = command;
      seenArgs = args;
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({
          type: "item.completed",
          item: { id: "i1", type: "agent_message", text: "Analysis complete." },
        }),
        stderr: "",
      });
    }) as typeof SafeSubprocess.run;

    const result = await provider.generate("Analyze this request");

    assertEquals(seenCommand, "codex");
    assertEquals(seenArgs.includes("exec"), true);
    assertEquals(seenArgs.includes("--sandbox"), true);
    assertEquals(result.content, "Analysis complete.");
    assertEquals(result.provider, "codex");
    assertEquals(result.cost_usd, 0);
  } finally {
    SafeSubprocess.run = originalRun;
  }
});

Deno.test("registry_bootstrap: a bare 'codex-cli' model string is resolvable by ModelResolver without further wiring", async () => {
  bootstrapProviderRegistry();

  const resolver = makeResolver();
  const result = await resolver.resolve({ model: "codex-cli" });

  assertEquals(result.provider, "codex-cli");
  // Proves ProviderDefaultsRegistry carries a real default, not the
  // "${providerType}-model" fallback getDefaultModelForProvider uses when no defaults are
  // registered (Pre-Gap Analysis GAP-2).
  assertEquals(result.model, CODEX_CLI_DEFAULTS.defaultModel);
});

Deno.test("registry_bootstrap: ProviderDefaultsRegistry carries CODEX_CLI_DEFAULTS after bootstrap", () => {
  bootstrapProviderRegistry();

  assertEquals(ProviderDefaultsRegistry.get(PROVIDER_CODEX_CLI), CODEX_CLI_DEFAULTS);
  assertEquals(getDefaultModels()["codex-cli"], CODEX_CLI_DEFAULTS.defaultModel);
  assertEquals(getDefaultEndpoints()["codex-cli"], CODEX_CLI_DEFAULTS.defaultEndpoint);
  // The exact regression the Pre-Gap Analysis flagged: without
  // ProviderDefaultsRegistry.register(PROVIDER_CODEX_CLI, ...), this would read
  // "codex-cli-model" instead.
  assertEquals(getDefaultModels()["codex-cli"] === "codex-cli-model", false);
});
