/**
 * @module BootstrapTeam
 * @path apps/daemon/src/bootstrap_team.ts
 * @description Team-edition bootstrap — wires Team-only capability modules
 * (voting, guardrail, etc.) through the edition-composer seam.
 * Called from main.ts when EXAIX_EDITION=team.
 * @architectural-layer Application
 * @related-files [apps/daemon/main.ts]
 */

import { VotingCapabilityModule, VotingConsensusService } from "@exaix-team/voting";
import { HitlCapabilityModule } from "@exaix-team/hitl";
import { PortalExtractorsModule } from "@exaix-team/portal-extractors";
import {
  AdapterRegistry,
  AnthropicCatalogAdapter,
  GoogleCatalogAdapter,
  type IAdmissionInputs,
  maybeCreateRefreshScheduler,
  ModelRegistryService,
  OllamaCatalogAdapter,
  OpenAiCatalogAdapter,
  OpenRouterCatalogAdapter,
  type RegistryRefreshScheduler,
  TeamResolutionStrategy,
} from "@exaix-team/model-registry-live";
import { DefaultModelRegistry, isCostExempt } from "@exaix/model-registry";
import type { IAdapterContext } from "@exaix/model-registry";
import { type IResolutionStrategy, ProviderRegistry } from "@exaix/ai";
import type { IDatabaseService, IExecutor, IHitlPolicyEvaluator, IModelRegistry } from "@exaix/core/types";
import type { IModelRegistryProvider, IModelRegistryProviderDeps } from "@exaix/core/composer";
import type { IProviderHealthChecker } from "@exaix/ai";
import type { Config, IRouteReason } from "@exaix/schemas";
import type { IEventLogger } from "@exaix/core/logger";
import type { AgentExecutorAdapter, FlowRunner } from "@exaix/flow";
import type { TeamComposer } from "@exaix-team/team-composer";
import { CAP_VOTING, CAPABILITY_EDITION } from "@exaix/core/composer";
import type { ISeamRegistryPlaceholder } from "@exaix/core/composer";
import type { ISymbolExtractorRegistry } from "@exaix/portal/knowledge";
import { EDITION_TEAM } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/** Runtime dependencies the Team model-registry provider closes over (Phase 135, GAP-3). */
export interface ITeamModelRegistryDeps {
  db: IDatabaseService;
  config: Config;
  logger: IEventLogger;
}

/**
 * Register the Team live model-registry provider on the edition composer
 * (Phase 135 Step 1, GAP-2/GAP-3).
 *
 * MUST be called BEFORE main.ts selects the registry via
 * `getModelRegistryProvider()` — otherwise selection resolves to the Solo floor
 * and the Team catalog is never reached. The provider closes over db/config/logger
 * (which the seam's `createModelRegistry(deps)` does not carry) and builds the floor
 * from the seam-supplied `deps.healthChecker`, so the shared
 * `IModelRegistryProviderDeps` contract stays frozen.
 */
export function registerTeamModelRegistry(
  composer: TeamComposer,
  deps: ITeamModelRegistryDeps,
): void {
  const provider: IModelRegistryProvider = {
    createModelRegistry(seamDeps: IModelRegistryProviderDeps): IModelRegistry {
      const healthChecker = seamDeps.healthChecker as IProviderHealthChecker;
      const floor = new DefaultModelRegistry(healthChecker);
      return new ModelRegistryService(deps.db, deps.logger, deps.config, floor, healthChecker);
    },
  };
  composer.registerModelRegistryProvider(provider);
}

/** Fallback adapter timeout when model_registry.refresh_timeout_ms is unset. */
const DEFAULT_ADAPTER_TIMEOUT_MS = 15_000;

/** Per-provider host root (adapters append their own path) + credential env (§6.3). */
interface IProviderCatalogDescriptor {
  baseUrl: string;
  keyEnv?: string;
}

const PROVIDER_CATALOG_DESCRIPTORS: Record<string, IProviderCatalogDescriptor> = {
  openrouter: { baseUrl: "https://openrouter.ai", keyEnv: "OPENROUTER_API_KEY" },
  anthropic: { baseUrl: "https://api.anthropic.com", keyEnv: "ANTHROPIC_API_KEY" },
  google: { baseUrl: "https://generativelanguage.googleapis.com", keyEnv: "GEMINI_API_KEY" },
  openai: { baseUrl: "https://api.openai.com", keyEnv: "OPENAI_API_KEY" },
  ollama: { baseUrl: "http://localhost:11434" }, // local, no credential
};

/** Register all five provider catalog adapters (OpenRouter + the four natives, §6.3). */
function createTeamAdapterRegistry(): AdapterRegistry {
  const adapters = new AdapterRegistry();
  adapters.register(new OpenRouterCatalogAdapter());
  adapters.register(new AnthropicCatalogAdapter());
  adapters.register(new GoogleCatalogAdapter());
  adapters.register(new OpenAiCatalogAdapter());
  adapters.register(new OllamaCatalogAdapter());
  return adapters;
}

/**
 * Build the per-provider adapter-context factory: resolves each provider's configured
 * key env + host root (no new secret surface). The OpenRouter key env honours the config
 * override; the natives use the standard envs. Shared by the resolution strategy (Step 3)
 * and the refresh scheduler (Step 5).
 */
function createBuildContext(config: Config): (provider: string) => IAdapterContext {
  const timeoutMs = config.model_registry?.refresh_timeout_ms ?? DEFAULT_ADAPTER_TIMEOUT_MS;
  const openrouterKeyEnv = config.ai_openrouter?.api_key_env ?? PROVIDER_CATALOG_DESCRIPTORS.openrouter.keyEnv;
  return (provider: string): IAdapterContext => {
    const descriptor = PROVIDER_CATALOG_DESCRIPTORS[provider];
    const baseUrl = descriptor?.baseUrl ?? PROVIDER_CATALOG_DESCRIPTORS.openrouter.baseUrl;
    const keyEnv = provider === "openrouter" ? openrouterKeyEnv : descriptor?.keyEnv;
    return { apiKey: keyEnv ? Deno.env.get(keyEnv) : undefined, baseUrl, fetch, timeoutMs };
  };
}

/**
 * Admission inputs per provider for a scheduled refresh (Step 5). Curated ∪ used are
 * derived from live state: curated = the provider's current catalog rows (curation-by-
 * usage is retained); the aggregator flag comes from provider metadata (§5.7.2). The
 * top-N benchmark path stays inert until Step 7 populates model_benchmark.
 */
async function admissionInputsFor(
  registry: ModelRegistryService,
  config: Config,
  provider: string,
): Promise<IAdmissionInputs> {
  const isAggregator = ProviderRegistry.getProviderMetadata(provider)?.isAggregator === true;
  const existing = await registry.getProviderModels(provider);
  return {
    curatedModels: new Set(existing.map((m) => m.model)),
    usedModels: new Set(),
    isAggregator,
    keepNativeWhole: config.model_registry?.admission?.keep_native_whole ?? true,
    topN: config.model_registry?.admission?.top_n ?? DEFAULT_ADMISSION_TOP_N,
  };
}

const DEFAULT_ADMISSION_TOP_N = 25;

/**
 * Build the Team resolution strategy (Phase 135 Step 3 seam consumer, extended in
 * Step 4 with the four native adapters) that wires the live registry's
 * explicit-validation / auto-admit behaviour into ModelResolver via the
 * IResolutionStrategy seam. Returns undefined when the selected registry is not the Team
 * live service (defensive — Solo never reaches this call).
 */
export function buildTeamResolutionStrategy(
  modelRegistry: IModelRegistry,
  config: Config,
  logger: IEventLogger,
): Opt<IResolutionStrategy, Reason.OptionalDependency> {
  if (!(modelRegistry instanceof ModelRegistryService)) return undefined;
  const adapters = createTeamAdapterRegistry();
  const buildContext = createBuildContext(config);
  return new TeamResolutionStrategy(modelRegistry, logger, {
    getAdapter: (p) => adapters.get(p),
    buildContext,
    isAggregator: (p) => ProviderRegistry.getProviderMetadata(p)?.isAggregator === true,
    // D7: cost-exempt by provider metadata (LOCAL/FREE tier) — Step 6 route policy.
    costExempt: (p) => isCostExempt(ProviderRegistry.getProviderMetadata(p)),
    // §5.7.3 route health (Step 6): the daemon's health checker reports a boolean per
    // provider (all-healthy stub pre-wiring); map it to the circuit sub-signal. Failure
    // headroom / latency / rate-limit sub-signals are omitted here and renormalise (F3 —
    // no per-route health state; the real CircuitBreaker binds where the checker is).
    routeHealth: () => ({ circuitState: 1 }),
    routePolicy: config.model_registry?.route_policy ?? DEFAULT_ROUTE_POLICY,
    routePriceTolerance: config.model_registry?.route_policy_price_tolerance ?? DEFAULT_ROUTE_PRICE_TOLERANCE,
    routeOrder: config.model_registry?.route_order ?? {},
  });
}

/** Route-policy defaults mirroring the ModelRegistryConfigSchema fallbacks (§5.7). */
const DEFAULT_ROUTE_POLICY: IRouteReason = "cheapest";
const DEFAULT_ROUTE_PRICE_TOLERANCE = 0.05;

/**
 * Build the opt-in registry refresh scheduler (Phase 135 Step 5). Returns undefined when
 * the selected registry is not the Team live service OR model_registry.enabled !== true
 * (the opt-in gate — a disabled/Solo daemon never constructs it, zero outbound calls).
 * The caller starts it (honouring refresh_on_start) and stops it on shutdown.
 */
export function buildRefreshScheduler(
  modelRegistry: IModelRegistry,
  config: Config,
  logger: IEventLogger,
): Opt<RegistryRefreshScheduler, Reason.OptionalDependency> {
  if (!(modelRegistry instanceof ModelRegistryService)) return undefined;
  const adapters = createTeamAdapterRegistry();
  const buildContext = createBuildContext(config);
  return maybeCreateRefreshScheduler(modelRegistry, adapters, config, logger, {
    buildContext,
    admissionInputsFor: (p) => admissionInputsFor(modelRegistry, config, p),
  });
}

/**
 * Register all Team-edition capability modules and invoke their
 * seam-registration hooks against the FlowRunner.
 *
 * This is called from main.ts after FlowRunner construction, inside the
 * `if (editionType === EDITION_TEAM)` guard.
 */
export function registerTeamCapabilities(
  agentExecutorAdapter: AgentExecutorAdapter,
  logger: IEventLogger,
  flowRunner: FlowRunner,
  composer: TeamComposer,
  symbolRegistry: ISymbolExtractorRegistry,
  hitlPolicyEvaluator?: Opt<IHitlPolicyEvaluator, Reason.OptionalDependency>,
): void {
  // Assert the capability-to-edition mapping is consistent at wiring time
  if (CAPABILITY_EDITION[CAP_VOTING] !== EDITION_TEAM) {
    throw new Error(
      `CAP_VOTING maps to "${CAPABILITY_EDITION[CAP_VOTING]}" but is being wired in Team edition. ` +
        "Update CAPABILITY_EDITION or move this wiring to the correct bootstrap.",
    );
  }

  // Phase 118: Register HITL governance capability module (asserts edition mapping)
  if (hitlPolicyEvaluator) {
    const hitlModule = new HitlCapabilityModule();
    composer.registerCapabilityModule(hitlModule);
  }

  // Phase 113: Wire voting capability through the edition-composer seam
  const votingExecutor: IExecutor = {
    run: async (blueprint, prompt) => {
      const result = await agentExecutorAdapter.run(blueprint, {
        userPrompt: prompt,
        context: {},
      });
      return { content: result.content };
    },
  };
  const votingService = new VotingConsensusService(votingExecutor, logger);
  const votingModule = new VotingCapabilityModule(votingService, logger);
  composer.registerCapabilityModule(votingModule);

  // Phase 119: Register PortalExtractorsModule for extended-language symbol extraction
  const portalExtractorsModule = new PortalExtractorsModule();
  composer.registerCapabilityModule(portalExtractorsModule);

  const stepRegistry = flowRunner.getStepHandlerRegistry();
  for (const module of composer.getModules()) {
    module.registerFlowStepHandlers?.(stepRegistry);
    module.registerSymbolExtractors?.(symbolRegistry as ISeamRegistryPlaceholder);
  }
}
