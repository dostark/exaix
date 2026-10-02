/**
 * @module BindingCatalog
 * @path packages/model-registry/src/binding_catalog.ts
 * @description Projects existing model facts into the flow binding catalog.
 * @architectural-layer ModelRegistry
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/model-registry/src/static_overlay.ts, packages/ai/src/bindings/binding_resolver.ts]
 */

import {
  OPENAI_COMPATIBLE_PROFILE_DEFAULTS,
  OPENAI_COMPATIBLE_SELF_HOSTED_PROFILE,
  ProviderDefaultsRegistry,
  ProviderType,
} from "@exaix/core";
import { getDefaultModels } from "@exaix/schemas";
import type { IBindingCatalog, ModelCapability } from "@exaix/schemas";
import { BindingTransportSchema, ModelCapabilitySchema } from "@exaix/schemas";
import { STATIC_OVERLAY } from "./static_overlay.ts";

const MOCK_CAPABILITIES: ModelCapability[] = [
  ModelCapabilitySchema.enum.effort,
  ModelCapabilitySchema.enum.thinking,
];
const DEEPSEEK_SERVICE = "deepseek";
const DEEPSEEK_KEY_VARIABLE = "DEEPSEEK_API_KEY";

const PROVIDER_KEY_ENV: Readonly<Partial<Record<ProviderType, string>>> = {
  [ProviderType.ANTHROPIC]: "ANTHROPIC_API_KEY",
  [ProviderType.OPENAI]: "OPENAI_API_KEY",
  [ProviderType.GOOGLE]: "GOOGLE_API_KEY",
  [ProviderType.OPENROUTER]: "OPENROUTER_API_KEY",
};

/** Project each registered default provider as a self-serving cloud/local service. */
function projectDefaultProviders(catalog: IBindingCatalog): void {
  const defaults = getDefaultModels();
  for (const [provider, model] of Object.entries(defaults)) {
    if (provider !== ProviderType.MOCK && !ProviderDefaultsRegistry.isRegistered(provider)) continue;
    if (provider === ProviderType.OPENAI_CHAT || provider === ProviderType.VERTEX) continue;
    const canonical = `${provider}/${model}`;
    catalog.models[canonical] = {
      model_provider: provider,
      ...(provider === ProviderType.MOCK ? { capabilities: MOCK_CAPABILITIES } : {}),
    };
    const local = provider === ProviderType.MOCK || provider === ProviderType.OLLAMA ||
      provider === ProviderType.LLAMACPP || provider.endsWith("-cli");
    const cli = provider.endsWith("-cli");
    catalog.services[provider] = {
      adapter: provider,
      transport: local ? BindingTransportSchema.enum.local : BindingTransportSchema.enum.cloud,
      interface: cli ? "cli" : "api",
      ...(PROVIDER_KEY_ENV[provider as ProviderType] ? { key_env: PROVIDER_KEY_ENV[provider as ProviderType] } : {}),
      serves: { [canonical]: model },
    };
  }
}

/** Project shipped price/model rows onto existing or inferred services. */
function projectStaticOverlay(catalog: IBindingCatalog): void {
  for (const [key, entry] of Object.entries(STATIC_OVERLAY)) {
    const separator = key.indexOf(":");
    const provider = key.slice(0, separator);
    const model = key.slice(separator + 1);
    const canonical = `${provider}/${model}`;
    const capabilities: ModelCapability[] = [];
    if (entry.supportsThinking === true) capabilities.push(ModelCapabilitySchema.enum.thinking);
    if (entry.supportsEffort === true) capabilities.push(ModelCapabilitySchema.enum.effort);
    catalog.models[canonical] = {
      model_provider: provider,
      ...(entry.contextWindow ? { context_window: entry.contextWindow } : {}),
      ...(capabilities.length > 0 ? { capabilities } : {}),
    };
    if (provider !== DEEPSEEK_SERVICE) {
      if (!catalog.services[provider] && Object.values(ProviderType).includes(provider as ProviderType)) {
        catalog.services[provider] = {
          adapter: provider,
          transport: BindingTransportSchema.enum.cloud,
          interface: "api",
          ...(PROVIDER_KEY_ENV[provider as ProviderType]
            ? { key_env: PROVIDER_KEY_ENV[provider as ProviderType] }
            : {}),
          serves: {},
        };
      }
      const service = catalog.services[provider];
      if (service) service.serves[canonical] = model;
    }
  }
}

/** Project the qualified openai-chat and deepseek profile defaults as owned services. */
function projectCompatibleProfiles(catalog: IBindingCatalog): void {
  for (const profile of [ProviderType.OPENAI, DEEPSEEK_SERVICE] as const) {
    const qualified = OPENAI_COMPATIBLE_PROFILE_DEFAULTS[profile];
    const canonical = `${profile}/${qualified.model}`;
    const service = profile === ProviderType.OPENAI ? ProviderType.OPENAI_CHAT : profile;
    catalog.models[canonical] ??= { model_provider: profile };
    catalog.services[service] = {
      adapter: ProviderType.OPENAI_CHAT,
      profile,
      endpoint: qualified.endpoint,
      transport: BindingTransportSchema.enum.cloud,
      interface: "api",
      key_env: profile === ProviderType.OPENAI ? "OPENAI_API_KEY" : DEEPSEEK_KEY_VARIABLE,
      serves: { [canonical]: qualified.model },
    };
  }
}

const OLLAMA_CHAT_SERVICE = "ollama-chat";
const OLLAMA_CHAT_ENDPOINT = "http://127.0.0.1:11434/v1/chat/completions";

/** Project Ollama's own OpenAI-compatible endpoint beside the native `ollama` service.
 *  Selection is explicit, so no preference key is added for the `meta`/`qwen` model owners. */
function projectSelfHostedChatRoute(catalog: IBindingCatalog): void {
  catalog.services[OLLAMA_CHAT_SERVICE] = {
    adapter: ProviderType.OPENAI_CHAT,
    profile: OPENAI_COMPATIBLE_SELF_HOSTED_PROFILE,
    endpoint: OLLAMA_CHAT_ENDPOINT,
    // Ollama serves plain HTTP on loopback, which the self-hosted endpoint policy admits only by opt-in.
    allow_insecure_loopback: true,
    transport: BindingTransportSchema.enum.local,
    interface: "api",
    supports_tool_choice: false,
    serves: { "*": "{name}" },
  };
}

/** Project the open-router route and the local CLI provider and delegate tools. */
function projectCliRoutes(catalog: IBindingCatalog): void {
  catalog.services.openrouter = {
    adapter: ProviderType.OPENROUTER,
    transport: BindingTransportSchema.enum.cloud,
    interface: "api",
    key_env: PROVIDER_KEY_ENV[ProviderType.OPENROUTER],
    serves: { "*": "{model}" },
  };
  for (const provider of [ProviderType.CLAUDE_CLI, ProviderType.OPENCODE_CLI, ProviderType.CODEX_CLI]) {
    catalog.services[provider] ??= {
      adapter: provider,
      transport: "local",
      interface: "cli",
      serves: { "*": "{model}" },
    };
  }
  for (const tool of ["claude-code", "opencode", "codex"] as const) {
    catalog.services[tool] = {
      adapter: "cli-delegate",
      transport: "local",
      interface: "cli",
      tool,
      serves: { "*": "{name}" },
    };
  }
}

/** Project shipped price/model rows and registered default names without adding model literals. */
export function buildBuiltInCatalog(): IBindingCatalog {
  const catalog: IBindingCatalog = { models: {}, services: {}, preferences: {} };
  projectDefaultProviders(catalog);
  projectStaticOverlay(catalog);
  projectCompatibleProfiles(catalog);
  projectSelfHostedChatRoute(catalog);
  projectCliRoutes(catalog);
  for (
    const provider of new Set<string>([
      ...Object.values(catalog.models).map((model) => model.model_provider),
      ...Object.keys(catalog.services),
    ])
  ) {
    const own = catalog.services[provider] ? [provider] : [];
    catalog.preferences[provider] = [...new Set([...own, "openrouter"])];
  }
  return catalog;
}

/** Override whole named entries while retaining unrelated built-ins. */
export function mergeCatalogs(
  base: IBindingCatalog,
  ...overrides: readonly Partial<IBindingCatalog>[]
): IBindingCatalog {
  return overrides.reduce<IBindingCatalog>((merged, override) => {
    const models = { ...merged.models };
    for (const [id, candidate] of Object.entries(override.models ?? {})) {
      const verified = merged.models[id]?.capabilities;
      const next = { ...merged.models[id], ...candidate };
      if (candidate.capabilities !== undefined) {
        if (verified) next.capabilities = candidate.capabilities.filter((value) => verified.includes(value));
        else delete next.capabilities;
      }
      models[id] = next;
    }
    return {
      models,
      services: { ...merged.services, ...override.services },
      preferences: { ...merged.preferences, ...override.preferences },
    };
  }, base);
}
