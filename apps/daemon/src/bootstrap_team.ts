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
  fetchModelsDevBenchmarks,
  GoogleCatalogAdapter,
  type IAdmissionInputs,
  maybeCreateRefreshScheduler,
  ModelRegistryService,
  OllamaCatalogAdapter,
  OpenAiCatalogAdapter,
  OpenRouterCatalogAdapter,
  type RegistryRefreshScheduler,
  STATIC_BENCHMARKS,
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
import type { AgentComposerAdapter, FlowRunner } from "@exaix/flow";
import type { TeamComposer } from "@exaix-team/team-composer";
import { CAP_VOTING, CAPABILITY_EDITION } from "@exaix/core/composer";
import type { ISeamRegistryPlaceholder } from "@exaix/core/composer";
import type { ISymbolExtractorRegistry } from "@exaix/portal/knowledge";
import { EDITION_TEAM } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/** Runtime dependencies the Team model-registry provider closes over. */
export interface ITeamModelRegistryDeps {
  db: IDatabaseService;
  config: Config;
  logger: IEventLogger;
}

/** Register the Team live model-registry provider; MUST be called BEFORE main.ts selects
 * the registry via `getModelRegistryProvider()`, or selection falls back to the Solo floor. */
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

/** Per-provider host root (adapters append their own path) + credential env. */
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

/** Register all five provider catalog adapters (OpenRouter + the four natives). */
function createTeamAdapterRegistry(): AdapterRegistry {
  const adapters = new AdapterRegistry();
  adapters.register(new OpenRouterCatalogAdapter());
  adapters.register(new AnthropicCatalogAdapter());
  adapters.register(new GoogleCatalogAdapter());
  adapters.register(new OpenAiCatalogAdapter());
  adapters.register(new OllamaCatalogAdapter());
  return adapters;
}

/** Build the per-provider adapter-context factory (key env + host root; no new secret surface). */
function createBuildContext(config: Config): (provider: string) => IAdapterContext {
  const timeoutMs = config.model_registry?.refresh_timeout_ms ?? DEFAULT_ADAPTER_TIMEOUT_MS;
  const openrouterKeyEnv = config.ai_openrouter?.api_key_env ?? PROVIDER_CATALOG_DESCRIPTORS.openrouter.keyEnv;
  const baseUrlOverrides = config.model_registry?.adapter_base_urls ?? {};
  return (provider: string): IAdapterContext => {
    const descriptor = PROVIDER_CATALOG_DESCRIPTORS[provider];
    const baseUrl = baseUrlOverrides[provider] ?? descriptor?.baseUrl ??
      PROVIDER_CATALOG_DESCRIPTORS.openrouter.baseUrl;
    const keyEnv = provider === "openrouter" ? openrouterKeyEnv : descriptor?.keyEnv;
    return { apiKey: keyEnv ? Deno.env.get(keyEnv) : undefined, baseUrl, fetch, timeoutMs };
  };
}

/** Admission inputs for a scheduled refresh; curatedModels mirrors the provider's current
 * catalog rows, and usedModels stays empty until usage-based curation is wired. */
async function admissionInputsFor(
  registry: ModelRegistryService,
  config: Config,
  provider: string,
): Promise<IAdmissionInputs> {
  const isAggregator = ProviderRegistry.getProviderMetadata(provider)?.isAggregator === true;
  const existing = await registry.getProviderModels(provider);
  const topN = config.model_registry?.admission?.top_n ?? DEFAULT_ADMISSION_TOP_N;
  // benchmarkTopN stays empty until the curated floor / models.dev ingest populates
  // model_benchmark, so the benchmark_topn admission path stays inert until then.
  const tracked = config.model_registry?.benchmark_source?.tracked_benchmarks ?? DEFAULT_TRACKED_BENCHMARKS;
  const benchmarkTopN = await registry.getBenchmarkTopN(tracked, topN);
  return {
    curatedModels: new Set(existing.map((m) => m.model)),
    usedModels: new Set(),
    isAggregator,
    keepNativeWhole: config.model_registry?.admission?.keep_native_whole ?? true,
    topN,
    benchmarkTopN,
  };
}

const DEFAULT_ADMISSION_TOP_N = 25;
// Kept in sync with ModelRegistryConfigSchema's benchmark_source default so a
// hand-built Config (bypassing the Zod default) still unions all three.
const DEFAULT_TRACKED_BENCHMARKS = ["swe_bench_verified", "swe_bench_pro", "gpqa"];

/** Build the Team resolution strategy wiring the live registry's explicit-validation /
 * auto-admit behaviour into ModelResolver. Returns undefined when the registry isn't
 * the Team live service (Solo never reaches this call). */
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
    // D7: cost-exempt by provider metadata (LOCAL/FREE tier).
    costExempt: (p) => isCostExempt(ProviderRegistry.getProviderMetadata(p)),
    // D7 fallback: cost metadata for the post-pricing-lookup isCostExempt(metadata,
    // pricing) check (a $0 endpoint price on a nominally-paid tier).
    providerCostMetadata: (p) => ProviderRegistry.getProviderMetadata(p),
    // The health checker reports a boolean per provider (stub: all healthy), mapped to the
    // circuit sub-signal; other sub-signals renormalise since no per-route health state exists yet.
    routeHealth: () => ({ circuitState: 1 }),
    routePolicy: config.model_registry?.route_policy ?? DEFAULT_ROUTE_POLICY,
    routePriceTolerance: config.model_registry?.route_policy_price_tolerance ?? DEFAULT_ROUTE_PRICE_TOLERANCE,
    routeOrder: config.model_registry?.route_order ?? {},
    // benchmarkMap feeds scoreBest; usageTiebreak is the strategy's own config gate
    // for rankUsage — the resolver has no opinion on the opt-in.
    benchmarkMap: config.model_registry?.benchmark_map,
    usageTiebreak: config.model_registry?.usage_tiebreak ?? false,
  });
}

/** Route-policy defaults mirroring the ModelRegistryConfigSchema fallbacks. */
const DEFAULT_ROUTE_POLICY: IRouteReason = "cheapest";
const DEFAULT_ROUTE_PRICE_TOLERANCE = 0.05;

/** Build the opt-in registry refresh scheduler. Returns undefined unless the registry is
 * the Team live service AND model_registry.enabled === true; the caller starts and stops it. */
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

/** Populate the benchmark data plane at Team startup: the curated floor is applied
 * unconditionally, but the models.dev ingest is doubly gated (model_registry.enabled
 * AND benchmark_source.enabled). No-op on Solo. */
export async function loadBenchmarkFloor(
  modelRegistry: IModelRegistry,
  config: Config,
): Promise<void> {
  if (!(modelRegistry instanceof ModelRegistryService)) return;
  await modelRegistry.applyBenchmarks(STATIC_BENCHMARKS);
  const source = config.model_registry?.benchmark_source;
  if (config.model_registry?.enabled === true && source?.enabled === true) {
    await fetchModelsDevBenchmarks(modelRegistry, {
      endpoint: source.dataset_url,
      trackedBenchmarks: source.tracked_benchmarks,
      fetchTimeoutMs: source.fetch_timeout_ms,
      fetch,
    });
  }
}

/** Called from main.ts after FlowRunner construction, inside the EDITION_TEAM guard. */
export function registerTeamCapabilities(
  agentExecutorAdapter: AgentComposerAdapter,
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

  if (hitlPolicyEvaluator) {
    const hitlModule = new HitlCapabilityModule();
    composer.registerCapabilityModule(hitlModule);
  }

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

  const portalExtractorsModule = new PortalExtractorsModule();
  composer.registerCapabilityModule(portalExtractorsModule);

  const stepRegistry = flowRunner.getStepHandlerRegistry();
  for (const module of composer.getModules()) {
    module.registerFlowStepHandlers?.(stepRegistry);
    module.registerSymbolExtractors?.(symbolRegistry as ISeamRegistryPlaceholder);
  }
}
