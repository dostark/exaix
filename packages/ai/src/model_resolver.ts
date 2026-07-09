/**
 * @module ModelResolver
 * @path packages/ai/src/model_resolver.ts
 * @description Phase 132 — policy-driven model routing service. Accepts ModelIntent and
 *   returns IResolvedModel with provider, model, and per-call options. Delegates provider
 *   selection to IProviderRoutingStrategy, resolves model within provider via ProviderRegistry
 *   metadata, and handles fallback iteration, thinking constraint re-resolution, and trace events.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @exaix/core, @exaix/ai/provider_registry]
 * @related-files [packages/ai/src/provider_selector.ts, packages/ai/src/routing/provider_routing_strategy.ts]
 */

import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type {
  Config,
  EffortTier,
  IModelCallOptions,
  IResolvedModel,
  ModelIntent,
  ModelPreset,
  ModelResolutionReason,
  ModelSize,
} from "@exaix/schemas";
import { DEFAULT_MODEL_PRESETS, getDefaultModels } from "@exaix/schemas";
import { MODEL_CONTEXT_WINDOWS } from "@exaix/core/types";
import { isRetryable } from "./providers/common.ts";
import type { IProviderHealthChecker, ISelectionCriteria } from "./provider_selector.ts";
import type { IProviderMetadata } from "./provider_registry.ts";
import { ProviderRegistry } from "./provider_registry.ts";
import type { IProviderRoutingStrategy } from "./routing/provider_routing_strategy.ts";
import type { ICapabilityProfile, IModelRegistry } from "@exaix/core/types";
import { DEFAULT_MOCK_MODEL, ProviderType } from "@exaix/core/types";

const CHARACTERISTIC_WEIGHT = 1;

/** @internal Map of preset override name → { model_size → resolved model } */
const OVERRIDE_MODEL_MAP: Record<string, Record<ModelSize, { provider: string; model: string }>> = {
  test: {
    S: { provider: ProviderType.MOCK, model: DEFAULT_MOCK_MODEL },
    M: { provider: ProviderType.MOCK, model: DEFAULT_MOCK_MODEL },
    L: { provider: ProviderType.MOCK, model: DEFAULT_MOCK_MODEL },
    XL: { provider: ProviderType.MOCK, model: DEFAULT_MOCK_MODEL },
  },
};

const EFFORT_MAX_TOKENS: Record<EffortTier, number> = {
  low: 1024,
  medium: 4096,
  high: 8192,
};

/**
 * Policy-driven model resolver. Stateless by design — all state lives in
 * the injected dependencies (selector, registry, config).
 */
export class ModelResolver {
  constructor(
    private selector: IProviderRoutingStrategy,
    private config: Config,
    private healthChecker: IProviderHealthChecker,
    private eventLogger: IEventLogger,
    private modelRegistry?: IModelRegistry,
  ) {}

  /**
   * Resolve a ModelIntent to a concrete provider:model with per-call options.
   * Precedence: explicit model override > characteristics scoring > preset default.
   */
  async resolve(intent: ModelIntent): Promise<IResolvedModel> {
    const startTime = Date.now();

    const overrideResult = this.tryResolveOverride(intent);
    if (overrideResult) return overrideResult;

    const explicitResult = await this.tryResolveExplicit(intent, startTime);
    if (explicitResult) return explicitResult;

    const presetResult = await this.tryResolveFromPreset(intent, startTime);
    if (presetResult) return presetResult;

    const fallbacks = intent.fallbacks ?? [];
    const maxAttempts = fallbacks.length + 1;
    const hadExplicitModelSize = !!intent.model_size;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const currentIntent = attempt === 1 ? intent : this.mergeFallback(intent, fallbacks[attempt - 2]);
      try {
        const resolved = await this.resolveOnce(currentIntent, attempt, startTime);
        if (resolved) {
          const overflowResult = await this.tryResolveOverflow(
            intent,
            currentIntent,
            resolved,
            hadExplicitModelSize,
            attempt,
            startTime,
          );
          if (overflowResult) return overflowResult;
          return resolved;
        }
      } catch (error) {
        if (error instanceof Error && isRetryable(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `Model resolution failed: no suitable model found after ${maxAttempts} attempt(s). ` +
        `Intent: ${JSON.stringify(intent)}`,
    );
  }

  private tryResolveOverride(intent: ModelIntent): IResolvedModel | null {
    const overridePreset = Deno.env.get("EXA_MODEL_PRESET_OVERRIDE");
    if (!overridePreset || !intent.model_size) return null;
    const overrideMap = OVERRIDE_MODEL_MAP[overridePreset];
    if (!overrideMap) return null;
    const resolved = overrideMap[intent.model_size];
    if (!resolved) return null;
    return { ...resolved, options: this.buildCallOptions(intent), attempt: 1 };
  }

  private async tryResolveExplicit(intent: ModelIntent, startTime: number): Promise<IResolvedModel | null> {
    if (!intent.model || !intent.model.includes(":")) return null;
    const [provider, ...rest] = intent.model.split(":");
    const model = rest.join(":");
    const resolved: IResolvedModel = { provider, model, options: this.buildCallOptions(intent), attempt: 1 };
    await this.emitTrace(intent, resolved, [provider], {}, "explicit_override", Date.now() - startTime);
    return resolved;
  }

  private async tryResolveFromPreset(intent: ModelIntent, startTime: number): Promise<IResolvedModel | null> {
    if (!intent.model_size) return null;

    if (this.modelRegistry) {
      const profile = this.profileFor(intent.model_size);
      const models = await this.modelRegistry.getModelsByCapability(profile);
      if (models.length === 0) return null;
      const first = models[0];
      const resolved: IResolvedModel = {
        provider: first.provider,
        model: first.model,
        options: this.buildCallOptions(intent),
        attempt: 1,
      };
      const providers = ProviderRegistry.getAllProviders();
      await this.emitTrace(
        intent,
        resolved,
        providers.map((p) => p.metadata.name),
        {},
        "preset_default",
        Date.now() - startTime,
      );
      return resolved;
    }

    const presets = this.config.model_presets ?? DEFAULT_MODEL_PRESETS;
    const resolved = resolvePresetFromSize(intent.model_size, presets);
    resolved.options = this.buildCallOptions(intent);
    resolved.attempt = 1;
    const providers = ProviderRegistry.getAllProviders();
    await this.emitTrace(
      intent,
      resolved,
      providers.map((p) => p.metadata.name),
      {},
      "preset_default",
      Date.now() - startTime,
    );
    return resolved;
  }

  private async tryResolveOverflow(
    intent: ModelIntent,
    currentIntent: ModelIntent,
    resolved: IResolvedModel,
    hadExplicitModelSize: boolean,
    attempt: number,
    startTime: number,
  ): Promise<IResolvedModel | null> {
    if (
      !intent.context_window_fallback || hadExplicitModelSize ||
      !intent.estimated_input_tokens || !intent.model_size
    ) {
      return null;
    }

    let contextWindow: number | undefined;
    if (this.modelRegistry) {
      contextWindow = await this.modelRegistry.getContextWindow(resolved.provider, resolved.model);
    } else {
      const windowKey = `${resolved.provider}:${resolved.model}`;
      contextWindow = MODEL_CONTEXT_WINDOWS[windowKey];
    }
    if (!contextWindow || intent.estimated_input_tokens <= contextWindow) return null;

    const bumped = this.bumpModelSize(intent.model_size);
    if (!bumped) return null;

    const overflowIntent = { ...currentIntent, model_size: bumped };
    const reResolved = await this.resolveOnce(overflowIntent, attempt, startTime);
    if (!reResolved) return null;

    const providers = ProviderRegistry.getAllProviders();
    await this.emitTrace(
      overflowIntent,
      reResolved,
      providers.map((p) => p.metadata.name),
      {},
      "context_window_overflow",
      Date.now() - startTime,
    );
    return reResolved;
  }

  private async resolveOnce(
    intent: ModelIntent,
    attempt: number,
    startTime: number,
  ): Promise<IResolvedModel | null> {
    const criteria = this.buildSelectionCriteria(intent);
    const allProviders = ProviderRegistry.getAllProviders();

    const candidates = this.applyCapabilityFilter(allProviders, intent);
    if (candidates.length === 0) return null;

    const providerName = await this.selector.selectProvider(criteria);
    const providerMetadata = ProviderRegistry.getProviderMetadata(providerName);
    if (!providerMetadata) return null;

    let model = this.selectModelForProvider(providerName, intent);
    if (!model) return null;

    if (this.modelRegistry && intent.model_size) {
      const profile = this.profileFor(intent.model_size);
      const entries = await this.modelRegistry.getModelsByCapability(profile);
      if (entries.length > 0) {
        const match = entries.find((e) => e.provider === providerName);
        if (match) {
          model = match.model;
        }
      }
    }

    if (intent.thinking && !providerMetadata.supportsThinking) {
      return this.resolveWithThinkingConstraint(
        intent,
        providerName,
        model,
        attempt,
        startTime,
        allProviders,
      );
    }

    const scores = this.scoreCandidates(candidates, intent.characteristics);
    const reason: ModelResolutionReason = intent.characteristics?.length ? "characteristics_scored" : "preset_default";

    const resolved: IResolvedModel = {
      provider: providerName,
      model,
      options: this.buildCallOptions(intent),
      attempt,
    };

    await this.emitTrace(
      intent,
      resolved,
      candidates.map((p) => p.metadata.name),
      scores,
      reason,
      Date.now() - startTime,
    );

    return resolved;
  }

  private async resolveWithThinkingConstraint(
    intent: ModelIntent,
    originalProvider: string,
    originalModel: string,
    attempt: number,
    startTime: number,
    allProviders: Array<{ metadata: IProviderMetadata }>,
  ): Promise<IResolvedModel | null> {
    const thinkingCandidates = allProviders.filter((p) => p.metadata.supportsThinking);
    if (thinkingCandidates.length === 0) {
      await this.emitTrace(
        intent,
        { provider: originalProvider, model: originalModel, attempt },
        allProviders.map((p) => p.metadata.name),
        {},
        "thinking_constrained",
        Date.now() - startTime,
      );
      return null;
    }

    // Pick the first healthy thinking-capable provider directly, bypassing the
    // routing strategy (which already selected a non-thinking provider).
    const criteria = this.buildSelectionCriteria(intent);
    const filtered = thinkingCandidates.filter((p) =>
      criteria.requiredCapabilities?.every((cap) => p.metadata.capabilities.includes(cap)) ?? true
    );
    if (filtered.length === 0) return null;

    const chosen = filtered[0];
    const thinkingProvider = chosen.metadata.name;
    const thinkingModel = this.selectModelForProvider(thinkingProvider, intent);
    if (!thinkingModel) return null;

    const resolved: IResolvedModel = {
      provider: thinkingProvider,
      model: thinkingModel,
      options: this.buildCallOptions(intent),
      attempt,
    };

    await this.emitTrace(
      intent,
      resolved,
      allProviders.map((p) => p.metadata.name),
      {},
      "thinking_constrained",
      Date.now() - startTime,
    );

    return resolved;
  }

  private profileFor(size: ModelSize): ICapabilityProfile {
    const presets = this.config.model_presets ?? DEFAULT_MODEL_PRESETS;
    const profile = presets[size];
    if (!profile) return {};
    return {
      minContextWindow: profile.min_context_window,
      maxCostPerMillionTokens: profile.max_cost_per_mtok,
      supportsThinking: profile.supports_thinking,
    };
  }

  private buildSelectionCriteria(intent: ModelIntent): ISelectionCriteria {
    return {
      preferFree: intent.max_cost_usd === 0,
      maxCostUsd: intent.max_cost_usd,
      allowLocal: intent.allow_local,
      requiredCapabilities: intent.required_capabilities ?? ["chat"],
      characteristics: intent.characteristics,
    };
  }

  private applyCapabilityFilter(
    providers: Array<{ metadata: IProviderMetadata }>,
    intent: ModelIntent,
  ): Array<{ metadata: IProviderMetadata }> {
    if (!intent.required_capabilities?.length) return providers;
    return providers.filter((p) => intent.required_capabilities!.every((cap) => p.metadata.capabilities.includes(cap)));
  }

  private selectModelForProvider(
    providerName: string,
    intent: ModelIntent,
  ): string | null {
    if (intent.model && !intent.model.includes(":")) {
      return intent.model;
    }
    const defaults = getDefaultModels();
    if (defaults[providerName]) return defaults[providerName];
    return providerName;
  }

  private scoreCandidates(
    candidates: Array<{ metadata: IProviderMetadata }>,
    characteristics?: string[],
  ): Record<string, number> {
    const scores: Record<string, number> = {};
    if (!characteristics?.length) return scores;

    const maxCost = Math.max(
      ...candidates.map((p) => p.metadata.costPerMtok ?? 0),
      1,
    );

    for (const p of candidates) {
      let totalScore = 0;
      let weightSum = 0;

      for (const char of characteristics) {
        weightSum += CHARACTERISTIC_WEIGHT;
        switch (char) {
          case "cheapest":
            totalScore += CHARACTERISTIC_WEIGHT * (1 - ((p.metadata.costPerMtok ?? 0) / maxCost));
            break;
          case "fastest":
            totalScore += CHARACTERISTIC_WEIGHT * 1;
            break;
          default:
            totalScore += CHARACTERISTIC_WEIGHT * 1;
            break;
        }
      }

      scores[p.metadata.name] = weightSum > 0 ? totalScore / weightSum : 0;
    }

    return scores;
  }

  private buildCallOptions(intent: ModelIntent): IModelCallOptions | undefined {
    if (!intent.thinking && !intent.effort) return undefined;
    const options: IModelCallOptions = {};
    if (intent.thinking) options.thinking = true;
    if (intent.effort) {
      options.effort = intent.effort;
      options.max_tokens = EFFORT_MAX_TOKENS[intent.effort];
    }
    return options;
  }

  private mergeFallback(base: ModelIntent, fallback: Partial<ModelIntent>): ModelIntent {
    return { ...base, ...fallback };
  }

  private bumpModelSize(size: ModelSize): ModelSize | null {
    switch (size) {
      case "S":
        return "M";
      case "M":
        return "L";
      case "L":
        return "XL";
      case "XL":
        return null;
      default:
        return null;
    }
  }

  private async emitTrace(
    intent: ModelIntent,
    resolved: IResolvedModel,
    candidateProviders: string[],
    scores: Record<string, number>,
    reason: ModelResolutionReason,
    durationMs: number,
  ): Promise<void> {
    await this.eventLogger.info(DomainEventType.ModelResolved, resolved.model, {
      intent: JSON.stringify(intent),
      candidate_providers: candidateProviders.join(","),
      scores: JSON.stringify(scores),
      selected: `${resolved.provider}:${resolved.model}`,
      reason,
      attempt: String(resolved.attempt ?? 1),
      duration_ms: String(durationMs),
    });
  }
}

/**
 * Resolve a model_size to a concrete provider by applying the preset profile's
 * constraints (cost, context window, thinking) against registered providers.
 * Returns the first matching provider:model.
 */
export function resolvePresetFromSize(
  size: string,
  configPresets: Record<string, ModelPreset> = DEFAULT_MODEL_PRESETS,
): IResolvedModel {
  const profile = configPresets[size];
  if (!profile) {
    throw new Error(`No preset profile found for model_size "${size}"`);
  }

  const candidates = ProviderRegistry.getAllProviders();

  // Filter by context window
  const windowFiltered = candidates.filter(
    (p) => (p.metadata.contextWindow ?? 0) >= profile.min_context_window,
  );
  if (windowFiltered.length === 0) {
    throw new Error(`No provider meets min_context_window ${profile.min_context_window} for size "${size}"`);
  }

  // Filter by cost
  const costFiltered = windowFiltered.filter(
    (p) => (p.metadata.costPerMtok ?? 0) <= profile.max_cost_per_mtok || !p.metadata.costPerMtok,
  );
  if (costFiltered.length === 0) {
    throw new Error(`No provider meets max_cost_per_mtok ${profile.max_cost_per_mtok} for size "${size}"`);
  }

  // Filter by thinking
  const thinkingFiltered = profile.supports_thinking
    ? costFiltered.filter((p) => p.metadata.supportsThinking !== false)
    : costFiltered;

  if (thinkingFiltered.length === 0) {
    throw new Error(`No provider meets thinking=${profile.supports_thinking} for size "${size}"`);
  }

  const chosen = thinkingFiltered[0];
  const defaults = getDefaultModels();
  return { provider: chosen.metadata.name, model: defaults[chosen.metadata.name] ?? chosen.metadata.name, attempt: 1 };
}
